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

/**
 * Balance a headline into ≤ maxLines lines so the auto-shrink can size off the
 * longest LINE instead of the whole string ("ROCKET LAUNCH IMMINENT" as one
 * 22-char line renders 92px; balanced to "ROCKET LAUNCH\nIMMINENT" it earns
 * 140px+ — the owner's 20-foot test). Authored line breaks are respected verbatim.
 *
 * Without `fontFor`: legacy behavior — the partition whose longest line is
 * shortest wins, fewer lines on ties. WITH `fontFor` (the caller's longest-line-
 * length → px table): a partition wins only if it actually RENDERS larger —
 * effective size = fontFor(longest) × line-count discount (×1 / ×0.7 / ×0.55,
 * the ratified drink-name trade), ties → fewer lines. Owner note 2026-07-14:
 * "BEST OF OKC" split into three stacked words because extra lines cost nothing
 * once the font table capped out — now they must pay for themselves.
 */
export function balanceHeadline(text: string, maxLines = 3, fontFor?: (maxLineLen: number) => number): string {
  if (text.includes("\n")) return text;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return text.trim();

  // Longest line of the best partition of words into exactly n lines (DP over
  // contiguous splits; word counts here are tiny, so O(w² · n) is nothing).
  const len = (a: number, b: number) => words.slice(a, b).join(" ").length;
  const partition = (n: number): string[] | null => {
    if (n > words.length) return null;
    // best[i][k] = minimal longest-line for words[0..i) split into k lines
    const best: number[][] = Array.from({ length: words.length + 1 }, () => Array(n + 1).fill(Infinity));
    const cut: number[][] = Array.from({ length: words.length + 1 }, () => Array(n + 1).fill(0));
    best[0][0] = 0;
    for (let k = 1; k <= n; k++) {
      for (let i = 1; i <= words.length; i++) {
        for (let j = k - 1; j < i; j++) {
          const v = Math.max(best[j][k - 1], len(j, i));
          if (v < best[i][k]) { best[i][k] = v; cut[i][k] = j; }
        }
      }
    }
    if (!Number.isFinite(best[words.length][n])) return null;
    const lines: string[] = [];
    for (let i = words.length, k = n; k >= 1; k--) { const j = cut[i][k]; lines.unshift(words.slice(j, i).join(" ")); i = j; }
    return lines;
  };

  const lineMult = (n: number) => (n <= 1 ? 1 : n === 2 ? 0.7 : 0.55);
  let chosen = [words.join(" ")];
  let chosenScore = fontFor ? fontFor(chosen[0].length) : -chosen[0].length;
  for (let n = 2; n <= maxLines; n++) {
    const lines = partition(n);
    if (!lines) break;
    const m = Math.max(...lines.map((l) => l.length));
    // With a font table, score by what actually renders (px × discount); without,
    // by shorter-longest-line as before. Strictly-greater keeps ties on fewer lines.
    const score = fontFor ? fontFor(m) * lineMult(n) : -m;
    if (score > chosenScore) { chosen = lines; chosenScore = score; }
  }
  return chosen.join("\n");
}
