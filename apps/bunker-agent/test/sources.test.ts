/**
 * PR C — per-SOURCE presets + NUDGES bounded by the owner's ranges. Proves, against the fake
 * Core's RECORDING Component.Set and its replay of the pinned inventory:
 *   • the source model: mic1/mic2/verb direct; sonos/booth/hdmi share input.5.gain and resolve
 *     ONLY for the source Inside Router_8x8 select.1 is on (fixture: 1 = Sonos)
 *   • out-of-range nudge  ⇒ REFUSED `out_of_range` on the wire: ZERO Component.Set frames
 *   • in-range nudge      ⇒ exactly ONE frame: the right control, current ± step, Ramp 0.5
 *   • not-routed source   ⇒ REFUSED `not_routed`, zero frames (booth while the router is on Sonos)
 *   • no range row        ⇒ REFUSED `range_not_set`, zero frames
 *   • source preset       ⇒ one frame with Ramp 2 + a MERGE baseline; unset ⇒ `preset_not_set`
 *   • clamped recall      ⇒ a captured gain outside the owner's range is written AT the bound and
 *                            reported in result.clamped; the REPLACE baseline carries the written value
 *   • baseline: recall replace / zone + source preset merge / nudge NEVER
 *   • a NORMAL capture seeds ranges (captured ± 6, clamped to [-100, 10], unrouted sources absent);
 *     any other scene never calls the seeder
 *   • every control a source can reach is a SCENE_LEVER (the WARN-1 intersection still bounds it)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureScene } from "../src/capture-run.js";
import { baselineFromSteps, clampRecallToRanges, decideSourceWrite, executeCommand, isLever, planRecall, startCommandLoop, type ControlRead, type TakenCommand } from "../src/commands.js";
import { parseConfig } from "../src/config.js";
import { QrcClient, READ_ONLY_METHODS, WRITE_METHODS } from "../src/qrc.js";
import type { CommandApi, QueuedCommand, ReportResult } from "../src/report.js";
import { SOURCE_CONTROLS, SOURCE_KEYS, SOURCE_MIXER, leverForSource, parseRanges, routedSource, seedRangesFromCapture } from "../src/sources.js";
import { FakeCore, testLogger } from "./fakeCore.js";

const VENUE = "11111111-1111-1111-1111-111111111111";
const ARM = "owner@x#abc123";
const noSleep = async () => {};

/** The venue's ranges as the take RPC returns them (jsonb array). Fixture: mic1/mic2 = -30, input.5 = 0, verb = 10. */
const RANGES = [
  { source: "mic1", min_db: -36, max_db: -24, step_db: 1.5 },
  { source: "mic2", min_db: -31, max_db: -29.5, step_db: 1.5 }, // a nudge up from -30 (+1.5 = -28.5) leaves it
  { source: "sonos", min_db: -6, max_db: 6, step_db: 1.5 },
  { source: "booth", min_db: -6, max_db: 6, step_db: 1.5 },
  { source: "verb", min_db: 4, max_db: 10, step_db: 3 },
];

function cmd(over: Partial<TakenCommand>): TakenCommand {
  return {
    id: "s1",
    kind: "source_nudge",
    payload: { armed_by: ARM },
    requested_by: "owner@x",
    requested_at: new Date().toISOString(),
    scene_name: null,
    writes_armed_by: ARM,
    writes_arm_valid: true,
    ranges: RANGES,
    ...over,
  };
}

async function withCore(coreOpts: ConstructorParameters<typeof FakeCore>[0], writesEnabled: boolean, fn: (core: FakeCore, client: QrcClient, read: (c: string, k: readonly string[]) => Promise<ControlRead>) => Promise<void>) {
  const core = new FakeCore(coreOpts);
  await core.start();
  const { log } = testLogger();
  const client = new QrcClient({ host: "127.0.0.1", port: core.port, keepaliveMs: 60_000, writesEnabled, log: (l, m) => log(l, m) });
  await client.start();
  const read = async (component: string, controls: readonly string[]): Promise<ControlRead> => (await client.componentGet(component, controls)).Controls ?? [];
  try {
    await fn(core, client, read);
  } finally {
    client.stop();
    await core.stop();
  }
}

