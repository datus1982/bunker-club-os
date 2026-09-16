/**
 * Mirror against the fake Core: happy-path snapshot shape from the pinned inventory, live
 * ChangeGroup updates, ≤1 Hz coalescing + heartbeat, the degraded paths (missing component /
 * missing control / design mismatch / disconnect), re-bootstrap after reconnect, and the wire
 * proof that only read methods were ever sent.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTRACT, CONTRACT_COMPONENTS, CONTRACT_REFS } from "../src/controls.js";
import { Mirror } from "../src/mirror.js";
import { QrcClient, READ_ONLY_METHODS } from "../src/qrc.js";
import { ControlStore, derive, type Snapshot } from "../src/snapshot.js";
import { FakeCore, loadFixture, sleep, testLogger, waitFor } from "./fakeCore.js";

const VENUE = "11111111-1111-1111-1111-111111111111";
const GROUP = "bunker-agent-mirror";

interface Rig {
  core: FakeCore;
  client: QrcClient;
  mirror: Mirror;
  posted: Snapshot[];
  lines: string[];
  stop: () => Promise<void>;
}

async function rig(coreOpts: ConstructorParameters<typeof FakeCore>[0] = {}, mirrorOpts: { reportIntervalMs?: number; heartbeatMs?: number; post?: "collect" | null; failPosts?: () => boolean } = {}): Promise<Rig> {
  const core = new FakeCore(coreOpts);
  await core.start();
  const { lines, log } = testLogger();
  const client = new QrcClient({ host: "127.0.0.1", port: core.port, keepaliveMs: 60_000, reconnectMinMs: 30, reconnectMaxMs: 100, log: (l, m) => log(l, m) });
  const posted: Snapshot[] = [];
  const post = mirrorOpts.post === null ? null : async (s: Record<string, unknown>) => {
    if (mirrorOpts.failPosts?.()) return { ok: false, status: 500, error: "boom" };
    posted.push(s as unknown as Snapshot);
    return { ok: true, status: 204 };
  };
  const mirror = new Mirror({
    client,
    venueId: VENUE,
    agentId: "test-nuc",
    coreHost: "127.0.0.1",
    expectedDesignPrefix: "BunkerClub",
    post,
    log,
    reportIntervalMs: mirrorOpts.reportIntervalMs ?? 25,
    heartbeatMs: mirrorOpts.heartbeatMs ?? 10_000,
  });
  const booted = new Promise<void>((resolve) => mirror.once("bootstrapped", () => resolve()));
  mirror.start();
  await client.start();
  await booted;
  return {
    core,
    client,
    mirror,
    posted,
    lines,
    stop: async () => {
      mirror.stop();
      client.stop();
      await core.stop();
    },
  };
}

describe("Mirror happy path (pinned inventory)", () => {
  it("bootstraps every contract component + control, subscribes them all, and only ever sends read methods", async () => {
    const r = await rig();
    const errs = r.mirror.currentErrors();
    assert.deepEqual(errs, [], `expected no errors, got ${JSON.stringify(errs)}`);
    const subs = r.core.subscriptions(GROUP);
    assert.equal(subs.length, CONTRACT_REFS.length, "every contract control subscribed");
    for (const ref of CONTRACT_REFS) assert.ok(subs.some((s) => s.component === ref.component && s.control === ref.control), `${ref.component}/${ref.control} subscribed`);
    assert.ok(r.core.received.some((f) => f.method === "ChangeGroup.AutoPoll" && (f.params as { Rate: number }).Rate === 1), "AutoPoll at 1 Hz");
    for (const m of r.core.methodsSeen()) assert.ok(READ_ONLY_METHODS.has(m), `non-read method on the wire: ${m}`);
    await r.stop();
  });

  it("produces the documented snapshot shape with the room's real values", async () => {
    const r = await rig();
    await waitFor(() => r.posted.length >= 1, 2000, "first post");
    const s = r.posted[0];
    // identity + freshness
    assert.equal(s.venue_id, VENUE);
    assert.equal(s.agent_id, "test-nuc");
    assert.equal(s.agent_version, "0.1.0");
    assert.ok(!Number.isNaN(Date.parse(s.at)));
    assert.equal(s.connected, true);
    assert.deepEqual(s.core, { host: "127.0.0.1", design_name: "BunkerClub_v03.20260329", design_code: "vyysM4BoQKaY", platform: "NV-32-H (Core Mode)", state: "Active", status: "OK - 16 OK" });
    assert.deepEqual(s.errors, []);
    // raw controls: every contract component present, every control carries {v,s,p,at}
    assert.deepEqual(Object.keys(s.controls).sort(), [...CONTRACT_COMPONENTS].sort());
    assert.equal(Object.keys(s.controls).includes("__meta"), false);
    for (const c of CONTRACT) {
      for (const k of c.controls) {
        const st = s.controls[c.component][k];
        assert.ok(st, `${c.component}/${k} missing`);
        assert.deepEqual(Object.keys(st).sort(), ["at", "p", "s", "v"]);
      }
    }
    assert.equal(s.controls["Inside Mixer"]["output.1.gain"].s, "-44.5dB");
    assert.equal(s.controls["Inside Mixer"]["input.1.mute"].v, true);
    // derived
    const d = s.derived;
    assert.deepEqual(d.zones.inside, { source: 1, source_name: "Sonos", gain_db: -44.45747756, mute: false });
    assert.deepEqual(d.zones.patio, { source: 1, source_name: "Sonos", gain_db: -3.70967483, mute: false });
    assert.deepEqual(d.zones.listen, { source: 1, source_name: "Sonos", gain_db: -3.60124588, mute: false });
    assert.deepEqual(d.inside_trims, { surface_db: 0, sub_db: 0, ceiling_db: 0 });
    assert.deepEqual(d.mics, { "1": { mute: true, gain_db: -30 }, "2": { mute: true, gain_db: -30 } });
    assert.equal(d.sonos.transport, "PAUSED_PLAYBACK");
    assert.equal(d.sonos.track, "Turn Off the Light (radio edit)");
    assert.equal(d.sonos.artist, "Nelly Furtado");
    assert.equal(d.sonos.status, "OK - 192.168.68.41");
    assert.equal(d.sonos.favorites.length, 31);
    assert.deepEqual(d.sonos.favorites[0], { n: 1, name: "8-Tracks" });
    assert.deepEqual(d.sonos.favorites[30], { n: 31, name: "Y2K Hits" });
    assert.deepEqual(d.video.outputs, { "1": { active_source: "BunkerFeed" }, "2": { active_source: "BunkerFeed" } });
    assert.deepEqual(d.video.sources["Bunker Feed"], { signal: true, plugged: true });
    assert.deepEqual(d.video.sources["Roku"], { signal: false, plugged: false });
    assert.deepEqual(d.effects, { reverb_bypass: false, ducker_bypass: true });
    assert.equal(d.meters.inputs_db.length, 13);
    assert.equal(d.meters.zones_db.length, 4);
    assert.equal(d.meters.inputs_db[8], -4.23166513); // meter.9 = Sonos L
    assert.equal(d.amp.status, "OK");
    assert.equal(d.amp.temperatures_c.length, 4);
    assert.deepEqual(d.amp.clip, [false, false, false, false]);
    // the whole thing is plain JSON (what the RPC receives)
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    await r.stop();
  });

  it("applies ChangeGroup.Poll pushes and coalesces a burst into ≤ one post per interval", async () => {
    const r = await rig({}, { reportIntervalMs: 60 });
    await waitFor(() => r.posted.length >= 1, 2000, "first post");
    const before = r.posted.length;
    // a burst of 6 changes inside one interval → exactly one more post carrying the LAST values
    for (let i = 1; i <= 6; i++) {
      r.core.pushPoll(GROUP, [
        { Component: "Inside Router_8x8", Name: "select.1", Value: 2, String: "2", Position: 0.5 },
        { Component: "Inside Mixer", Name: "output.1.gain", Value: -40 + i, String: `${-40 + i}dB`, Position: 0.2 },
        { Component: "SonosSonosControl", Name: "TransportState", String: "PLAYING" },
      ]);
    }
    await sleep(140);
    const after = r.posted.length;
    assert.ok(after - before >= 1 && after - before <= 2, `burst coalesced (got ${after - before} posts)`);
    const last = r.posted[r.posted.length - 1];
    assert.equal(last.derived.zones.inside.source, 2);
    assert.equal(last.derived.zones.inside.source_name, "Booth");
    assert.equal(last.derived.zones.inside.gain_db, -34);
    assert.equal(last.derived.sonos.transport, "PLAYING");
    // a poll for someone else's change group is ignored
    r.core.pushPoll("not-ours", [{ Component: "Inside Router_8x8", Name: "select.1", Value: 3 }]);
    await sleep(80);
    assert.equal(r.posted[r.posted.length - 1].derived.zones.inside.source, 2);
    // nothing changed → no new posts inside the heartbeat window
    const quiet = r.posted.length;
    await sleep(150);
    assert.equal(r.posted.length, quiet, "no change ⇒ no post before the heartbeat");
    await r.stop();
  });

  it("posts a heartbeat even when nothing changes, and retries a failed post on the next tick", async () => {
    let fail = false;
    const r = await rig({}, { reportIntervalMs: 20, heartbeatMs: 90, failPosts: () => fail });
    await waitFor(() => r.posted.length >= 1, 2000, "first post");
    const n = r.posted.length;
    await sleep(220);
    assert.ok(r.posted.length >= n + 2, `heartbeats arrived (${r.posted.length - n})`);
    fail = true;
    r.core.pushPoll(GROUP, [{ Component: "Priority_Ducker", Name: "bypass", Value: false, String: "active" }]);
    await sleep(80);
    const failedAt = r.posted.length;
    fail = false;
    await waitFor(() => r.posted.length > failedAt, 1000, "retry after failure");
    assert.equal(r.posted[r.posted.length - 1].derived.effects.ducker_bypass, false, "the change survived the failed attempt");
    assert.ok(r.lines.some((l) => /report failed \(500\)/.test(l)), "failure was logged");
    await r.stop();
  });

  it("accepts AutoPoll pushes delivered as a repeated result frame (id + result.Changes)", async () => {
    const r = await rig();
    await waitFor(() => r.posted.length >= 1, 2000, "first post");
    // hand-write the alternate shape straight to the socket
    const frame = JSON.stringify({ jsonrpc: "2.0", id: 999999, result: { Id: GROUP, Changes: [{ Component: "Patio Mixer", Name: "output.1.mute", Value: true, String: "muted" }] } });
    for (const s of r.core.sockets) s.write(Buffer.concat([Buffer.from(frame), Buffer.from([0])]));
    await waitFor(() => r.posted[r.posted.length - 1]?.derived.zones.patio.mute === true, 1000, "patio mute via result-shaped push");
    await r.stop();
  });
});

describe("Mirror degraded paths (fail LOUD, keep running)", () => {
  it("names a missing component exactly and still mirrors everything else", async () => {
    const r = await rig({ hideComponents: ["Patio Mixer"] });
    const errs = r.mirror.currentErrors();
    assert.equal(errs.length, 1);
    assert.equal(errs[0].kind, "missing_component");
    assert.equal(errs[0].component, "Patio Mixer");
    assert.match(errs[0].message, /'Patio Mixer'/);
    assert.ok(r.lines.some((l) => l.includes("MISSING COMPONENT 'Patio Mixer'")), "logged loudly");
    await waitFor(() => r.posted.length >= 1, 2000, "post");
    const s = r.posted[r.posted.length - 1];
    assert.equal(s.errors[0].component, "Patio Mixer");
    assert.deepEqual(s.derived.zones.patio, { source: 1, source_name: "Sonos", gain_db: null, mute: null }); // router still read, mixer unknown
    assert.equal(s.derived.zones.inside.gain_db, -44.45747756); // the rest is intact
    assert.equal(r.core.subscriptions(GROUP).length, CONTRACT_REFS.length - 2);
    await r.stop();
  });

  it("isolates a missing control by name and subscribes the rest of that component", async () => {
    const r = await rig({ hideControls: [{ component: "Inside Mixer", control: "input.2.gain" }] });
    const errs = r.mirror.currentErrors();
    assert.equal(errs.length, 1);
    assert.deepEqual({ kind: errs[0].kind, component: errs[0].component, control: errs[0].control }, { kind: "missing_control", component: "Inside Mixer", control: "input.2.gain" });
    const subs = r.core.subscriptions(GROUP).filter((s) => s.component === "Inside Mixer").map((s) => s.control).sort();
    assert.deepEqual(subs, ["input.1.gain", "input.1.mute", "input.2.mute", "input.5.gain", "input.8.gain", "output.1.gain", "output.1.mute"]);
    await waitFor(() => r.posted.length >= 1, 2000, "post");
    const s = r.posted[r.posted.length - 1];
    assert.deepEqual(s.derived.mics["2"], { mute: true, gain_db: null });
    assert.deepEqual(s.derived.mics["1"], { mute: true, gain_db: -30 });
    await r.stop();
  });

  it("flags a design that is not the Bunker design but keeps mirroring", async () => {
    const r = await rig({ designName: "SomeoneElsesBar_v1" });
    const errs = r.mirror.currentErrors();
    assert.equal(errs.length, 1);
    assert.equal(errs[0].kind, "design_mismatch");
    assert.match(errs[0].message, /SomeoneElsesBar_v1/);
    await waitFor(() => r.posted.length >= 1, 2000, "post");
    assert.equal(r.posted[0].core.design_name, "SomeoneElsesBar_v1");
    assert.equal(r.posted[0].derived.zones.inside.source, 1);
    await r.stop();
  });

  it("marks the snapshot disconnected when the socket drops, then re-bootstraps and clears it on reconnect", async () => {
    const r = await rig({ dropAfterMethod: "ChangeGroup.AutoPoll" }); // drop the socket the moment bootstrap completes
    await waitFor(() => r.mirror.currentErrors().some((e) => e.kind === "disconnected"), 3000, "disconnected error");
    await waitFor(() => r.posted.some((s) => s.connected === false && s.errors[0]?.kind === "disconnected"), 2000, "disconnected snapshot posted");
    // reconnect → second bootstrap on the new connection → errors cleared, subscriptions re-made
    await waitFor(() => r.core.connections >= 2 && r.mirror.currentErrors().length === 0, 4000, "re-bootstrap");
    await waitFor(() => r.posted[r.posted.length - 1]?.connected === true && r.posted[r.posted.length - 1].errors.length === 0, 2000, "clean snapshot after reconnect");
    const conn2 = r.core.received.filter((f) => f.connection === 2).map((f) => f.method);
    assert.ok(conn2.includes("StatusGet") && conn2.includes("Component.GetComponents") && conn2.includes("ChangeGroup.AutoPoll"), "full bootstrap ran again on connection 2");
    for (const m of r.core.methodsSeen()) assert.ok(READ_ONLY_METHODS.has(m), `non-read method on the wire: ${m}`);
    await r.stop();
  });

  it("dev mode (no poster) logs the snapshot summary instead of posting", async () => {
    const r = await rig({}, { post: null });
    await waitFor(() => r.lines.some((l) => l.includes("dev mode, not posted")), 2000, "dev-mode log line");
    const line = r.lines.find((l) => l.includes("dev mode, not posted"))!;
    assert.match(line, /inside=Sonos@-44\.5dB/);
    assert.match(line, /sonos=PAUSED_PLAYBACK/);
    assert.equal(r.posted.length, 0);
    await r.stop();
  });
});

describe("contract ↔ fixture", () => {
  it("every contract component + control exists in the pinned inventory slice", () => {
    const fx = loadFixture();
    const names = new Set(fx.components.map((c) => c.Name));
    for (const c of CONTRACT) {
      assert.ok(names.has(c.component), `inventory lacks component ${c.component}`);
      const have = new Set((fx.controls[c.component] ?? []).map((k) => k.Name));
      for (const k of c.controls) assert.ok(have.has(k), `inventory lacks ${c.component} → ${k}`);
    }
    assert.equal(CONTRACT_REFS.length, 92); // 90 (PR A) + input.5.gain + input.8.gain (PR C sources)
  });
});

describe("derive: Boolean read-backs arrive as bool / 0-1 / String on the wire (live NUC finding, review #2)", () => {
  it("mic mutes + amp clip resolve from every wire shape; unknown strings stay null", () => {
    const store = new ControlStore();
    store.set("Inside Mixer", "input.1.mute", 1, "muted", 1);          // number 0/1
    store.set("Inside Mixer", "input.2.mute", undefined, "unmuted", 0); // String only
    store.set("Inside Mixer", "output.1.mute", "true", null, null);     // string value
    store.set("Patio Mixer", "output.1.mute", false, "unmuted", 0);     // real boolean
    store.set("Lush_Reverb_Effect", "bypass", undefined, "bypassed", 1);
    store.set("Amp_Output_bunker-amp-1_CX-Q_2K4", "channel.1.input.clip.led", 0, "normal", 0);
    store.set("Amp_Output_bunker-amp-1_CX-Q_2K4", "channel.2.input.clip.led", undefined, "clip", 1);
    store.set("Amp_Output_bunker-amp-1_CX-Q_2K4", "channel.3.input.clip.led", "weird", "weird", null);
    const d = derive(store.snapshotControls());
    assert.equal(d.mics["1"].mute, true);
    assert.equal(d.mics["2"].mute, false);
    assert.equal(d.zones.inside.mute, true);
    assert.equal(d.zones.patio.mute, false);
    assert.equal(d.effects.reverb_bypass, true);
    assert.deepEqual(d.amp.clip.slice(0, 3), [false, true, null]);
  });
});
