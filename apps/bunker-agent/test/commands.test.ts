/**
 * PR B — the gated write lane. Proves, against the fake Core's RECORDING Component.Set:
 *   • gate (a) closed  ⇒ zero writes on the wire + result.reason 'writes_disabled'
 *   • gate (b) closed  ⇒ zero writes + 'writes_disabled' (unarmed / expired / mismatched arm)
 *   • both open        ⇒ the EXACT ordered write list for a fixture scene (mute → gains+ramp →
 *                        switch → unmute), and the audio_state stamp
 *   • a mid-scene fault ⇒ stop at the failing step, partial list in result, no later writes
 *   • the one-off kinds plan the right single write; a bad payload is refused without a write
 *   • capture_scene runs with BOTH gates closed (it is a read)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { armMatches, executeCommand, parseVideoRead, planRecall, planSimple, startCommandLoop, videoStepsForNames, type TakenCommand } from "../src/commands.js";
import { QrcClient, READ_ONLY_METHODS, WRITE_METHODS } from "../src/qrc.js";
import type { CommandApi, QueuedCommand, ReportResult } from "../src/report.js";
import { FakeCore, testLogger } from "./fakeCore.js";

const VENUE = "11111111-1111-1111-1111-111111111111";
const SCENE_ID = "a0d10000-0000-4000-8000-000000000004";

/** A captured TRIVIA scene in the exact shape PR A's capture stores (controls = flat array). */
const TRIVIA_PAYLOAD = {
  design_name: "BunkerClub_v03.20260329",
  controls: [
    { component: "Inside Router_8x8", control: "select.1", value: 1, string: "Sonos", position: 0 },
    { component: "Patio Router_8x8", control: "select.1", value: 1, string: "Sonos", position: 0 },
    { component: "Inside Mixer", control: "output.1.gain", value: -18.5, string: "-18.5dB", position: 0.6 },
    { component: "Inside Mixer", control: "output.1.mute", value: false, string: "unmuted", position: 0 },
    { component: "Inside Mixer", control: "input.1.mute", value: false, string: "unmuted", position: 0 },
    { component: "Inside Mixer", control: "input.2.mute", value: true, string: "muted", position: 1 },
    { component: "Patio Mixer", control: "output.1.gain", value: -30, string: "-30dB", position: 0.4 },
    { component: "Lush_Reverb_Effect", control: "bypass", value: true, string: "bypassed", position: 1 },
    { component: "Mixer_8x8", control: "output.2.gain", value: null, string: null, position: null }, // never read → never written
  ],
  sonos_favorite: 3,
  video: { out1: "Bunker Feed", out2: "Bunker Feed" },
};

function cmd(over: Partial<TakenCommand> = {}): TakenCommand {
  return {
    id: "c1",
    kind: "recall_scene",
    payload: { scene_id: SCENE_ID, armed_by: "owner@x#abc123" },
    requested_by: "owner@x",
    requested_at: new Date().toISOString(),
    scene_name: "TRIVIA",
    scene_payload: TRIVIA_PAYLOAD,
    scene_ramp: 3,
    writes_armed_by: "owner@x#abc123",
    writes_arm_valid: true,
    ...over,
  };
}

async function withCore(coreOpts: ConstructorParameters<typeof FakeCore>[0], writesEnabled: boolean, fn: (core: FakeCore, client: QrcClient) => Promise<void>) {
  const core = new FakeCore(coreOpts);
  await core.start();
  const { log } = testLogger();
  const client = new QrcClient({ host: "127.0.0.1", port: core.port, keepaliveMs: 60_000, writesEnabled, log: (l, m) => log(l, m) });
  await client.start();
  try {
    await fn(core, client);
  } finally {
    client.stop();
    await core.stop();
  }
}

const noSleep = async () => {};

