/**
 * AUDIO module data layer (docs/16, PR B) — reads the four PR A tables + the PR B command
 * queue, and offers ONE write path for the room: `sendAudioCommand()` inserts a row into
 * `audio_commands`. The page never talks to the Core; the NUC agent does, behind its double
 * gate (0068 header). Everything here is realtime-first with a 30 s fallback poll on the live
 * mirror (the agent posts ≤ 1 Hz; realtime carries it, the poll catches a dropped socket).
 *
 * The truth is always `audio_live.snapshot` (the agent's mirror); `audio_state` is the LABEL
 * of what was last recalled. Every control on the page derives from the snapshot, and when
 * the snapshot is absent or older than AGENT_STALE_MS every command control disables — the
 * page never pretends the room is reachable.
 *
 * PR C (0069) adds the SOURCE model: six staff-facing sources on four Inside Mixer input gains,
 * the owner's nudge RANGES + per-source LOW/MED/HIGH, and `audio_state.baseline` (what a
 * recall / preset last set) so the page can show "nudged +1.5 dB" = live − baseline.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { useCloseoutHour, useVenue } from "@/modules/signage/useSignage";
import { nextRollover } from "@/modules/signage/scheduleResolve";

// ── row types (0067 + 0068 column names are the contract) ───────────────────────
export interface AudioScene {
  id: string;
  venue_id: string;
  name: string;
  position: number;
  ramp_seconds: number;
  payload: ScenePayload;
  is_default: boolean;
  requires_confirm: boolean;
  updated_at: string;
}

/** A captured scene — EXACTLY the shape apps/bunker-agent/src/capture.ts stores through
 *  audio_agent_capture (0067): a FLAT ARRAY of exact Q-SYS names + the Sonos/HDMI reads, plus
 *  the stamps the RPC adds. `{}` (no `controls`) = never captured. */
export type ScenePayload = Record<string, unknown> & {
  controls?: Array<{ component: string; control: string; value: unknown; string?: string | null; position?: number | null }>;
  sonos_favorite?: number | null;
  sonos_favorite_name?: string | null;
  video?: { out1?: string | null; out2?: string | null };
  captured_at?: string;
  captured_by?: string | null;
};

/** How many levers a payload captured (0 = never captured). */
export function capturedCount(p: ScenePayload | null | undefined): number {
  return Array.isArray(p?.controls) ? p!.controls!.length : 0;
}

export type Zone = "inside" | "patio";
export type Level = "low" | "med" | "high";

export interface ZonePreset {
  venue_id: string;
  zone: Zone;
  level: Level;
  gain_db: number | null;
  ramp_seconds: number;
  updated_at: string;
}

export interface AudioState {
  venue_id: string;
  active_scene_id: string | null;
  recalled_at: string | null;
  recalled_by: string | null;
  last_error: string | null;
  writes_armed_by: string | null;
  writes_armed_at: string | null;
  /** PR C (0069): the flat "<Component>|<control>" → value map of the levers the agent LAST SET
   *  by a recall / zone preset / source preset. A nudge never touches it — "nudged +1.5 dB" is
   *  derived here as live − baseline. Written only through audio_agent_set_baseline. */
  baseline: Record<string, unknown> | null;
  baseline_at: string | null;
}

// ── PR C: the SOURCE model (mirror of apps/bunker-agent/src/sources.ts — keep in step) ──
export type SourceKey = "mic1" | "mic2" | "sonos" | "booth" | "hdmi" | "verb";
export const SOURCE_KEYS: readonly SourceKey[] = ["mic1", "mic2", "sonos", "booth", "hdmi", "verb"];
export const SOURCE_LABEL: Readonly<Record<SourceKey, string>> = { mic1: "MIC 1", mic2: "MIC 2", sonos: "SONOS", booth: "BOOTH", hdmi: "HDMI", verb: "VERB" };
/** Inside Mixer control per source; sonos/booth/hdmi SHARE input 5 (the router decides whose it is). */
export const SOURCE_MIXER = "Inside Mixer";
export const SOURCE_CONTROL: Readonly<Record<SourceKey, string>> = {
  mic1: "input.1.gain", mic2: "input.2.gain", sonos: "input.5.gain", booth: "input.5.gain", hdmi: "input.5.gain", verb: "input.8.gain",
};
export const ROUTED_BY_SELECT: Readonly<Record<number, SourceKey>> = { 1: "sonos", 2: "booth", 3: "hdmi" };
export const isRoutedSource = (s: SourceKey): boolean => s === "sonos" || s === "booth" || s === "hdmi";

