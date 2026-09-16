/**
 * COMMANDS (PR B) — the agent's gated write lane.
 *
 * Staff presses land as rows in `audio_commands` (0068). The loop below polls the queue through
 * the token-gated RPC `audio_agent_take_commands` at ~1 Hz (DECISION, 0068 header: a polled
 * table rather than a realtime channel — durable, auditable, no anon grant on the table) and
 * executes each row in order.
 *
 * THE DOUBLE GATE (load-bearing — nothing writes to the Core unless BOTH are open):
 *   (a) `config.writesEnabled === true`   — the client was constructed with the write path on
 *   (b) `payload.armed_by === writes_armed_by && writes_arm_valid` — an admin pressed ARM WRITES
 *       in the scene editor tonight (the RPC evaluates the 04:00 rollover server-side)
 * With either closed: the row is marked `error` with `result.reason = 'writes_disabled'` and
 * NOTHING is put on the wire. `capture_scene` is a READ and is never gated.
 *
 * Recall ordering (card §1, the pop-free rule): mute the mixer outputs the scene touches →
 * set gains with Ramp: scene.ramp_seconds → switch routers / effects / mic mutes → wait out the
 * ramp → restore the scene's output mutes (= unmute). One Component.Set per component per step.
 * On any error mid-scene: STOP, report the completed + failed steps in `result`, mark `error`.
 *
 * Idempotency: every step is an absolute Component.Set (never a delta), so a retried row
 * (the RPC re-offers a `running` row older than 120 s) converges on the same room.
 */
import { captureScene, type CaptureRunOptions } from "./capture-run.js";
import type { AgentConfig } from "./config.js";
import type { Logger } from "./log.js";
import type { CommandApi, QueuedCommand } from "./report.js";

/** The write surface the executor needs — QrcClient (PR B) satisfies it; tests inject a recorder. */
export interface ControlWriter {
  readonly canWrite: boolean;
  componentSet(component: string, controls: ReadonlyArray<{ name: string; value: unknown; ramp?: number }>): Promise<void>;
}

export interface WriteStep {
  step: "mute" | "gains" | "switch" | "unmute" | "preset" | "mic" | "reverb" | "sonos" | "video";
  component: string;
  controls: Array<{ name: string; value: unknown; ramp?: number }>;
}

export interface ExecResult {
  status: "done" | "error";
  result: Record<string, unknown>;
  /** the scene id to stamp into audio_state on a successful recall */
  activeSceneId?: string | null;
}

export interface ExecContext {
  writer: ControlWriter;
  writesEnabled: boolean;
  /** injectable clock for the ramp wait (tests pass a no-op) */
  sleep?: (ms: number) => Promise<void>;
  /** injectable capture (tests pass a stub); production = capture-run.captureScene */
  capture?: (sceneName: string) => Promise<{ stored: boolean; summary: string; controls: number; error?: string }>;
  /** injectable live read of the HDMI switcher (NOTE-8 name→selector); production = Component.Get */
  readVideo?: () => Promise<VideoRead | null>;
}

const ZONE_MIXER: Record<string, string> = { inside: "Inside Mixer", patio: "Patio Mixer" };
const VIDEO_SOURCES = new Set(["hdmi.1", "hdmi.2", "hdmi.3", "avh.1"]);
export const HDMI_COMPONENT = "HDMI_I/O_Bunker-Core";
const HDMI_OUTS = [1, 2] as const;
/** The controls a video resolve reads: every selector boolean + the active source NAME per out. */
export const HDMI_READ_CONTROLS: readonly string[] = HDMI_OUTS.flatMap((o) => [...VIDEO_SOURCES].map((k) => `hdmi.out.${o}.select.${k}`).concat(`hdmi.out.${o}.select.active.source.name`));

/** What one Component.Get of the HDMI switcher tells us right now. */
export interface VideoRead {
  outputs: Record<1 | 2, { activeName: string | null; selected: string | null }>;
}