const setFrames = (core: FakeCore) => core.received.filter((f) => f.method === "Component.Set");

describe("the source model (pure)", () => {
  it("maps mic1/mic2/verb directly and sonos/booth/hdmi to input.5.gain only when routed", () => {
    assert.deepEqual(leverForSource("mic1", null), { control: "input.1.gain" });
    assert.deepEqual(leverForSource("mic2", 3), { control: "input.2.gain" });
    assert.deepEqual(leverForSource("verb", 2), { control: "input.8.gain" });
    assert.deepEqual(leverForSource("sonos", 1), { control: "input.5.gain" });
    assert.deepEqual(leverForSource("booth", 1), { notRouted: true, routed: "sonos" });
    assert.deepEqual(leverForSource("hdmi", 3), { control: "input.5.gain" });
    assert.deepEqual(leverForSource("hdmi", "3"), { control: "input.5.gain" }, "a string select value still resolves");
    assert.deepEqual(leverForSource("sonos", null), { notRouted: true, routed: null });
    assert.deepEqual(leverForSource("sonos", 7), { notRouted: true, routed: null }, "an unmapped input (3/4/6/7 legacy) routes nobody");
    assert.equal(routedSource(2), "booth");
    assert.equal(routedSource(4), null);
  });

  it("every control a source can ever write is a SCENE_LEVER on the Inside Mixer (the WARN-1 intersection bounds sources too)", () => {
    for (const k of SOURCE_CONTROLS) assert.ok(isLever(SOURCE_MIXER, k), `${SOURCE_MIXER}/${k} is not a lever`);
    for (const s of SOURCE_KEYS) {
      for (const sel of [1, 2, 3, null]) {
        const l = leverForSource(s, sel);
        if ("control" in l) assert.ok(SOURCE_CONTROLS.includes(l.control));
      }
    }
  });

  it("parseRanges drops malformed rows and defaults a bad step", () => {
    const m = parseRanges([...RANGES, { source: "amp", min_db: 0, max_db: 1 }, { source: "hdmi", min_db: 5, max_db: 1 }, { source: "mic1", min_db: -50, max_db: -40 }]);
    assert.equal(m.size, 5, "amp (unknown) + hdmi (min ≥ max) dropped; the duplicate mic1 overwrote the first");
    assert.deepEqual(m.get("mic1"), { source: "mic1", min_db: -50, max_db: -40, step_db: 1.5 });
    assert.equal(parseRanges([{ source: "verb", min_db: 0, max_db: 5, step_db: "x" }]).get("verb")?.step_db, 1.5);
    assert.equal(parseRanges("nope").size, 0);
  });

  it("decideSourceWrite: refuses out_of_range (never caps), bounds a caller delta to one step, direction wins the sign", () => {
    const r = parseRanges(RANGES);
    const up = decideSourceWrite({ kind: "source_nudge", payload: { source: "mic1", direction: "up" } }, r.get("mic1"), 1, -30);
    assert.deepEqual(up, { ok: true, control: "input.1.gain", current: -30, target: -28.5, ramp: 0.5 });
    const big = decideSourceWrite({ kind: "source_nudge", payload: { source: "mic1", direction: "down", delta_db: 40 } }, r.get("mic1"), 1, -30);
    assert.deepEqual(big, { ok: true, control: "input.1.gain", current: -30, target: -31.5, ramp: 0.5 }, "delta_db 40 is bounded to the 1.5 step; direction down");
    const signed = decideSourceWrite({ kind: "source_nudge", payload: { source: "mic1", direction: "down", delta_db: 1 } }, r.get("mic1"), 1, -30);
    assert.equal((signed as { target: number }).target, -31, "a smaller delta is honoured; its own sign is ignored (direction wins)");
    const out = decideSourceWrite({ kind: "source_nudge", payload: { source: "mic2", direction: "up" } }, r.get("mic2"), 1, -30);
    assert.equal(out.ok, false);
    assert.equal((out as { reason: string }).reason, "out_of_range");
    assert.deepEqual((out as { current: number; target: number; range: { min_db: number; max_db: number } }).target, -28.5);
    const noRange = decideSourceWrite({ kind: "source_nudge", payload: { source: "hdmi", direction: "up" } }, undefined, 3, 0);
    assert.equal((noRange as { reason: string }).reason, "range_not_set");
    const notRouted = decideSourceWrite({ kind: "source_nudge", payload: { source: "booth", direction: "up" } }, r.get("booth"), 1, 0);
    assert.equal((notRouted as { reason: string }).reason, "not_routed");
    assert.equal((notRouted as { routed: string }).routed, "sonos");
    const unset = decideSourceWrite({ kind: "source_preset", payload: { source: "sonos", level: "med" }, source_preset_gain: null }, r.get("sonos"), 1, 0);
    assert.equal((unset as { reason: string }).reason, "preset_not_set");
    const presetOut = decideSourceWrite({ kind: "source_preset", payload: { source: "sonos", level: "high" }, source_preset_gain: 9 }, r.get("sonos"), 1, 0);
    assert.equal((presetOut as { reason: string }).reason, "out_of_range", "an authored preset outside the owner's range is refused, not capped");
    const preset = decideSourceWrite({ kind: "source_preset", payload: { source: "sonos", level: "high" }, source_preset_gain: 3 }, r.get("sonos"), 1, 0);
    assert.deepEqual(preset, { ok: true, control: "input.5.gain", current: 0, target: 3, ramp: 2 });
    const noRead = decideSourceWrite({ kind: "source_nudge", payload: { source: "mic1", direction: "up" } }, r.get("mic1"), 1, null);
    assert.equal((noRead as { reason: string }).reason, "read_failed", "a nudge is a delta — no base, no write");
  });
});