describe("gate (a): config.writesEnabled", () => {
  it("closed ⇒ the client has no write path and the executor refuses BEFORE any wire traffic", async () => {
    await withCore({}, false, async (core, client) => {
      assert.equal(client.canWrite, false);
      await assert.rejects(() => client.componentSet("Inside Mixer", [{ name: "output.1.mute", value: true }]), /writes are disabled/);
      const r = await executeCommand(cmd(), { writer: client, writesEnabled: false, sleep: noSleep });
      assert.equal(r.status, "error");
      assert.equal(r.result.reason, "writes_disabled");
      assert.equal(r.result.gate, "agent");
      assert.equal(core.writes.length, 0, "ZERO Component.Set on the wire with the agent gate closed");
      assert.ok(!core.received.some((f) => f.method === "Component.Set"), "no Component.Set frame ever sent");
      for (const m of core.methodsSeen()) assert.ok(READ_ONLY_METHODS.has(m), `non-read method with gate closed: ${m}`);
    });
  });

  it("the allow-lists are disjoint and the write list is exactly Component.Set", () => {
    assert.deepEqual([...WRITE_METHODS], ["Component.Set"]);
    for (const m of WRITE_METHODS) assert.ok(!READ_ONLY_METHODS.has(m));
  });
});

describe("gate (b): the platform ARM WRITES stamp", () => {
  it("unarmed / expired ⇒ writes_disabled, zero writes", async () => {
    await withCore({}, true, async (core, client) => {
      const r = await executeCommand(cmd({ writes_arm_valid: false }), { writer: client, writesEnabled: true, sleep: noSleep });
      assert.equal(r.status, "error");
      assert.equal(r.result.reason, "writes_disabled");
      assert.equal(r.result.gate, "platform");
      assert.equal(core.writes.length, 0);
    });
  });

  it("a press made under a DIFFERENT arm than the current one ⇒ writes_disabled, zero writes", async () => {
    await withCore({}, true, async (core, client) => {
      const r = await executeCommand(cmd({ payload: { scene_id: SCENE_ID, armed_by: "owner@x#OLD" } }), { writer: client, writesEnabled: true, sleep: noSleep });
      assert.equal(r.status, "error");
      assert.equal(r.result.reason, "writes_disabled");
      assert.equal(core.writes.length, 0);
    });
  });

  it("armMatches is exact (no arm, empty arm, missing armed_by all fail)", () => {
    assert.equal(armMatches({ payload: { armed_by: "a" }, writes_armed_by: "a", writes_arm_valid: true }), true);
    assert.equal(armMatches({ payload: { armed_by: "a" }, writes_armed_by: "a", writes_arm_valid: false }), false);
    assert.equal(armMatches({ payload: {}, writes_armed_by: "a", writes_arm_valid: true }), false);
    assert.equal(armMatches({ payload: { armed_by: "" }, writes_armed_by: "", writes_arm_valid: true }), false);
    assert.equal(armMatches({ payload: { armed_by: null }, writes_armed_by: null, writes_arm_valid: true }), false);
  });
});

