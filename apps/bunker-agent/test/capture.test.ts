/**
 * CLI capture against the fake Core: the payload shape from the pinned inventory, favorite
 * resolution (heuristics + override), the store call's exact arguments, dry-run / dev-mode /
 * missing-lever behaviour, the summary line, and the wire proof (Component.Get only).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureScene } from "../src/capture-run.js";
import { resolveSonosFavorite, squash } from "../src/capture.js";
import { parseConfig } from "../src/config.js";
import { SCENE_LEVERS } from "../src/controls.js";
import { QrcClient, READ_ONLY_METHODS } from "../src/qrc.js";
import { FakeCore } from "./fakeCore.js";

const VENUE = "11111111-1111-1111-1111-111111111111";
const cfg = () => parseConfig({ coreHost: "127.0.0.1", venueId: VENUE, agentId: "cli-test", supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon", deviceToken: "tok" });
const LEVER_COUNT = SCENE_LEVERS.reduce((n, l) => n + l.controls.length, 0); // 18 today

async function withCore(opts: ConstructorParameters<typeof FakeCore>[0], fn: (core: FakeCore, client: QrcClient) => Promise<void>) {
  const core = new FakeCore(opts);
  await core.start();
  const client = new QrcClient({ host: "127.0.0.1", port: core.port, keepaliveMs: 60_000 });
  await client.start();
  try {
    await fn(core, client);
  } finally {
    client.stop();
    await core.stop();
  }
}

describe("capture — payload from the pinned inventory", () => {
  it("captures every scene lever, the favorite, the two HDMI outs, and stores via audio_agent_capture with exact args", async () => {
    await withCore({}, async (core, client) => {
      const sent: Array<{ scene: string; payload: Record<string, unknown> }> = [];
      const out: string[] = [];
      const r = await captureScene({
        sceneName: "normal",
        favoriteOverride: null,
        dryRun: false,
        config: cfg(),
        client,
        sender: async (scene, payload) => {
          sent.push({ scene, payload });
          return { ok: true, status: 200, sceneId: "a0d10000-0000-4000-8000-000000000001" };
        },
        rangeSeeder: null, // PR C: the NORMAL seed is covered in sources.test.ts; never let a test reach the network
        out: (l) => out.push(l),
        err: () => {},
      });
      assert.equal(r.stored, true);
      assert.equal(r.sceneId, "a0d10000-0000-4000-8000-000000000001");
      assert.equal(sent.length, 1);
      assert.equal(sent[0].scene, "NORMAL", "scene name upper-cased for the case-insensitive RPC match");
      const p = r.payload;
      assert.equal(p.venue_id, VENUE);
      assert.equal(p.design_name, "BunkerClub_v03.20260329");
      assert.equal(p.controls.length, LEVER_COUNT);
      // flat {component, control} → value entries, exact names, values as captured
      const find = (c: string, k: string) => p.controls.find((x) => x.component === c && x.control === k);
      assert.deepEqual(find("Inside Router_8x8", "select.1"), { component: "Inside Router_8x8", control: "select.1", value: 1, string: "1", position: 0 });
      assert.deepEqual(find("Inside Mixer", "output.1.gain"), { component: "Inside Mixer", control: "output.1.gain", value: -44.45747756, string: "-44.5dB", position: 0.135 });
      assert.equal(find("Inside Mixer", "input.1.mute")?.value, true);
      assert.equal(find("Mixer_8x8", "output.2.gain")?.value, 0);
      assert.equal(find("Lush_Reverb_Effect", "WetLevel")?.value, 3.6030004);
      assert.equal(find("Lush_Reverb_Effect", "bypass")?.value, false);
      assert.equal(p.controls.some((x) => x.component === "Priority_Ducker"), false, "the ducker is not a scene lever");
      assert.equal(p.controls.some((x) => x.component.startsWith("True_Peak")), false, "meters are not levers");
      assert.equal(p.controls.some((x) => x.component.startsWith("Amp_")), false, "the amp is never a lever");
      // sonos: the live capture's AlbumArtURL ends in Y2KHits.png → favorite 31 "Y2K Hits"
      assert.equal(p.sonos_favorite, 31);
      assert.equal(p.sonos_favorite_name, "Y2K Hits");
      assert.equal(p.sonos_favorite_resolved_by, "album-art");
      assert.equal(p.sonos.transport, "PAUSED_PLAYBACK");
      assert.equal(p.sonos.track, "Turn Off the Light (radio edit)");
      // video
      assert.deepEqual(p.video, { out1: "BunkerFeed", out2: "BunkerFeed" });
      assert.deepEqual(p.missing, []);
      // what the RPC receives is the same payload, JSON-clean
      assert.deepEqual(JSON.parse(JSON.stringify(sent[0].payload)), JSON.parse(JSON.stringify(p)));
      // stdout: the JSON then the one-line summary
      assert.ok(out[0].startsWith("{"), "payload printed as JSON");
      assert.equal(out[out.length - 1], `captured NORMAL: ${LEVER_COUNT} controls, sonos fav 31 'Y2K Hits', hdmi out1=BunkerFeed out2=BunkerFeed — stored as scene a0d10000-0000-4000-8000-000000000001`);
      // wire: reads only
      for (const m of core.methodsSeen()) assert.ok(READ_ONLY_METHODS.has(m), `non-read method on the wire: ${m}`);
      assert.deepEqual(core.methodsSeen(), ["Component.Get", "StatusGet"]);
    });
  });

  it("--favorite N overrides the heuristic and shows in the summary", async () => {
    await withCore({}, async (_core, client) => {
      const out: string[] = [];
      const r = await captureScene({ sceneName: "DJ", favoriteOverride: 2, dryRun: true, config: cfg(), client, out: (l) => out.push(l), err: () => {} });
      assert.equal(r.stored, false);
      assert.equal(r.payload.sonos_favorite, 2);
      assert.equal(r.payload.sonos_favorite_name, "80s Hits");
      assert.equal(r.payload.sonos_favorite_resolved_by, "override");
      assert.match(out[out.length - 1], /^captured DJ: \d+ controls, sonos fav 2 '80s Hits' \(override\), hdmi out1=BunkerFeed out2=BunkerFeed — DRY RUN, not stored$/);
    });
  });

  it("dev mode (cloud fields unset) prints and stores nothing; a failed store is reported", async () => {
    await withCore({}, async (_core, client) => {
      const out: string[] = [];
      const dev = parseConfig({ coreHost: "127.0.0.1", venueId: VENUE });
      const r1 = await captureScene({ sceneName: "KARAOKE", favoriteOverride: null, dryRun: false, config: dev, client, out: (l) => out.push(l), err: () => {} });
      assert.equal(r1.stored, false);
      assert.match(out[out.length - 1], /DEV MODE .* not stored$/);
      const errs: string[] = [];
      const r2 = await captureScene({ sceneName: "TRIVIA", favoriteOverride: null, dryRun: false, config: cfg(), client, sender: async () => ({ ok: false, status: 401, error: "unauthorized" }), out: () => {}, err: (l) => errs.push(l) });
      assert.equal(r2.stored, false);
      assert.ok(errs.some((l) => /store FAILED \(401\) unauthorized/.test(l)));
    });
  });

  it("a missing lever is named in payload.missing and the rest is still captured", async () => {
    await withCore({ hideControls: [{ component: "Mixer_8x8", control: "output.3.gain" }] }, async (_core, client) => {
      const errs: string[] = [];
      const r = await captureScene({ sceneName: "NORMAL", favoriteOverride: null, dryRun: true, config: cfg(), client, out: () => {}, err: (l) => errs.push(l) });
      assert.equal(r.payload.controls.length, LEVER_COUNT - 1);
      assert.deepEqual(r.payload.missing.map((m) => `${m.component}/${m.control}`), ["Mixer_8x8/output.3.gain"]);
      assert.ok(r.payload.controls.some((c) => c.component === "Mixer_8x8" && c.control === "output.2.gain"), "siblings survived the per-control probe");
      assert.ok(errs.some((l) => l.includes("MISSING Mixer_8x8 → output.3.gain")));
      assert.match(r.summary, /1 MISSING$/);
    });
  });
});

describe("capture — favorite resolution", () => {
  const favs = [
    { n: 2, name: "80s Hits" },
    { n: 4, name: "90s Hits" },
    { n: 14, name: "Feedback" },
    { n: 31, name: "Y2K Hits" },
    { n: 20, name: "Rock en Español" },
  ];
  it("squashes names to letters+digits", () => {
    assert.equal(squash("Y2K Hits"), "y2khits");
    assert.equal(squash("Rock en Español"), "rockenespaol");
  });
  it("prefers the longest matching name inside CurrentSource/TrackSource, then album art, then album", () => {
    assert.deepEqual(resolveSonosFavorite(favs, { currentSource: "x-sonosapi:station=90s%20Hits?sid=1", trackSource: null, albumArtUrl: null, album: null }), { n: 4, name: "90s Hits", by: "source-name" });
    assert.deepEqual(resolveSonosFavorite(favs, { currentSource: "opaque", trackSource: "Feedback (Backgrounds)", albumArtUrl: null, album: null }), { n: 14, name: "Feedback", by: "source-name" });
    assert.deepEqual(resolveSonosFavorite(favs, { currentSource: "opaque", trackSource: "", albumArtUrl: "https://cdn/images/program/Y2KHits.png", album: null }), { n: 31, name: "Y2K Hits", by: "album-art" });
    assert.deepEqual(resolveSonosFavorite(favs, { currentSource: "opaque", trackSource: "", albumArtUrl: "https://cdn/art/track123.jpg", album: "80s hits" }), { n: 2, name: "80s Hits", by: "album" });
  });
  it("returns null (unresolved) rather than guessing, and honours an override even for an unknown index", () => {
    assert.deepEqual(resolveSonosFavorite(favs, { currentSource: "x-sonosapi-hls-static:track%3a1887489?sid=500", trackSource: "", albumArtUrl: "https://cdn/art/abc.jpg", album: "Turn Off the Light" }), { n: null, name: null, by: null });
    assert.deepEqual(resolveSonosFavorite(favs, { currentSource: null, trackSource: null, albumArtUrl: null, album: null }, 14), { n: 14, name: "Feedback", by: "override" });
    assert.deepEqual(resolveSonosFavorite(favs, { currentSource: null, trackSource: null, albumArtUrl: null, album: null }, 9), { n: 9, name: null, by: "override" });
  });
});