export interface SourceRange {
  venue_id: string;
  source: SourceKey;
  min_db: number;
  max_db: number;
  step_db: number;
  updated_at: string;
}

export interface SourcePreset {
  venue_id: string;
  source: SourceKey;
  level: Level;
  gain_db: number | null;
  updated_at: string;
}

/** The baseline key the agent stores per lever (0069). */
export const baselineKey = (component: string, control: string): string => `${component}|${control}`;

/** Which of sonos/booth/hdmi the Inside router is on right now (derived block first, raw control second). */
export function routedSourceOf(snap: LiveSnapshot | null): SourceKey | null {
  const d = snap?.derived?.sources?.routed;
  if (d === "sonos" || d === "booth" || d === "hdmi") return d;
  const raw = snap?.controls?.["Inside Router_8x8"]?.["select.1"]?.v;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isInteger(n) ? (ROUTED_BY_SELECT[n] ?? null) : null;
}

/** The live gain on a source's lever (for sonos/booth/hdmi that is input 5 — whoever is routed). */
export function liveSourceGain(snap: LiveSnapshot | null, source: SourceKey): number | null {
  const d = snap?.derived?.sources?.levels?.[source]?.gain_db;
  if (typeof d === "number" && Number.isFinite(d)) return d;
  const raw = snap?.controls?.[SOURCE_MIXER]?.[SOURCE_CONTROL[source]]?.v;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/** live − baseline for a source's lever, or null when either side is unknown / equal (<0.05 dB). */
export function nudgeOffset(state: AudioState | null | undefined, snap: LiveSnapshot | null, source: SourceKey): number | null {
  const live = liveSourceGain(snap, source);
  const base = state?.baseline?.[baselineKey(SOURCE_MIXER, SOURCE_CONTROL[source])];
  if (live === null || typeof base !== "number" || !Number.isFinite(base)) return null;
  const diff = Math.round((live - base) * 10) / 10;
  return Math.abs(diff) < 0.05 ? null : diff;
}

/** Plain-words refusal reasons the agent returns for a source press (commands.ts SourceDecision). */
export function describeRefusal(result: Record<string, unknown> | null | undefined): string | null {
  if (!result) return null;
  const reason = String(result.reason ?? "");
  const range = result.range as { min_db?: number; max_db?: number } | undefined;
  switch (reason) {
    case "out_of_range":
      return `Refused — ${typeof result.target === "number" ? `${result.target.toFixed(1)} dB` : "that"} is outside ${range?.min_db ?? "?"}…${range?.max_db ?? "?"} dB`;
    case "not_routed":
      return `Not routed — the router is on ${SOURCE_LABEL[result.routed as SourceKey] ?? "another input"}`;
    case "range_not_set":
      return "Range not set — an admin sets it in the scene editor";
    case "preset_not_set":
      return "Preset not set";
    case "read_failed":
      return "Could not read the current level";
    case "writes_disabled":
      return "Refused — writes are not armed";
    case "":
      return null;
    default:
      return `Error: ${reason}`;
  }
}

/** The subset of the agent's snapshot (apps/bunker-agent/src/snapshot.ts) the page reads. */
export interface LiveSnapshot {
  venue_id?: string;
  agent_id?: string;
  agent_version?: string;
  at?: string;
  connected?: boolean;
  core?: { host?: string; design_name?: string | null; design_code?: string | null; status?: string | null };
  errors?: Array<{ kind: string; component?: string; control?: string; message: string }>;
  controls?: Record<string, Record<string, { v: unknown; s: string | null; p: number | null; at: number }>>;
  derived?: {
    zones?: Record<"inside" | "patio" | "listen", { source: number | null; source_name: string | null; gain_db: number | null; mute: boolean | null }>;
    mics?: Record<"1" | "2", { mute: boolean | null; gain_db: number | null }>;
    /** PR C: per-source lever + live gain + whether the router is on it (agent snapshot.ts) */
    sources?: { routed: SourceKey | null; levels: Record<SourceKey, { control: string; gain_db: number | null; routed: boolean }> };
    sonos?: { transport: string | null; track: string | null; artist: string | null; favorites: Array<{ n: number; name: string }> };
    video?: { outputs: Record<"1" | "2", { active_source: string | null }>; sources: Record<string, { signal: boolean | null; plugged: boolean | null }> };
    effects?: { reverb_bypass: boolean | null; ducker_bypass: boolean | null };
    meters?: { inputs_db: Array<number | null>; zones_db: Array<number | null> };
  };
}

export interface AudioLive {
  venue_id: string;
  snapshot: LiveSnapshot;
  agent_id: string | null;
  updated_at: string;
}

export type CommandKind = "recall_scene" | "zone_preset" | "mic_mute" | "reverb_bypass" | "capture_scene" | "sonos_favorite" | "video_source" | "source_preset" | "source_nudge";

export interface AudioCommand {
  id: string;
  venue_id: string;
  kind: CommandKind;
  payload: Record<string, unknown>;
  requested_by: string | null;
  requested_at: string;
  status: "queued" | "running" | "done" | "error";
  result: Record<string, unknown> | null;
  done_at: string | null;
}

/** The agent posts ≤ 1 Hz and a heartbeat every 30 s; past this the room is unreachable. */
export const AGENT_STALE_MS = 15_000;

// ── queries ──────────────────────────────────────────────────────────────────────
export function useAudioScenes() {
  return useQuery({
    queryKey: ["audio", "scenes"],
    queryFn: async (): Promise<AudioScene[]> => {
      const { data, error } = await supabase
        .from("audio_scenes")
        .select("id,venue_id,name,position,ramp_seconds,payload,is_default,requires_confirm,updated_at")
        .eq("venue_id", VENUE_ID)
        .order("position")
        .order("name");
      if (error) throw error;
      return (data ?? []) as AudioScene[];
    },
  });
}

export function useZonePresets() {
  return useQuery({
    queryKey: ["audio", "presets"],
    queryFn: async (): Promise<ZonePreset[]> => {
      const { data, error } = await supabase
        .from("audio_zone_presets")
        .select("venue_id,zone,level,gain_db,ramp_seconds,updated_at")
        .eq("venue_id", VENUE_ID);
      if (error) throw error;
      return (data ?? []) as ZonePreset[];
    },
  });
}

export function useAudioState() {
  return useQuery({
    queryKey: ["audio", "state"],
    queryFn: async (): Promise<AudioState | null> => {
      const { data, error } = await supabase
        .from("audio_state")
        .select("venue_id,active_scene_id,recalled_at,recalled_by,last_error,writes_armed_by,writes_armed_at,baseline,baseline_at")
        .eq("venue_id", VENUE_ID)
        .maybeSingle();
      if (error) throw error;
      return (data as AudioState | null) ?? null;
    },
  });
}

/** PR C: the owner's nudge ranges (a source with no row = "range not set"; nudges refused). */
export function useSourceRanges() {
  return useQuery({
    queryKey: ["audio", "sourceRanges"],
    queryFn: async (): Promise<SourceRange[]> => {
      const { data, error } = await supabase
        .from("audio_source_ranges")
        .select("venue_id,source,min_db,max_db,step_db,updated_at")
        .eq("venue_id", VENUE_ID);
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, min_db: Number(r.min_db), max_db: Number(r.max_db), step_db: Number(r.step_db) })) as SourceRange[];
    },
  });
}