/**
 * NOTE-8 (reviewer): a capture stores the ACTIVE SOURCE NAME per output ("Bunker Feed"), while
 * the Core switches on selector BOOLEANS (hdmi.out.N.select.hdmi.{1,2,3} / avh.1). The name→selector
 * mapping is NEVER hard-coded: it is learned from the live read — any output currently showing
 * name X with selector Y true teaches X ↔ Y. A name nobody is showing right now cannot be
 * resolved and is reported (not guessed, not failed-whole). Pure; tested on fixtures.
 */
export function videoStepsForNames(desired: { out1?: string | null; out2?: string | null } | undefined, read: VideoRead | null): { steps: WriteStep[]; unresolved: string[] } {
  const steps: WriteStep[] = [];
  const unresolved: string[] = [];
  if (!desired || !read) return { steps, unresolved };
  const learned = new Map<string, string>();
  for (const o of HDMI_OUTS) {
    const r = read.outputs[o];
    if (r?.activeName && r.selected) learned.set(r.activeName, r.selected);
  }
  for (const o of HDMI_OUTS) {
    const want = o === 1 ? desired.out1 : desired.out2;
    if (!want) continue;
    if (read.outputs[o]?.activeName === want) continue; // already showing it — no write
    const sel = learned.get(want);
    if (!sel) {
      unresolved.push(`out ${o}: ${want}`);
      continue;
    }
    steps.push({ step: "video", component: HDMI_COMPONENT, controls: [{ name: `hdmi.out.${o}.select.${sel}`, value: true }] });
  }
  return { steps, unresolved };
}

/** Shape a Component.Get result of HDMI_READ_CONTROLS into a VideoRead (pure). */
export function parseVideoRead(controls: ReadonlyArray<{ Name: string; Value?: unknown; String?: string }>): VideoRead {
  const out: VideoRead = { outputs: { 1: { activeName: null, selected: null }, 2: { activeName: null, selected: null } } };
  for (const c of controls) {
    const m = /^hdmi\.out\.([12])\.select\.(.+)$/.exec(c.Name);
    if (!m) continue;
    const o = Number(m[1]) as 1 | 2;
    if (m[2] === "active.source.name") out.outputs[o].activeName = typeof c.String === "string" && c.String !== "" ? c.String : typeof c.Value === "string" ? c.Value : null;
    else if (VIDEO_SOURCES.has(m[2]) && c.Value === true) out.outputs[o].selected = m[2];
  }
  return out;
}

/** Gate (b) as a pure predicate — unit-tested on its own. */
export function armMatches(cmd: Pick<QueuedCommand, "payload" | "writes_armed_by" | "writes_arm_valid">): boolean {
  const by = cmd.payload?.armed_by;
  return cmd.writes_arm_valid === true && typeof cmd.writes_armed_by === "string" && cmd.writes_armed_by !== "" && by === cmd.writes_armed_by;
}

