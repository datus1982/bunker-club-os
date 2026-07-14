/**
 * PURE event-stage logic for the Phase 7 events DISPLAY engine (docs/13).
 *
 * No React, no Supabase, no `@/` alias imports — so it runs unchanged under `tsx`
 * (scripts/test-event-stage.ts) AND in the browser. useSignage.ts re-exports these
 * so the app has one import surface.
 *
 * A row of `signage_events_live` (0035, the anon horizon-gated view) is a LiveEvent.
 * The screen derives the on-air STAGE from now() vs fire_at ± the minute fields — the
 * DB has no stage column to desync (docs/13). The horizon view already trims rows to
 * roughly the on-screen window; eventStage() is the precise, testable boundary.
 */

export type EventKind = "window" | "message" | "moment";

/** The stage a live event is in, from the display's point of view.
 *  - moment kinds resolve to tease | alert | moment | event | allclear
 *  - window/message kinds resolve to 'active' (a rotation card + ticker line)
 *  - null = nothing on screen right now. */
export type EventStage = "tease" | "alert" | "moment" | "event" | "allclear" | "active" | null;

/** The columns `signage_events_live` exposes (0035). */
export interface LiveEvent {
  id: string;
  venue_id: string;
  name: string;
  kind: EventKind;
  skin: string; // 'launch' | 'infestation' | 'generic' (free text; unknown → generic)
  fields: Record<string, unknown>; // display copy incl. fields.live_count (counter cache)
  toast_guid: string | null;
  fire_at: string | null;
  tease_minutes: number;
  alert_minutes: number;
  window_minutes: number;
  interrupt_game: boolean;
  status: string;
}

const MIN = 60_000;
/** MOMENT payoff (the "liftoff / outbreak" beat) runs for the first 15s of the window. */
export const MOMENT_PAYOFF_MS = 15_000;
/** ALL-CLEAR resolution card holds for 2 min after the window ends. */
export const ALL_CLEAR_MS = 2 * MIN;
/** The inverse-video pulse begins in the final 10s of the ALERT countdown. */
export const ALERT_PULSE_MS = 10_000;

/**
 * Derive the current stage of an event. `now` is passed in (never Date.now() inside)
 * so it is deterministic and unit-testable. All boundaries are [inclusive, exclusive).
 */
export function eventStage(event: LiveEvent, now: Date | number): EventStage {
  if (!event.fire_at) return null;
  const F = new Date(event.fire_at).getTime();
  if (Number.isNaN(F)) return null;
  const n = typeof now === "number" ? now : now.getTime();

  if (event.kind === "window" || event.kind === "message") {
    const end = F + event.window_minutes * MIN;
    return n >= F && n < end ? "active" : null;
  }

  // moment
  const teaseStart = F - event.tease_minutes * MIN;
  const alertStart = F - event.alert_minutes * MIN;
  const payoffEnd = F + MOMENT_PAYOFF_MS;
  const windowEnd = F + event.window_minutes * MIN;
  const allClearEnd = windowEnd + ALL_CLEAR_MS;

  if (n < teaseStart) return null;
  if (n < alertStart) return "tease";
  if (n < F) return "alert";
  if (n < payoffEnd) return "moment";
  if (n < windowEnd) return "event";
  if (n < allClearEnd) return "allclear";
  return null;
}

/** Stages that PREEMPT the surface (a full-screen takeover-level stage, docs/13 ladder).
 *  TEASE and window/message 'active' are rotation-level, so they are NOT here. */
export function isTakeoverStage(stage: EventStage): stage is "alert" | "moment" | "event" | "allclear" {
  return stage === "alert" || stage === "moment" || stage === "event" || stage === "allclear";
}

/** Remaining seconds until fire_at (ALERT T-MINUS clock). Clamped at 0. */
export function secondsToFire(event: LiveEvent, now: Date | number): number {
  if (!event.fire_at) return 0;
  const F = new Date(event.fire_at).getTime();
  const n = typeof now === "number" ? now : now.getTime();
  return Math.max(0, Math.ceil((F - n) / 1000));
}

/** Minutes until fire_at, rounded to the nearest minute (TEASE ticker line). */
export function minutesToFire(event: LiveEvent, now: Date | number): number {
  if (!event.fire_at) return 0;
  const F = new Date(event.fire_at).getTime();
  const n = typeof now === "number" ? now : now.getTime();
  return Math.max(0, Math.round((F - n) / MIN));
}

/** Format a remaining-seconds count as a T-MINUS clock: "T−04:59" (U+2212 minus). */
export function formatTMinus(totalSeconds: number): string {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `T−${m}:${s}`;
}