/** PR C: LOW / MED / HIGH per source (18 seeded rows, gain_db null until authored). */
export function useSourcePresets() {
  return useQuery({
    queryKey: ["audio", "sourcePresets"],
    queryFn: async (): Promise<SourcePreset[]> => {
      const { data, error } = await supabase
        .from("audio_source_presets")
        .select("venue_id,source,level,gain_db,updated_at")
        .eq("venue_id", VENUE_ID);
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, gain_db: r.gain_db === null ? null : Number(r.gain_db) })) as SourcePreset[];
    },
  });
}

export function useAudioLive() {
  return useQuery({
    queryKey: ["audio", "live"],
    // The one fallback poll (30 s) — realtime carries the ≤ 1 Hz mirror in between.
    refetchInterval: 30_000,
    queryFn: async (): Promise<AudioLive | null> => {
      const { data, error } = await supabase
        .from("audio_live")
        .select("venue_id,snapshot,agent_id,updated_at")
        .eq("venue_id", VENUE_ID)
        .maybeSingle();
      if (error) throw error;
      return (data as AudioLive | null) ?? null;
    },
  });
}

/** The last 20 command rows — the page shows the outcome of each press (done / error + why). */
export function useRecentCommands() {
  return useQuery({
    queryKey: ["audio", "commands"],
    queryFn: async (): Promise<AudioCommand[]> => {
      const { data, error } = await supabase
        .from("audio_commands")
        .select("id,venue_id,kind,payload,requested_by,requested_at,status,result,done_at")
        .eq("venue_id", VENUE_ID)
        .order("requested_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as AudioCommand[];
    },
  });
}

/** One channel for the five audio tables; every change invalidates the matching query. */
export function useAudioRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const keys: Record<string, string> = {
      audio_live: "live",
      audio_state: "state",
      audio_scenes: "scenes",
      audio_zone_presets: "presets",
      audio_commands: "commands",
      audio_source_ranges: "sourceRanges",
      audio_source_presets: "sourcePresets",
    };
    let ch = supabase.channel("audio-module");
    for (const table of Object.keys(keys)) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        qc.invalidateQueries({ queryKey: ["audio", keys[table]] });
      });
    }
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);
}