describe("on the wire: nudges + presets", () => {
  it("an OUT-OF-RANGE nudge is refused with ZERO Component.Set frames (the read happened, nothing was written)", async () => {
    await withCore({}, true, async (core, client, read) => {
      const r = await executeCommand(cmd({ payload: { source: "mic2", direction: "up", armed_by: ARM } }), { writer: client, writesEnabled: true, sleep: noSleep, readControls: read });
      assert.equal(r.status, "error");
      assert.equal(r.result.reason, "out_of_range");
      assert.equal(r.result.current, -30);
      assert.equal(r.result.target, -28.5);
      assert.deepEqual((r.result.range as { min_db: number; max_db: number }).max_db, -29.5);
      assert.equal(core.writes.length, 0, "ZERO writes");
      assert.equal(setFrames(core).length, 0, "no Component.Set frame ever reached the socket");
      assert.ok(core.received.some((f) => f.method === "Component.Get"), "the router + gain WERE read (Component.Get)");
      for (const m of core.methodsSeen()) assert.ok(READ_ONLY_METHODS.has(m), `non-read method on a refused nudge: ${m}`);
      assert.equal(r.baseline, undefined);
    });
  });

  it("an IN-RANGE nudge lands exactly ONE frame: input.1.gain = current + step with Ramp 0.5, and never touches the baseline", async () => {
    await withCore({}, true, async (core, client, read) => {
      const r = await executeCommand(cmd({ payload: { source: "mic1", direction: "up", armed_by: ARM } }), { writer: client, writesEnabled: true, sleep: noSleep, readControls: read });
      assert.equal(r.status, "done", JSON.stringify(r.result));
      assert.deepEqual(core.writes.map((w) => ({ component: w.component, controls: w.controls })), [
        { component: "Inside Mixer", controls: [{ Name: "input.1.gain", Value: -28.5, Ramp: 0.5 }] },
      ]);
      assert.equal(setFrames(core).length, 1);
      assert.equal(r.result.current, -30);
      assert.equal(r.result.target, -28.5);
      assert.equal(r.baseline, undefined, "a nudge is a delta ON the baseline — never recorded as one");
      for (const m of core.methodsSeen()) assert.ok(READ_ONLY_METHODS.has(m) || WRITE_METHODS.has(m), m);
      // down from the same read: the fixture is replayed, so current is still -30
      const r2 = await executeCommand(cmd({ id: "s2", payload: { source: "mic1", direction: "down", armed_by: ARM } }), { writer: client, writesEnabled: true, sleep: noSleep, readControls: read });
      assert.equal(r2.status, "done");
      assert.deepEqual(core.writes[1].controls, [{ Name: "input.1.gain", Value: -31.5, Ramp: 0.5 }]);
    });
  });

  it("a source the router is NOT on is refused `not_routed` with zero frames; the routed one writes input.5.gain", async () => {
    await withCore({}, true, async (core, client, read) => {
      // fixture: Inside Router_8x8 select.1 = 1 → Sonos is routed, Booth is not
      const booth = await executeCommand(cmd({ payload: { source: "booth", direction: "up", armed_by: ARM } }), { writer: client, writesEnabled: true, sleep: noSleep, readControls: read });
      assert.equal(booth.status, "error");
      assert.equal(booth.result.reason, "not_routed");
      assert.equal(booth.result.routed, "sonos");
      assert.equal(core.writes.length, 0);
      const sonos = await executeCommand(cmd({ payload: { source: "sonos", direction: "up", armed_by: ARM } }), { writer: client, writesEnabled: true, sleep: noSleep, readControls: read });
      assert.equal(sonos.status, "done", JSON.stringify(sonos.result));
      assert.deepEqual(core.writes.map((w) => w.controls), [[{ Name: "input.5.gain", Value: 1.5, Ramp: 0.5 }]]);
    });
  });

  it("no range row ⇒ `range_not_set`, zero frames — even for a routed, readable source", async () => {
    await withCore({}, true, async (core, client, read) => {
      const r = await executeCommand(cmd({ payload: { source: "hdmi", direction: "up", armed_by: ARM }, ranges: [] }), { writer: client, writesEnabled: true, sleep: noSleep, readControls: read });
      assert.equal(r.result.reason, "range_not_set");
      const r2 = await executeCommand(cmd({ payload: { source: "mic1", direction: "up", armed_by: ARM }, ranges: null }), { writer: client, writesEnabled: true, sleep: noSleep, readControls: read });
      assert.equal(r2.result.reason, "range_not_set");
      assert.equal(core.writes.length, 0);
    });
  });

  it("a source PRESET writes one frame with Ramp 2 and yields a MERGE baseline for that lever; unset ⇒ preset_not_set", async () => {
    await withCore({}, true, async (core, client, read) => {
      const r = await executeCommand(cmd({ kind: "source_preset", payload: { source: "verb", level: "med", armed_by: ARM }, source_preset_gain: 7 }), { writer: client, writesEnabled: true, sleep: noSleep, readControls: read });
      assert.equal(r.status, "done", JSON.stringify(r.result));
      assert.deepEqual(core.writes.map((w) => w.controls), [[{ Name: "input.8.gain", Value: 7, Ramp: 2 }]]);
      assert.deepEqual(r.baseline, { levers: { "Inside Mixer|input.8.gain": 7 }, replace: false });
      const unset = await executeCommand(cmd({ kind: "source_preset", payload: { source: "verb", level: "low", armed_by: ARM }, source_preset_gain: null }), { writer: client, writesEnabled: true, sleep: noSleep, readControls: read });
      assert.equal(unset.result.reason, "preset_not_set");
      assert.equal(core.writes.length, 1);
    });
  });

  it("both gates still govern the source kinds: closed ⇒ writes_disabled before any read", async () => {
    await withCore({}, false, async (core, client, read) => {
      const r = await executeCommand(cmd({ payload: { source: "mic1", direction: "up", armed_by: ARM } }), { writer: client, writesEnabled: false, sleep: noSleep, readControls: read });
      assert.equal(r.result.reason, "writes_disabled");
      assert.equal(core.writes.length, 0);
      assert.ok(!core.received.some((f) => f.method === "Component.Get" && (f.params as { Name: string }).Name === "Inside Mixer"), "the gain was never even read");
    });
    await withCore({}, true, async (core, client, read) => {
      const r = await executeCommand(cmd({ payload: { source: "mic1", direction: "up", armed_by: "someone-else" } }), { writer: client, writesEnabled: true, sleep: noSleep, readControls: read });
      assert.equal(r.result.reason, "writes_disabled");
      assert.equal(core.writes.length, 0);
    });
  });

  it("a nudge with no live read seam is refused `read_failed`, zero frames", async () => {
    await withCore({}, true, async (core, client) => {
      const r = await executeCommand(cmd({ payload: { source: "mic1", direction: "up", armed_by: ARM } }), { writer: client, writesEnabled: true, sleep: noSleep });
      assert.equal(r.result.reason, "read_failed");
      assert.equal(core.writes.length, 0);
    });
  });
});