/** Turn a captured scene payload into the ordered write plan (pure; tested on a fixture). */
export function planRecall(payload: Record<string, unknown>, rampSeconds: number): WriteStep[] {
  const controls = Array.isArray(payload.controls) ? (payload.controls as Array<{ component: string; control: string; value: unknown }>) : [];
  const gains = new Map<string, Array<{ name: string; value: unknown; ramp?: number }>>();
  const switches = new Map<string, Array<{ name: string; value: unknown }>>();
  const outputMutes = new Map<string, Array<{ name: string; value: unknown }>>();
  const add = (m: Map<string, Array<{ name: string; value: unknown; ramp?: number }>>, comp: string, c: { name: string; value: unknown; ramp?: number }) => {
    const list = m.get(comp) ?? [];
    list.push(c);
    m.set(comp, list);
  };
  for (const c of controls) {
    if (!c || typeof c.component !== "string" || typeof c.control !== "string") continue;
    if (c.value === null || c.value === undefined) continue; // never write a value we never read
    if (/^output\.\d+\.mute$/.test(c.control)) add(outputMutes, c.component, { name: c.control, value: c.value === true });
    else if (/\.gain$/.test(c.control) || c.control === "WetLevel") add(gains, c.component, { name: c.control, value: Number(c.value), ramp: rampSeconds });
    else add(switches, c.component, { name: c.control, value: c.value });
  }
  const steps: WriteStep[] = [];
  // 1. mute every mixer OUTPUT the scene touches (its gain or its mute) — the pop guard
  const touchedOutputs = new Map<string, Set<string>>();
  for (const [comp, list] of gains) for (const g of list) {
    const m = /^(output\.\d+)\.gain$/.exec(g.name);
    if (m) (touchedOutputs.get(comp) ?? touchedOutputs.set(comp, new Set()).get(comp)!).add(`${m[1]}.mute`);
  }
  for (const [comp, list] of outputMutes) for (const o of list) (touchedOutputs.get(comp) ?? touchedOutputs.set(comp, new Set()).get(comp)!).add(o.name);
  for (const [comp, names] of touchedOutputs) steps.push({ step: "mute", component: comp, controls: [...names].sort().map((name) => ({ name, value: true })) });
  // 2. gains with the ramp
  for (const [comp, list] of gains) steps.push({ step: "gains", component: comp, controls: list });
  // 3. routers / mic mutes / bypass — instant switches
  for (const [comp, list] of switches) steps.push({ step: "switch", component: comp, controls: list });
  // 4. restore the scene's output mutes (= unmute what the scene has open); outputs we muted
  //    in step 1 but the scene never captured a mute for are unmuted explicitly
  for (const [comp, names] of touchedOutputs) {
    const captured = new Map((outputMutes.get(comp) ?? []).map((o) => [o.name, o.value]));
    steps.push({ step: "unmute", component: comp, controls: [...names].sort().map((name) => ({ name, value: captured.has(name) ? captured.get(name) : false })) });
  }
  return steps;
}

/** Plan for the one-off kinds (pure). Returns null + reason when the payload is malformed. */
export function planSimple(cmd: Pick<QueuedCommand, "kind" | "payload">, presetGain: number | null, presetRamp: number | null): { steps: WriteStep[] } | { error: string } {
  const p = cmd.payload ?? {};
  switch (cmd.kind) {
    case "zone_preset": {
      const mixer = ZONE_MIXER[String(p.zone)];
      if (!mixer) return { error: `unknown zone ${String(p.zone)}` };
      if (presetGain === null || !Number.isFinite(presetGain)) return { error: `preset ${String(p.zone)}/${String(p.level)} is not set` };
      return { steps: [{ step: "preset", component: mixer, controls: [{ name: "output.1.gain", value: presetGain, ramp: presetRamp ?? 2 }] }] };
    }
    case "mic_mute": {
      const mic = Number(p.mic);
      if (mic !== 1 && mic !== 2) return { error: `unknown mic ${String(p.mic)}` };
      return { steps: [{ step: "mic", component: "Inside Mixer", controls: [{ name: `input.${mic}.mute`, value: p.mute === true }] }] };
    }
    case "reverb_bypass":
      return { steps: [{ step: "reverb", component: "Lush_Reverb_Effect", controls: [{ name: "bypass", value: p.bypass === true }] }] };
    case "sonos_favorite": {
      const n = Number(p.n);
      if (!Number.isInteger(n) || n < 1 || n > 31) return { error: `favorite ${String(p.n)} out of range` };
      return { steps: [{ step: "sonos", component: "SonosSonosControl", controls: [{ name: `FavPlay ${n}`, value: true }] }] };
    }
    case "video_source": {
      // Only a raw selector key is planned here; a source NAME is resolved live in executeCommand.
      const out = Number(p.out);
      const src = String(p.source);
      if ((out !== 1 && out !== 2) || !VIDEO_SOURCES.has(src)) return { error: `bad video selection out=${String(p.out)} source=${src}` };
      return { steps: [{ step: "video", component: HDMI_COMPONENT, controls: [{ name: `hdmi.out.${out}.select.${src}`, value: true }] }] };
    }
    default:
      return { error: `unknown command kind ${cmd.kind}` };
  }
}

export interface TakenCommand extends QueuedCommand {
  scene_payload?: Record<string, unknown> | null;
  scene_ramp?: number | null;
  preset_gain?: number | null;
  preset_ramp?: number | null;
}