describe("both gates open: recall = the exact ordered write list", () => {
  it("plans mute → gains(ramp) → switch → unmute from a captured payload, skipping null values", () => {
    const steps = planRecall(TRIVIA_PAYLOAD, 3);
    assert.deepEqual(steps.map((s) => `${s.step}:${s.component}`), [
      "mute:Inside Mixer",
      "mute:Patio Mixer",
      "gains:Inside Mixer",
      "gains:Patio Mixer",
      "switch:Inside Router_8x8",
      "switch:Patio Router_8x8",
      "switch:Inside Mixer",
      "switch:Lush_Reverb_Effect",
      "unmute:Inside Mixer",
      "unmute:Patio Mixer",
    ]);
    assert.deepEqual(steps[0].controls, [{ name: "output.1.mute", value: true }]);
    assert.deepEqual(steps[2].controls, [{ name: "output.1.gain", value: -18.5, ramp: 3 }]);
    assert.deepEqual(steps[6].controls, [{ name: "input.1.mute", value: false }, { name: "input.2.mute", value: true }]);
    assert.deepEqual(steps[8].controls, [{ name: "output.1.mute", value: false }]);
    // Patio never captured its mute → unmuted explicitly (we muted it in step 1)
    assert.deepEqual(steps[9].controls, [{ name: "output.1.mute", value: false }]);
    assert.ok(!steps.some((s) => s.component === "Mixer_8x8"), "a null capture is never written");
  });

  it("executes that plan on the wire in order, waits the ramp before unmuting, stamps the scene", async () => {
    await withCore({}, true, async (core, client) => {
      const slept: number[] = [];
      const r = await executeCommand(cmd(), { writer: client, writesEnabled: true, sleep: async (ms) => { slept.push(ms); } });
      assert.equal(r.status, "done", JSON.stringify(r.result));
      assert.equal(r.activeSceneId, SCENE_ID);
      assert.deepEqual(slept, [3000], "waited exactly the ramp once, before the first unmute");
      assert.deepEqual(
        core.writes.map((w) => ({ component: w.component, controls: w.controls })),
        [
          { component: "Inside Mixer", controls: [{ Name: "output.1.mute", Value: true }] },
          { component: "Patio Mixer", controls: [{ Name: "output.1.mute", Value: true }] },
          { component: "Inside Mixer", controls: [{ Name: "output.1.gain", Value: -18.5, Ramp: 3 }] },
          { component: "Patio Mixer", controls: [{ Name: "output.1.gain", Value: -30, Ramp: 3 }] },
          { component: "Inside Router_8x8", controls: [{ Name: "select.1", Value: 1 }] },
          { component: "Patio Router_8x8", controls: [{ Name: "select.1", Value: 1 }] },
          { component: "Inside Mixer", controls: [{ Name: "input.1.mute", Value: false }, { Name: "input.2.mute", Value: true }] },
          { component: "Lush_Reverb_Effect", controls: [{ Name: "bypass", Value: true }] },
          { component: "Inside Mixer", controls: [{ Name: "output.1.mute", Value: false }] },
          { component: "Patio Mixer", controls: [{ Name: "output.1.mute", Value: false }] },
        ],
      );
      // and the wire carried ONLY Component.Set beyond the read set
      for (const m of core.methodsSeen()) assert.ok(READ_ONLY_METHODS.has(m) || WRITE_METHODS.has(m), m);
    });
  });

  it("an uncaptured scene (empty payload) is refused without a write", async () => {
    await withCore({}, true, async (core, client) => {
      const r = await executeCommand(cmd({ scene_payload: {} }), { writer: client, writesEnabled: true, sleep: noSleep });
      assert.equal(r.status, "error");
      assert.equal(r.result.reason, "scene_not_captured");
      assert.equal(core.writes.length, 0);
    });
  });
});

describe("a mid-scene fault stops the recall and reports the partial list", () => {
  it("fails on the Patio gain step: 3 writes landed, the rest never sent, result names the failed step", async () => {
    await withCore({ failSetOnComponent: "Patio Mixer" }, true, async (core, client) => {
      const r = await executeCommand(cmd(), { writer: client, writesEnabled: true, sleep: noSleep });
      assert.equal(r.status, "error");
      assert.equal(r.result.reason, "core_error");
      const completed = r.result.completed as Array<{ step: string; component: string }>;
      // step 1 mute Inside ok, step 2 mute Patio FAILS (the fake faults on every Patio set)
      assert.deepEqual(completed.map((c) => `${c.step}:${c.component}`), ["mute:Inside Mixer"]);
      assert.equal((r.result.failed as { step: string; component: string }).component, "Patio Mixer");
      assert.equal(core.writes.length, 1, "only the writes BEFORE the fault reached the Core");
      assert.match(String(r.result.message), /simulated fault/);
    });
  });
});