describe("recall: the owner's range wins over a stale capture (clamped + reported), and the baseline is REPLACED", () => {
  const PAYLOAD = {
    controls: [
      { component: "Inside Router_8x8", control: "select.1", value: 2, string: "Booth", position: 0 }, // the scene routes BOOTH
      { component: "Inside Mixer", control: "output.1.gain", value: -20, string: "-20dB", position: 0.6 },
      { component: "Inside Mixer", control: "input.1.gain", value: -20, string: "-20dB", position: 0.5 }, // mic1 range [-36,-24] → clamped to -24
      { component: "Inside Mixer", control: "input.2.gain", value: -30, string: "-30dB", position: 0.5 }, // mic2 range [-31,-29.5] → inside, untouched
      { component: "Inside Mixer", control: "input.5.gain", value: 9, string: "9dB", position: 0.9 }, // booth range [-6,6] → clamped to 6 (input 5 = the scene's routed source)
      { component: "Inside Mixer", control: "input.8.gain", value: 12, string: "12dB", position: 1 }, // verb range [4,10] → clamped to 10
      { component: "Patio Mixer", control: "output.1.gain", value: -99, string: "-99dB", position: 0 }, // not a source: never ranged
    ],
  };

  it("clampRecallToRanges (pure) clamps only source gains, resolving input 5 through the SCENE's select.1", () => {
    const steps = planRecall(PAYLOAD, 3);
    const clamped = clampRecallToRanges(steps, PAYLOAD, parseRanges(RANGES));
    assert.deepEqual(clamped.map((c) => `${c.source}:${c.control}:${c.captured}→${c.written}`), ["mic1:input.1.gain:-20→-24", "booth:input.5.gain:9→6", "verb:input.8.gain:12→10"]);
    const gains = steps.find((s) => s.step === "gains" && s.component === "Inside Mixer")!.controls;
    assert.deepEqual(gains.map((c) => [c.name, c.value]), [["output.1.gain", -20], ["input.1.gain", -24], ["input.2.gain", -30], ["input.5.gain", 6], ["input.8.gain", 10]]);
    assert.equal(steps.find((s) => s.step === "gains" && s.component === "Patio Mixer")!.controls[0].value, -99, "non-source gains pass through");
    assert.deepEqual(clampRecallToRanges(planRecall(PAYLOAD, 3), PAYLOAD, new Map()), [], "no ranges ⇒ nothing clamped");
    const b = baselineFromSteps(steps);
    assert.equal(b["Inside Mixer|input.1.gain"], -24, "the baseline carries the WRITTEN value");
    assert.equal(b["Inside Router_8x8|select.1"], 2);
  });

  it("on the wire: the clamped values are what reach the Core, result.clamped names each one, baseline replace=true", async () => {
    await withCore({}, true, async (core, client) => {
      const r = await executeCommand(cmd({ kind: "recall_scene", payload: { scene_id: "a0d10000-0000-4000-8000-000000000004", armed_by: ARM }, scene_name: "TRIVIA", scene_payload: PAYLOAD, scene_ramp: 3 }), { writer: client, writesEnabled: true, sleep: noSleep });
      assert.equal(r.status, "done", JSON.stringify(r.result));
      const clamped = r.result.clamped as Array<{ source: string; written: number }>;
      assert.deepEqual(clamped.map((c) => `${c.source}=${c.written}`), ["mic1=-24", "booth=6", "verb=10"]);
      const gainsFrame = core.writes.find((w) => w.component === "Inside Mixer" && w.controls.some((c) => c.Name === "input.1.gain"))!;
      assert.deepEqual(gainsFrame.controls.map((c) => [c.Name, c.Value, c.Ramp]), [["output.1.gain", -20, 3], ["input.1.gain", -24, 3], ["input.2.gain", -30, 3], ["input.5.gain", 6, 3], ["input.8.gain", 10, 3]]);
      assert.equal(r.baseline?.replace, true);
      assert.equal(r.baseline?.levers["Inside Mixer|input.5.gain"], 6);
      assert.equal(r.baseline?.levers["Patio Mixer|output.1.gain"], -99);
    });
  });

  it("a zone preset yields a MERGE baseline of its one lever", async () => {
    await withCore({}, true, async (core, client) => {
      const r = await executeCommand(cmd({ kind: "zone_preset", payload: { zone: "patio", level: "low", armed_by: ARM }, preset_gain: -35.5, preset_ramp: 2 }), { writer: client, writesEnabled: true, sleep: noSleep });
      assert.equal(r.status, "done");
      assert.deepEqual(r.baseline, { levers: { "Patio Mixer|output.1.gain": -35.5 }, replace: false });
      assert.equal(core.writes.length, 1);
    });
  });

  it("the loop posts the baseline through the api after a done row (and never for a nudge)", async () => {
    await withCore({}, true, async (core, client) => {
      const baselines: Array<{ levers: Record<string, unknown>; replace: boolean }> = [];
      let served = false;
      const api: CommandApi = {
        async take() {
          if (served) return { ok: true, status: 200, commands: [] };
          served = true;
          return {
            ok: true,
            status: 200,
            commands: [
              cmd({ id: "p1", kind: "source_preset", payload: { source: "mic1", level: "med", armed_by: ARM }, source_preset_gain: -26 }),
              cmd({ id: "n1", payload: { source: "mic1", direction: "up", armed_by: ARM } }),
            ] as QueuedCommand[],
          };
        },
        async finish(): Promise<ReportResult> { return { ok: true, status: 204 }; },
        async setState(): Promise<ReportResult> { return { ok: true, status: 204 }; },
        async setBaseline(_v, levers, replace): Promise<ReportResult> { baselines.push({ levers, replace }); return { ok: true, status: 204 }; },
      };
      const { log } = testLogger();
      const loop = startCommandLoop({ api, writer: client, config: { venueId: VENUE, agentId: "t", writesEnabled: true }, log, intervalMs: 60_000, sleep: noSleep, captureOptions: { config: parseConfig({ coreHost: "127.0.0.1", venueId: VENUE }), client, sender: null } });
      const n = await loop.tick();
      loop.stop();
      assert.equal(n, 2);
      assert.equal(core.writes.length, 2, "preset + nudge both wrote");
      assert.deepEqual(baselines, [{ levers: { "Inside Mixer|input.1.gain": -26 }, replace: false }], "only the preset stamped the baseline");
    });
  });
});