// ── derived: agent freshness + ARM WRITES expiry ─────────────────────────────────
/** A 5 s render clock so "agent last seen" and the arm expiry re-evaluate without a reload. */
export function useNowTick(ms = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export interface AgentHealth {
  /** True when a snapshot exists AND it is younger than AGENT_STALE_MS AND it says connected. */
  online: boolean;
  /** Milliseconds since the last mirror post, or null with no row. */
  ageMs: number | null;
  /** The snapshot itself (may be stale — callers read it only for display). */
  snap: LiveSnapshot | null;
  /** Why not online — one sentence for the status line. */
  reason: string | null;
}

export function deriveAgentHealth(live: AudioLive | null | undefined, nowMs: number): AgentHealth {
  if (!live) return { online: false, ageMs: null, snap: null, reason: "Audio agent offline — no mirror yet" };
  const at = new Date(live.updated_at).getTime();
  const ageMs = Number.isFinite(at) ? Math.max(0, nowMs - at) : null;
  const snap = (live.snapshot ?? {}) as LiveSnapshot;
  if (ageMs === null || ageMs > AGENT_STALE_MS) {
    return { online: false, ageMs, snap, reason: `Audio agent offline — last seen ${ageMs === null ? "?" : fmtAge(ageMs)} ago` };
  }
  if (snap.connected === false) return { online: false, ageMs, snap, reason: "Audio agent online but the Core is unreachable" };
  return { online: true, ageMs, snap, reason: null };
}

export function fmtAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

/**
 * ARM WRITES is EFFECTIVE iff stamped AND its next venue 04:00 rollover after the stamp is
 * still ahead — the 0057 trivia-arm derivation, re-used verbatim (nextRollover). The SQL twin
 * is audio_next_rollover() in 0068; the agent reads `writes_arm_valid` from the RPC, so both
 * ends evaluate the same rule.
 */
export function isWritesArmed(state: AudioState | null | undefined, nowMs: number, tz: string, rolloverHour: number): boolean {
  if (!state?.writes_armed_by || !state.writes_armed_at) return false;
  const at = new Date(state.writes_armed_at);
  if (!Number.isFinite(at.getTime())) return false;
  return nextRollover(at, tz, rolloverHour).getTime() > nowMs;
}

export function useWritesArmed(state: AudioState | null | undefined, nowMs: number): { armed: boolean; tz: string; rollover: number } {
  const venue = useVenue();
  const closeout = useCloseoutHour();
  const tz = venue.data?.timezone ?? "America/Chicago";
  const rollover = closeout.data ?? 4;
  return { armed: isWritesArmed(state, nowMs, tz, rollover), tz, rollover };
}

/**
 * Does the live room disagree with a scene's captured payload? Compares every captured
 * router `select.1` and every captured mute against the mirror — the "— UNVERIFIED" suffix
 * on the active scene button. Gains are deliberately NOT compared (a ramp in flight or a
 * later zone preset would flag every scene). Returns null when either side has nothing to say.
 */
export function sceneDisagrees(scene: AudioScene | undefined, snap: LiveSnapshot | null): boolean | null {
  const captured = scene?.payload?.controls;
  const live = snap?.controls;
  if (!Array.isArray(captured) || !live) return null;
  let compared = 0;
  for (const c of captured) {
    if (!c || typeof c.component !== "string" || typeof c.control !== "string") continue;
    const isRouter = c.control === "select.1";
    const isMute = /\.mute$/.test(c.control) || c.control === "bypass";
    if (!isRouter && !isMute) continue;
    if (c.value === null || c.value === undefined) continue;
    const lv = live[c.component]?.[c.control]?.v;
    if (lv === undefined) continue;
    compared++;
    if (lv !== c.value) return true;
  }
  return compared === 0 ? null : false;
}

// ── the ONE write path ───────────────────────────────────────────────────────────
export interface SendCommandInput {
  kind: CommandKind;
  payload?: Record<string, unknown>;
}

/**
 * INSERT one row into audio_commands. `armed_by` is copied from the current audio_state stamp
 * so the agent can prove the press happened under a live arm (gate (b)). requested_by = the
 * signed-in email (staff-visible, same audit shape as audio_state.recalled_by).
 */
export async function sendAudioCommand(input: SendCommandInput, armedBy: string | null): Promise<AudioCommand> {
  const { data: sess } = await supabase.auth.getSession();
  const email = sess.session?.user?.email ?? null;
  const payload = { ...(input.payload ?? {}), armed_by: armedBy };
  const { data, error } = await supabase
    .from("audio_commands")
    .insert({ venue_id: VENUE_ID, kind: input.kind, payload, requested_by: email })
    .select("id,venue_id,kind,payload,requested_by,requested_at,status,result,done_at")
    .single();
  if (error) throw error;
  return data as AudioCommand;
}

export function useSendCommand(armedBy: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendCommandInput) => sendAudioCommand(input, armedBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audio", "commands"] }),
  });
}