describe("one-off kinds", () => {
  it("zone_preset / mic_mute / reverb_bypass / sonos_favorite / video_source plan one write each; bad payloads are refused", () => {
    assert.deepEqual(planSimple({ kind: "zone_preset", payload: { zone: "inside", level: "med" } }, -20, 2), {
      steps: [{ step: "preset", component: "Inside Mixer", controls: [{ name: "output.1.gain", value: -20, ramp: 2 }] }],
    });
    assert.deepEqual(planSimple({ kind: "zone_preset", payload: { zone: "patio", level: "high" } }, null, 2), { error: "preset patio/high is not set" });
    assert.deepEqual(planSimple({ kind: "mic_mute", payload: { mic: 2, mute: true } }, null, null), {
      steps: [{ step: "mic", component: "Inside Mixer", controls: [{ name: "input.2.mute", value: true }] }],
    });
    assert.ok("error" in planSimple({ kind: "mic_mute", payload: { mic: 3 } }, null, null));
    assert.deepEqual(planSimple({ kind: "reverb_bypass", payload: { bypass: false } }, null, null), {
      steps: [{ step: "reverb", component: "Lush_Reverb_Effect", controls: [{ name: "bypass", value: false }] }],
    });
    assert.deepEqual(planSimple({ kind: "sonos_favorite", payload: { n: 7 } }, null, null), {
      steps: [{ step: "sonos", component: "SonosSonosControl", controls: [{ name: "FavPlay 7", value: true }] }],
    });
    assert.ok("error" in planSimple({ kind: "sonos_favorite", payload: { n: 32 } }, null, null));
    assert.deepEqual(planSimple({ kind: "video_source", payload: { out: 2, source: "hdmi.3" } }, null, null), {
      steps: [{ step: "video", component: "HDMI_I/O_Bunker-Core", controls: [{ name: "hdmi.out.2.select.hdmi.3", value: true }] }],
    });
    assert.ok("error" in planSimple({ kind: "video_source", payload: { out: 2, source: "Volume" } }, null, null));
  });

  it("a zone preset writes one ramped gain when both gates are open, and nothing when not", async () => {
    await withCore({}, true, async (core, client) => {
      const c = cmd({ kind: "zone_preset", payload: { zone: "patio", level: "low", armed_by: "owner@x#abc123" }, preset_gain: -35.5, preset_ramp: 2 });
      const r = await executeCommand(c, { writer: client, writesEnabled: true, sleep: noSleep });
      assert.equal(r.status, "done");
      assert.deepEqual(core.writes.map((w) => ({ component: w.component, controls: w.controls })), [
        { component: "Patio Mixer", controls: [{ Name: "output.1.gain", Value: -35.5, Ramp: 2 }] },
      ]);
      const r2 = await executeCommand({ ...c, writes_arm_valid: false }, { writer: client, writesEnabled: true, sleep: noSleep });
      assert.equal(r2.result.reason, "writes_disabled");
      assert.equal(core.writes.length, 1);
    });
  });
});

describe("capture_scene is a READ — ungated", () => {
  it("runs with both gates closed and never writes", async () => {
    await withCore({}, false, async (core, client) => {
      let captured: string | null = null;
      const r = await executeCommand(
        cmd({ kind: "capture_scene", payload: { scene_id: SCENE_ID }, writes_arm_valid: false, writes_armed_by: null }),
        { writer: client, writesEnabled: false, sleep: noSleep, capture: async (name) => { captured = name; return { stored: true, summary: "ok", controls: 18 }; } },
      );
      assert.equal(r.status, "done");
      assert.equal(captured, "TRIVIA");
      assert.equal(core.writes.length, 0);
    });
  });
});

describe("the loop: take → execute → finish → setState", () => {
  it("finishes each row with the executor's status and stamps audio_state on a successful recall", async () => {
    await withCore({}, true, async (core, client) => {
      const finished: Array<{ id: string; status: string; reason?: unknown }> = [];
      const states: Array<{ sceneId: string | null; by: string | null; error: string | null }> = [];
      let served = false;
      const api: CommandApi = {
        async take() {
          if (served) return { ok: true, status: 200, commands: [] };
          served = true;
          return { ok: true, status: 200, commands: [cmd(), cmd({ id: "c2", writes_arm_valid: false })] as QueuedCommand[] };
        },
        async finish(id, status, result): Promise<ReportResult> {
          finished.push({ id, status, reason: result.reason });
          return { ok: true, status: 204 };
        },
        async setState(_v, sceneId, by, error): Promise<ReportResult> {
          states.push({ sceneId, by, error });
          return { ok: true, status: 204 };
        },
      };
      const { log } = testLogger();
      const loop = startCommandLoop({ api, writer: client, config: { venueId: VENUE, agentId: "test-nuc", writesEnabled: true }, log, intervalMs: 60_000, sleep: noSleep });
      const n = await loop.tick();
      loop.stop();
      assert.equal(n, 2);
      assert.deepEqual(finished, [
        { id: "c1", status: "done", reason: undefined },
        { id: "c2", status: "error", reason: "writes_disabled" },
      ]);
      assert.deepEqual(states, [
        { sceneId: SCENE_ID, by: "owner@x", error: null },
        { sceneId: null, by: null, error: "writes_disabled" },
      ]);
      assert.equal(core.writes.length, 10, "the armed recall wrote its 10 steps; the unarmed one wrote nothing");
    });
  });
});

