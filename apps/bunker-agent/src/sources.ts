/**
 * THE SOURCE MODEL (PR C, docs/16 §1b) — pure. Which Inside Mixer input gain each staff-facing
 * SOURCE key drives, and whether that source is the one the router is on right now.
 *
 * DECISION (orchestrator, PR C brief — implemented exactly):
 *   mic1  → Inside Mixer input.1.gain          (label "Mic 1")
 *   mic2  → Inside Mixer input.2.gain          (label "Mic 2")
 *   sonos │
 *   booth ├→ Inside Mixer input.5.gain         (label "Selected_Source" = whatever
 *   hdmi  │   Inside Router_8x8 select.1 points at: 1 Sonos · 2 Booth · 3 HDMI)
 *   verb  → Inside Mixer input.8.gain          (label "Verb" — the reverb return)
 * Inputs 3/4/6/7 ("Stream 1/2", "Booth", "Video") are unwired legacy labels — never a source.
 *
 * A preset/nudge for sonos/booth/hdmi resolves to input.5.gain ONLY when select.1 currently
 * routes that source (read live via Component.Get first); otherwise the executor refuses it as
 * `not_routed` (the preset row is still saved by the editor — nothing is written to the room).
 *
 * Every control named here is in SCENE_LEVERS (controls.ts) — the executor's WARN-1 intersection
 * bounds source writes exactly like recalls; nothing outside Inside Mixer's four input gains can
 * be reached through a source command.
 */

export type SourceKey = "mic1" | "mic2" | "sonos" | "booth" | "hdmi" | "verb";
export type SourceLevel = "low" | "med" | "high";

export const SOURCE_KEYS: readonly SourceKey[] = ["mic1", "mic2", "sonos", "booth", "hdmi", "verb"];
export const SOURCE_LABEL: Readonly<Record<SourceKey, string>> = { mic1: "Mic 1", mic2: "Mic 2", sonos: "Sonos", booth: "Booth", hdmi: "HDMI", verb: "Verb" };

/** The one mixer every source gain lives on, and the router that decides input 5. */
export const SOURCE_MIXER = "Inside Mixer";
export const SOURCE_ROUTER = "Inside Router_8x8";
export const SOURCE_ROUTER_CONTROL = "select.1";

/** Router select.1 value → the source it routes into input 5 (card §1: 1 Sonos · 2 Booth · 3 HDMI). */
export const ROUTED_SOURCE_BY_SELECT: Readonly<Record<number, SourceKey>> = { 1: "sonos", 2: "booth", 3: "hdmi" };

const DIRECT_LEVER: Readonly<Partial<Record<SourceKey, string>>> = { mic1: "input.1.gain", mic2: "input.2.gain", verb: "input.8.gain" };
export const SELECTED_SOURCE_LEVER = "input.5.gain";

export const isSourceKey = (s: unknown): s is SourceKey => typeof s === "string" && (SOURCE_KEYS as readonly string[]).includes(s);
export const isSourceLevel = (s: unknown): s is SourceLevel => s === "low" || s === "med" || s === "high";

/** Which source the router is on right now (null = unreadable / an unmapped select value). */
export function routedSource(select: unknown): SourceKey | null {
  const n = typeof select === "number" ? select : typeof select === "string" ? Number(select) : NaN;
  return Number.isInteger(n) ? (ROUTED_SOURCE_BY_SELECT[n] ?? null) : null;
}

/** True for the three sources that share input 5 (their lever depends on the router). */
export const isRoutedSource = (s: SourceKey): boolean => s === "sonos" || s === "booth" || s === "hdmi";

export type LeverResolution = { control: string } | { notRouted: true; routed: SourceKey | null };

/**
 * Resolve the Inside Mixer control a source drives, given the LIVE router value. mic1/mic2/verb
 * never depend on the router; sonos/booth/hdmi resolve to input.5.gain iff routed, else refused.
 */
export function leverForSource(source: SourceKey, select: unknown): LeverResolution {
  const direct = DIRECT_LEVER[source];
  if (direct) return { control: direct };
  const routed = routedSource(select);
  return routed === source ? { control: SELECTED_SOURCE_LEVER } : { notRouted: true, routed };
}

/** The (component, control) every source could ever write — for the lever-intersection sanity test. */
export const SOURCE_CONTROLS: readonly string[] = ["input.1.gain", "input.2.gain", "input.5.gain", "input.8.gain"];

export interface SourceRange {
  source: SourceKey;
  min_db: number;
  max_db: number;
  step_db: number;
}

/** Parse the `ranges` jsonb the take RPC returns (bad rows dropped, never guessed). */
export function parseRanges(raw: unknown): Map<SourceKey, SourceRange> {
  const out = new Map<SourceKey, SourceRange>();
  if (!Array.isArray(raw)) return out;
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || !isSourceKey(r.source)) continue;
    const min = Number(r.min_db);
    const max = Number(r.max_db);
    const step = Number(r.step_db);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) continue;
    out.set(r.source, { source: r.source, min_db: min, max_db: max, step_db: Number.isFinite(step) && step > 0 ? step : 1.5 });
  }
  return out;
}

/** The baseline key the platform stores per lever (0069 audio_state.baseline — flat map). */
export const baselineKey = (component: string, control: string): string => `${component}|${control}`;

/**
 * Seed ranges from a NORMAL capture: captured ± 6 dB per source lever present in the payload,
 * the routed source resolved from the captured select.1 (the two unrouted sources stay
 * unseeded). Pure; the RPC clamps to [-100, 10] and never overwrites an existing row.
 */
export const SEED_HALF_WIDTH_DB = 6;
export function seedRangesFromCapture(controls: ReadonlyArray<{ component: string; control: string; value: unknown }>): Array<{ source: SourceKey; min_db: number; max_db: number }> {
  const g = (control: string): number | null => {
    const hit = controls.find((c) => c.component === SOURCE_MIXER && c.control === control);
    return hit && typeof hit.value === "number" && Number.isFinite(hit.value) ? hit.value : null;
  };
  const select = controls.find((c) => c.component === SOURCE_ROUTER && c.control === SOURCE_ROUTER_CONTROL)?.value;
  const routed = routedSource(select);
  const out: Array<{ source: SourceKey; min_db: number; max_db: number }> = [];
  for (const source of SOURCE_KEYS) {
    const control = isRoutedSource(source) ? (routed === source ? SELECTED_SOURCE_LEVER : null) : DIRECT_LEVER[source]!;
    if (!control) continue;
    const v = g(control);
    if (v === null) continue;
    out.push({ source, min_db: Math.max(-100, v - SEED_HALF_WIDTH_DB), max_db: Math.min(10, v + SEED_HALF_WIDTH_DB) });
  }
  return out;
}