// ── owner editor writes (direct table writes under has_module('audio') RLS) ──────
export function useUpdateScene() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { id: string; name?: string; ramp_seconds?: number; requires_confirm?: boolean; position?: number }) => {
      const { id, ...rest } = patch;
      const { error } = await supabase.from("audio_scenes").update(rest).eq("id", id).eq("venue_id", VENUE_ID);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audio", "scenes"] }),
  });
}

export function useUpdatePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { zone: Zone; level: Level; gain_db: number | null; ramp_seconds?: number }) => {
      const row: Record<string, unknown> = { venue_id: VENUE_ID, zone: patch.zone, level: patch.level, gain_db: patch.gain_db };
      if (patch.ramp_seconds !== undefined) row.ramp_seconds = patch.ramp_seconds;
      const { error } = await supabase.from("audio_zone_presets").upsert(row, { onConflict: "venue_id,zone,level" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audio", "presets"] }),
  });
}

/** PR C: LOW/MED/HIGH per source — UPDATE gain_db only (the 18 rows are seeded; no INSERT grant). */
export function useUpdateSourcePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { source: SourceKey; level: Level; gain_db: number | null }) => {
      const { error } = await supabase
        .from("audio_source_presets")
        .update({ gain_db: patch.gain_db })
        .eq("venue_id", VENUE_ID)
        .eq("source", patch.source)
        .eq("level", patch.level);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audio", "sourcePresets"] }),
  });
}