describe("NOTE-8: video names → selectors are LEARNED from the live switcher, never hard-coded", () => {
  const read = (o1: [string | null, string | null], o2: [string | null, string | null]) => ({
    outputs: { 1: { activeName: o1[0], selected: o1[1] }, 2: { activeName: o2[0], selected: o2[1] } },
  });

  it("parseVideoRead shapes a Component.Get into active names + the one true selector per out", () => {
    const v = parseVideoRead([
      { Name: "hdmi.out.1.select.hdmi.1", Value: false }, { Name: "hdmi.out.1.select.hdmi.2", Value: true },
      { Name: "hdmi.out.1.select.active.source.name", Value: "Bunker Feed", String: "Bunker Feed" },
      { Name: "hdmi.out.2.select.avh.1", Value: true }, { Name: "hdmi.out.2.select.active.source.name", String: "Roku" },
    ]);
    assert.deepEqual(v, { outputs: { 1: { activeName: "Bunker Feed", selected: "hdmi.2" }, 2: { activeName: "Roku", selected: "avh.1" } } });
  });

  it("a captured name that some output is showing resolves to THAT selector; one nobody shows is reported, not guessed", () => {
    const r = videoStepsForNames({ out1: "Roku", out2: "Bunker Feed" }, read(["Bunker Feed", "hdmi.2"], ["Roku", "avh.1"]));
    assert.deepEqual(r.unresolved, []);
    assert.deepEqual(r.steps, [
      { step: "video", component: "HDMI_I/O_Bunker-Core", controls: [{ name: "hdmi.out.1.select.avh.1", value: true }] },
      { step: "video", component: "HDMI_I/O_Bunker-Core", controls: [{ name: "hdmi.out.2.select.hdmi.2", value: true }] },
    ]);
    const r2 = videoStepsForNames({ out1: "Booth HDMI" }, read(["Bunker Feed", "hdmi.2"], ["Bunker Feed", "hdmi.2"]));
    assert.deepEqual(r2.steps, []);
    assert.deepEqual(r2.unresolved, ["out 1: Booth HDMI"]);
    // already showing the captured name → no write at all
    assert.deepEqual(videoStepsForNames({ out1: "Bunker Feed" }, read(["Bunker Feed", "hdmi.2"], [null, null])).steps, []);
    // no read → nothing planned, nothing claimed
    assert.deepEqual(videoStepsForNames({ out1: "Roku" }, null), { steps: [], unresolved: [] });
  });

  it("a recall carries the resolved video switch before the unmute, and reports unresolved names in the result", async () => {
    await withCore({}, true, async (core, client) => {
      const r = await executeCommand(cmd({ scene_payload: { ...TRIVIA_PAYLOAD, video: { out1: "Roku", out2: "Nobody Shows This" } } }), {
        writer: client, writesEnabled: true, sleep: noSleep,
        readVideo: async () => read(["Bunker Feed", "hdmi.2"], ["Roku", "avh.1"]),
      });
      assert.equal(r.status, "done", JSON.stringify(r.result));
      assert.deepEqual(r.result.video_unresolved, ["out 2: Nobody Shows This"]);
      const names = core.writes.map((w) => `${w.component}:${w.controls.map((c) => c.Name).join(",")}`);
      const vi = names.indexOf("HDMI_I/O_Bunker-Core:hdmi.out.1.select.avh.1");
      assert.ok(vi >= 0, "the video switch was written");
      assert.ok(vi < names.lastIndexOf("Inside Mixer:output.1.mute"), "video switch lands before the unmute");
    });
  });

  it("a video_source press by NAME resolves live too; unknown name ⇒ video_unresolved, zero writes", async () => {
    await withCore({}, true, async (core, client) => {
      const byName = cmd({ kind: "video_source", payload: { out: 1, source: "Roku", armed_by: "owner@x#abc123" } });
      const live = async () => read(["Bunker Feed", "hdmi.2"], ["Roku", "avh.1"]);
      const r = await executeCommand(byName, { writer: client, writesEnabled: true, sleep: noSleep, readVideo: live });
      assert.equal(r.status, "done");
      assert.deepEqual(core.writes.map((w) => w.controls[0].Name), ["hdmi.out.1.select.avh.1"]);
      const r2 = await executeCommand({ ...byName, payload: { ...byName.payload, source: "Booth HDMI" } }, { writer: client, writesEnabled: true, sleep: noSleep, readVideo: live });
      assert.equal(r2.status, "error");
      assert.equal(r2.result.reason, "video_unresolved");
      assert.equal(core.writes.length, 1);
    });
  });
});