/** Execute ONE command against the writer. Never throws — every outcome is a result row. */
export async function executeCommand(cmd: TakenCommand, ctx: ExecContext): Promise<ExecResult> {
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // capture_scene = a READ; ungated by design (it fills audio_scenes.payload through A's RPC)
  if (cmd.kind === "capture_scene") {
    if (!cmd.scene_name) return { status: "error", result: { reason: "unknown_scene", scene_id: cmd.payload?.scene_id ?? null } };
    if (!ctx.capture) return { status: "error", result: { reason: "capture_unavailable" } };
    try {
      const r = await ctx.capture(cmd.scene_name);
      return r.stored
        ? { status: "done", result: { summary: r.summary, controls: r.controls } }
        : { status: "error", result: { reason: r.error ?? "not_stored", summary: r.summary, controls: r.controls } };
    } catch (e) {
      return { status: "error", result: { reason: "capture_failed", message: (e as Error).message } };
    }
  }

  // THE DOUBLE GATE — evaluated before any plan is even built
  if (!ctx.writesEnabled || !ctx.writer.canWrite) {
    return { status: "error", result: { reason: "writes_disabled", gate: "agent", detail: "config.writesEnabled is false on the agent" } };
  }
  if (!armMatches(cmd)) {
    return {
      status: "error",
      result: {
        reason: "writes_disabled",
        gate: "platform",
        detail: !cmd.writes_arm_valid ? "writes are not armed (or the arm expired at the 04:00 rollover)" : "this press was made under a different arm than the current one",
      },
    };
  }

  let steps: WriteStep[];
  let rampSeconds = 0;
  const notes: Record<string, unknown> = {};
  if (cmd.kind === "recall_scene") {
    const payload = cmd.scene_payload ?? null;
    if (!cmd.scene_name || !payload) return { status: "error", result: { reason: "unknown_scene" } };
    rampSeconds = clampRamp(cmd.scene_ramp ?? 3);
    steps = planRecall(payload, rampSeconds);
    if (steps.length === 0) return { status: "error", result: { reason: "scene_not_captured", scene: cmd.scene_name } };
    // NOTE-8: the captured video NAMES → live-resolved selector booleans (never hard-coded)
    const video = payload.video as { out1?: string | null; out2?: string | null } | undefined;
    if (video && (video.out1 || video.out2)) {
      const read = ctx.readVideo ? await ctx.readVideo().catch(() => null) : null;
      const v = videoStepsForNames(video, read);
      // video switches ride with the other instant switches (before the ramp wait / unmute)
      const firstUnmute = steps.findIndex((s) => s.step === "unmute");
      steps.splice(firstUnmute < 0 ? steps.length : firstUnmute, 0, ...v.steps);
      if (v.unresolved.length) notes.video_unresolved = v.unresolved;
      if (!read && ctx.readVideo) notes.video_unresolved = [...(v.unresolved.length ? v.unresolved : []), "hdmi read failed"];
    }
  } else if (cmd.kind === "video_source" && typeof cmd.payload?.source === "string" && !VIDEO_SOURCES.has(cmd.payload.source)) {
    // a source NAME ("Roku") — resolve it from the live switcher the same way a recall does
    const out = Number(cmd.payload.out);
    if (out !== 1 && out !== 2) return { status: "error", result: { reason: "bad_command", detail: `bad out ${String(cmd.payload.out)}` } };
    const read = ctx.readVideo ? await ctx.readVideo().catch(() => null) : null;
    const v = videoStepsForNames(out === 1 ? { out1: cmd.payload.source } : { out2: cmd.payload.source }, read);
    if (v.unresolved.length || v.steps.length === 0) {
      if (read && read.outputs[out].activeName === cmd.payload.source) return { status: "done", result: { writes: [], note: "already showing" } };
      return { status: "error", result: { reason: "video_unresolved", detail: `no output is currently showing "${cmd.payload.source}", so its selector is unknown` } };
    }
    steps = v.steps;
  } else {
    const plan = planSimple(cmd, cmd.preset_gain ?? null, cmd.preset_ramp ?? null);
    if ("error" in plan) return { status: "error", result: { reason: "bad_command", detail: plan.error } };
    steps = plan.steps;
  }

  const completed: WriteStep[] = [];
  for (const s of steps) {
    // the ramp must finish before the unmute or the fade is inaudible and the unmute pops
    if (s.step === "unmute" && rampSeconds > 0 && !completed.some((c) => c.step === "unmute")) await sleep(rampSeconds * 1000);
    try {
      await ctx.writer.componentSet(s.component, s.controls);
      completed.push(s);
    } catch (e) {
      return { status: "error", result: { reason: "core_error", message: (e as Error).message, completed, failed: s } };
    }
  }
  return {
    status: "done",
    result: { writes: completed, ramp_seconds: rampSeconds, ...notes },
    activeSceneId: cmd.kind === "recall_scene" ? String(cmd.payload?.scene_id ?? "") || null : undefined,
  };
}

