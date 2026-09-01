/**
 * Venue wall-clock primitives — the ONE place this codebase turns an instant into "what day
 * and time is it at the bar", DST-correct via Intl and never a fixed UTC offset.
 *
 * Extracted from scheduleResolve.ts (which still owns program-schedule resolution and
 * re-exports these for its existing callers) so that consumers needing only the calendar
 * question — itemSchedule's per-item day rule, and through it the PUBLIC WEBSITE — don't drag
 * daypart/boundary/hold math into the eager Home bundle. That bundle is LCP-sensitive and has
 * been guarded before (dynamicCards.ts). Zero imports, zero react, zero supabase.
 */

export const DAY_MS = 86_400_000;

/** 'MO'…'SU' schedule tokens → JS weekday (0=Sun). */
const TOK2NUM: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
/** Intl's short weekday names → JS weekday (0=Sun). */
const WD2NUM: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Venue-local weekday index (0=Sun) + minutes past midnight for an instant. */
export function venueLocalParts(at: Date, tz: string): { dow: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(at);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  let hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  if (hh === 24) hh = 0; // some engines emit '24' at midnight
  return { dow: WD2NUM[wd] ?? 0, minute: hh * 60 + mm };
}

/** Venue-local calendar Y/M/D of an instant (M is 1..12). */
export function venueLocalYMD(at: Date, tz: string): { y: number; m1: number; d: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(at).filter((x) => x.type !== "literal").map((x) => [x.type, parseInt(x.value, 10)]),
  ) as { year: number; month: number; day: number };
  return { y: p.year, m1: p.month, d: p.day };
}

/** Is `dow` (0=Sun) in a ['MO','TU',…] token set? EMPTY = every day (the slot_program_schedule
 *  default, and the same rule signage_items.recurrence follows — see itemSchedule.ts). */
export function dayAllowed(days: string[], dow: number): boolean {
  if (days.length === 0) return true; // empty = every day
  for (const d of days) if (TOK2NUM[d.toUpperCase()] === dow) return true;
  return false;
}

/** The venue BUSINESS day an instant belongs to: the venue-local calendar day, rolled back one
 *  day while the wall clock is still before the closeout hour (the 04:00 rollover — the same
 *  business-date idiom toast-sync uses and the same "belongs to the day it started" rule
 *  scheduleResolve.rowCovers applies to a wrapping daypart). 1:30 AM Wednesday is still TUESDAY
 *  night here.
 *
 *  Returns the venue-local Y / M (1..12) / D of that business day plus its weekday (0=Sun).
 *  DST-correct: every wall-clock read goes through Intl, and the day-before step is plain
 *  calendar arithmetic on a UTC proxy of the local date — never a fixed-offset subtraction on
 *  the instant, which would shift by an hour across a DST edge. */
export function venueBusinessDay(
  at: Date, tz: string, closeoutHour: number,
): { y: number; m1: number; d: number; dow: number } {
  const hour = Number.isFinite(closeoutHour) ? Math.min(23, Math.max(0, Math.trunc(closeoutHour))) : 4;
  const { minute } = venueLocalParts(at, tz);
  const { y, m1, d } = venueLocalYMD(at, tz);
  const proxy = Date.UTC(y, m1 - 1, d);
  const day = new Date(minute < hour * 60 ? proxy - DAY_MS : proxy);
  return { y: day.getUTCFullYear(), m1: day.getUTCMonth() + 1, d: day.getUTCDate(), dow: day.getUTCDay() };
}