/**
 * PR C: the owner's [min, max] + step per source. DECISION: UPDATE-then-INSERT rather than a
 * PostgREST upsert — 0069 grants UPDATE on (min_db, max_db, step_db) only, and an upsert's
 * ON CONFLICT DO UPDATE would also SET venue_id/source (not granted ⇒ 42501 on the conflict path).
 */
export function useSaveSourceRange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { source: SourceKey; min_db: number; max_db: number; step_db: number }) => {
      const fields = { min_db: patch.min_db, max_db: patch.max_db, step_db: patch.step_db };
      const upd = await supabase.from("audio_source_ranges").update(fields).eq("venue_id", VENUE_ID).eq("source", patch.source).select("source");
      if (upd.error) throw upd.error;
      if ((upd.data?.length ?? 0) > 0) return;
      const ins = await supabase.from("audio_source_ranges").insert({ venue_id: VENUE_ID, source: patch.source, ...fields });
      if (ins.error) throw ins.error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audio", "sourceRanges"] }),
  });
}

/** ARM / DISARM writes (admin). The stamp = the admin's email + now; a random suffix keeps
 *  two arms on the same night distinguishable in the command audit trail. */
export function useArmWrites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (arm: boolean) => {
      let by: string | null = null;
      let at: string | null = null;
      if (arm) {
        const { data: sess } = await supabase.auth.getSession();
        const email = sess.session?.user?.email ?? "admin";
        by = `${email}#${Math.random().toString(36).slice(2, 8)}`;
        at = new Date().toISOString();
      }
      const { error } = await supabase
        .from("audio_state")
        .upsert({ venue_id: VENUE_ID, writes_armed_by: by, writes_armed_at: at }, { onConflict: "venue_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audio", "state"] }),
  });
}

/** Convenience: scenes keyed by id. */
export function useSceneMap(scenes: AudioScene[] | undefined): Map<string, AudioScene> {
  return useMemo(() => new Map((scenes ?? []).map((s) => [s.id, s])), [scenes]);
}

/** Human summary of a captured payload for the editor ("14 controls · Sonos: 80s Hits · HDMI …"). */
export function summarizePayload(p: ScenePayload | null | undefined): { controls: number; sonos: string | null; video: string | null; capturedAt: string | null } {
  if (!p) return { controls: 0, sonos: null, video: null, capturedAt: null };
  const controls = capturedCount(p);
  const video = p.video ? [p.video.out1 ? `out 1: ${p.video.out1}` : null, p.video.out2 ? `out 2: ${p.video.out2}` : null].filter(Boolean).join(" · ") : null;
  return {
    controls,
    sonos: p.sonos_favorite_name ?? (p.sonos_favorite != null ? `favorite ${p.sonos_favorite}` : null),
    video: video && video.length ? video : null,
    capturedAt: p.captured_at ?? null,
  };
}