const clampRamp = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : 3);

// ── the loop ───────────────────────────────────────────────────────────────────────
export interface CommandLoopOptions {
  api: CommandApi;
  writer: ControlWriter;
  config: Pick<AgentConfig, "venueId" | "agentId" | "writesEnabled">;
  log: Logger;
  intervalMs?: number;
  /** production capture wiring (needs the QRC client + config); tests inject via ctx */
  captureOptions?: Omit<CaptureRunOptions, "sceneName" | "favoriteOverride" | "dryRun">;
  sleep?: (ms: number) => Promise<void>;
}

export interface CommandLoop {
  stop(): void;
  /** one poll + execute pass (exposed for tests) */
  tick(): Promise<number>;
}

export function startCommandLoop(o: CommandLoopOptions): CommandLoop {
  const interval = o.intervalMs ?? 1_000;
  let busy = false;
  let stopped = false;
  const capture = o.captureOptions
    ? async (sceneName: string) => {
        const r = await captureScene({ ...o.captureOptions!, sceneName, favoriteOverride: null, dryRun: false, out: () => {}, err: (l) => o.log.info(`capture: ${l}`) });
        return { stored: r.stored, summary: r.summary, controls: r.payload.controls.length, error: r.stored ? undefined : "not_stored" };
      }
    : undefined;

  const readVideo = o.captureOptions?.client
    ? async (): Promise<VideoRead | null> => {
        const res = await o.captureOptions!.client!.componentGet(HDMI_COMPONENT, HDMI_READ_CONTROLS);
        return parseVideoRead(res.Controls ?? []);
      }
    : undefined;

  const tick = async (): Promise<number> => {
    if (busy || stopped) return 0;
    busy = true;
    try {
      const taken = await o.api.take(o.config.venueId);
      if (!taken.ok) {
        o.log.warn(`commands: take failed (${taken.status}) ${taken.error ?? ""}`);
        return 0;
      }
      for (const cmd of taken.commands as TakenCommand[]) {
        o.log.info(`commands: ${cmd.kind} ${cmd.id} by ${cmd.requested_by ?? "?"} (arm valid=${cmd.writes_arm_valid})`);
        const r = await executeCommand(cmd, { writer: o.writer, writesEnabled: o.config.writesEnabled, sleep: o.sleep, capture, readVideo });
        const fin = await o.api.finish(cmd.id, r.status, { ...r.result, agent_id: o.config.agentId });
        if (!fin.ok) o.log.warn(`commands: finish ${cmd.id} failed (${fin.status}) ${fin.error ?? ""}`);
        if (r.status === "done" && r.activeSceneId) {
          const st = await o.api.setState(o.config.venueId, r.activeSceneId, cmd.requested_by, null);
          if (!st.ok) o.log.warn(`commands: setState failed (${st.status}) ${st.error ?? ""}`);
        } else if (r.status === "error" && cmd.kind === "recall_scene") {
          await o.api.setState(o.config.venueId, null, null, String(r.result.reason ?? "error"));
        }
        o.log[r.status === "done" ? "info" : "warn"](`commands: ${cmd.kind} ${cmd.id} → ${r.status} ${r.status === "error" ? String(r.result.reason) : ""}`);
      }
      return taken.commands.length;
    } catch (e) {
      o.log.error(`commands: tick failed: ${(e as Error).message}`);
      return 0;
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void tick(), interval);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    tick,
  };
}