describe("a NORMAL capture seeds the ranges (captured ± 6, never overwriting); other scenes never seed", () => {
  const cfg = () => parseConfig({ coreHost: "127.0.0.1", venueId: VENUE, agentId: "t", supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon", deviceToken: "tok" });

  it("seedRangesFromCapture (pure): the routed source only, clamped to [-100, 10]", () => {
    const seed = seedRangesFromCapture([
      { component: "Inside Router_8x8", control: "select.1", value: 3 },
      { component: "Inside Mixer", control: "input.1.gain", value: -30 },
      { component: "Inside Mixer", control: "input.2.gain", value: -98 },
      { component: "Inside Mixer", control: "input.5.gain", value: 2 },
      { component: "Inside Mixer", control: "input.8.gain", value: 8 },
    ]);
    assert.deepEqual(seed, [
      { source: "mic1", min_db: -36, max_db: -24 },
      { source: "mic2", min_db: -100, max_db: -92 },
      { source: "hdmi", min_db: -4, max_db: 8 },
      { source: "verb", min_db: 2, max_db: 10 },
    ]);
    assert.deepEqual(seedRangesFromCapture([{ component: "Inside Mixer", control: "input.5.gain", value: 0 }]), [], "input 5 with no readable router → nobody is seeded from it");
  });

  it("captureScene NORMAL calls the seeder with the fixture's four readable sources; TRIVIA never calls it", async () => {
    const core = new FakeCore({});
    await core.start();
    const client = new QrcClient({ host: "127.0.0.1", port: core.port, keepaliveMs: 60_000 });
    await client.start();
    try {
      const seeds: Array<{ venue: string; ranges: unknown[] }> = [];
      const seeder = async (venue: string, ranges: Array<{ source: string; min_db: number; max_db: number }>) => {
        seeds.push({ venue, ranges });
        return { ok: true, status: 200, seeded: ranges.map((r) => r.source) };
      };
      const sender = async () => ({ ok: true, status: 200, sceneId: "a0d10000-0000-4000-8000-000000000001" });
      const errs: string[] = [];
      const r = await captureScene({ sceneName: "normal", favoriteOverride: null, dryRun: false, config: cfg(), client, sender, rangeSeeder: seeder, out: () => {}, err: (l) => errs.push(l) });
      assert.equal(r.stored, true);
      assert.equal(seeds.length, 1);
      assert.equal(seeds[0].venue, VENUE);
      // fixture: mic1 -30, mic2 -30, select.1 = 1 (Sonos) with input.5 = 0, verb = 10 (clamped top)
      assert.deepEqual(seeds[0].ranges, [
        { source: "mic1", min_db: -36, max_db: -24 },
        { source: "mic2", min_db: -36, max_db: -24 },
        { source: "sonos", min_db: -6, max_db: 6 },
        { source: "verb", min_db: 4, max_db: 10 },
      ]);
      assert.ok(errs.some((l) => /ranges seeded for mic1, mic2, sonos, verb/.test(l)), errs.join("\n"));
      const r2 = await captureScene({ sceneName: "TRIVIA", favoriteOverride: null, dryRun: false, config: cfg(), client, sender, rangeSeeder: seeder, out: () => {}, err: () => {} });
      assert.equal(r2.stored, true);
      assert.equal(seeds.length, 1, "a non-NORMAL capture never seeds");
      // a dry run / failed store never seeds either
      await captureScene({ sceneName: "NORMAL", favoriteOverride: null, dryRun: true, config: cfg(), client, sender, rangeSeeder: seeder, out: () => {}, err: () => {} });
      await captureScene({ sceneName: "NORMAL", favoriteOverride: null, dryRun: false, config: cfg(), client, sender: async () => ({ ok: false, status: 401, error: "no" }), rangeSeeder: seeder, out: () => {}, err: () => {} });
      assert.equal(seeds.length, 1);
      assert.equal(core.writes.length, 0, "capture + seed never write to the Core");
      for (const m of core.methodsSeen()) assert.ok(READ_ONLY_METHODS.has(m), m);
    } finally {
      client.stop();
      await core.stop();
    }
  });
});
