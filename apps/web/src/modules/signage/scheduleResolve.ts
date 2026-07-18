import type { SlotProgram } from "./mediaProgram";

/**
 * Pure schedule + program-hold resolution (docs/15 §M3, RATIFIED as amended — D3/D4/D5).
 *
 * NO react, NO supabase — imported by the display (useSignage/SlotDisplay) AND by the unit test
 * (scripts/test-schedule-resolve.ts), exactly like eventStage.ts. `import type { SlotProgram }`
 * is erased at compile time, so this module pulls in no runtime deps.
 *
 * D3 (client-derived, no cron): the TV reads anon `slot_program_schedule` rows and derives the
 *   active daypart's program itself, re-derived every render + on a precise boundary timeout.
 * D4 (two-tier manual override, owner-ruled): a manual/Q-SYS flip is stored as
 *   signage_slots.program + program_hold + program_set_at:
 *     'pin'      — permanent (the no-schedule default; unchanged from M1/M2).
 *     'boundary' — a plain flip; yields at the next schedule boundary after program_set_at.
 *     'event'    — a SPECIAL EVENT hold; survives daypart boundaries, expires at the venue
 *                  business-day rollover (04:00 closeout) after program_set_at.
 * D5: media-control writes program_hold='event' by default — same read path, no special case here.
 *
 * All venue-local reasoning is done through Intl (DST-correct wall time), never a fixed offset.
 */

/** A schedule daypart row can run a normal program OR an explicit "back to rotation" daypart. */
export type ScheduleProgram = SlotProgram | { kind: "rotation" };

/** Client shape of a slot_program_schedule row. */
export interface ScheduleRow {
  id: string;
  program: ScheduleProgram;
  /** ['MO','TU',…]; EMPTY = every day (matches the schema default). */
  daysOfWeek: string[];
  /** venue-local minutes past midnight, 0..1439. */
  startMinute: number;
  /** venue-local minutes past midnight, 0..1440; end<=start ⇒ wraps past midnight. */
  endMinute: number;
  /** overlap tiebreak — higher wins when two rows cover "now". */
  position: number;
  active: boolean;
}

/** The manual override hold tier stored on signage_slots.program_hold. */
export type ProgramHold = "pin" | "boundary" | "event";

/** The slot columns this module reasons over (program + the D4 hold pair). */
export interface SlotProgramState {
  program: SlotProgram | null;
  program_hold: ProgramHold | null;
  program_set_at: string | null; // ISO
}

const TOK2NUM: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const WD2NUM: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DAY_MS = 86_400_000;

/* ── venue-local wall-time helpers (Intl-based, DST-correct) ─────────────────────── */

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
function venueLocalYMD(at: Date, tz: string): { y: number; m1: number; d: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(at).filter((x) => x.type !== "literal").map((x) => [x.type, parseInt(x.value, 10)]),
  ) as { year: number; month: number; day: number };
  return { y: p.year, m1: p.month, d: p.day };
}

/** Offset (ms) of `tz` at `at`: (that wall clock read back as UTC) − at. */
function tzOffsetMs(at: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(at).filter((x) => x.type !== "literal").map((x) => [x.type, parseInt(x.value, 10)]),
  ) as Record<string, number>;
  const hour = p.hour === 24 ? 0 : p.hour;
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second);
  return asUTC - at.getTime();
}

/** venue-local wall time (Y, M1..12, D, minutesPastMidnight) → the UTC instant (DST-safe, 2-pass). */
function zonedWallToInstant(y: number, m1: number, d: number, minutes: number, tz: string): Date {
  const naiveUTC = Date.UTC(y, m1 - 1, d, Math.floor(minutes / 60), minutes % 60);
  let inst = naiveUTC - tzOffsetMs(new Date(naiveUTC), tz);
  inst = naiveUTC - tzOffsetMs(new Date(inst), tz); // refine across a DST edge
  return new Date(inst);
}

/* ── coverage ────────────────────────────────────────────────────────────────────── */

function dayAllowed(days: string[], dow: number): boolean {
  if (days.length === 0) return true; // empty = every day
  for (const d of days) if (TOK2NUM[d.toUpperCase()] === dow) return true;
  return false;
}

/** Does a row cover the venue-local (dow, minute)? Wrap-past-midnight aware: the post-midnight
 *  portion of a wrapping daypart belongs to the day it STARTED (the previous weekday). */
export function rowCovers(row: ScheduleRow, dow: number, minute: number): boolean {
  if (!row.active) return false;
  const wraps = row.endMinute <= row.startMinute;
  if (!wraps) {
    return dayAllowed(row.daysOfWeek, dow) && minute >= row.startMinute && minute < row.endMinute;
  }
  const prevDow = (dow + 6) % 7;
  const preMidnight = dayAllowed(row.daysOfWeek, dow) && minute >= row.startMinute;
  const postMidnight = dayAllowed(row.daysOfWeek, prevDow) && minute < row.endMinute;
  return preMidnight || postMidnight;
}

/** The program the covering daypart runs now (highest position wins, id as a stable tiebreak),
 *  or null = rotation (no covering row, or the covering row is the {kind:'rotation'} sentinel). */
export function activeScheduledProgram(rows: ScheduleRow[], at: Date, tz: string): SlotProgram | null {
  const { dow, minute } = venueLocalParts(at, tz);
  let best: ScheduleRow | null = null;
  for (const r of rows) {
    if (!rowCovers(r, dow, minute)) continue;
    if (!best || r.position > best.position || (r.position === best.position && r.id > best.id)) best = r;
  }
  if (!best) return null;
  return best.program.kind === "rotation" ? null : (best.program as SlotProgram);
}

/* ── boundaries + rollover ─────────────────────────────────────────────────────────── */

/** The next instant strictly after `from` at which any active daypart edge (start OR end) occurs,
 *  or null when there are no active rows (⇒ a 'boundary' hold behaves as a permanent pin). */
export function nextBoundary(rows: ScheduleRow[], from: Date, tz: string): Date | null {
  const active = rows.filter((r) => r.active);
  if (active.length === 0) return null;
  const base = venueLocalYMD(from, tz);
  const baseUTC = Date.UTC(base.y, base.m1 - 1, base.d);
  const fromMs = from.getTime();
  let best: number | null = null;
  const consider = (inst: Date) => {
    const t = inst.getTime();
    if (t > fromMs && (best === null || t < best)) best = t;
  };
  // −1 catches a wrapping daypart's END edge that lands "today" from yesterday's start.
  for (let off = -1; off <= 8; off++) {
    const day = new Date(baseUTC + off * DAY_MS);
    const y = day.getUTCFullYear(), m1 = day.getUTCMonth() + 1, d = day.getUTCDate();
    const dow = day.getUTCDay();
    for (const r of active) {
      if (!dayAllowed(r.daysOfWeek, dow)) continue;
      consider(zonedWallToInstant(y, m1, d, r.startMinute, tz));
      if (r.endMinute > r.startMinute) {
        consider(zonedWallToInstant(y, m1, d, r.endMinute, tz));
      } else {
        const nd = new Date(Date.UTC(y, m1 - 1, d) + DAY_MS);
        consider(zonedWallToInstant(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate(), r.endMinute, tz));
      }
    }
  }
  return best === null ? null : new Date(best);
}

/** The next venue-local rolloverHour:00 strictly after `from` (business-day closeout, default 4 = 04:00). */
export function nextRollover(from: Date, tz: string, rolloverHour: number): Date {
  const { y, m1, d } = venueLocalYMD(from, tz);
  const today = zonedWallToInstant(y, m1, d, rolloverHour * 60, tz);
  if (today.getTime() > from.getTime()) return today;
  const nd = new Date(Date.UTC(y, m1 - 1, d) + DAY_MS);
  return zonedWallToInstant(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate(), rolloverHour * 60, tz);
}

/* ── the effective program (override + schedule) ─────────────────────────────────────── */

/** Has the manual override expired given its hold tier (D4)? */
export function isHoldExpired(
  hold: ProgramHold, setAt: Date, now: Date, tz: string, rows: ScheduleRow[], rolloverHour: number,
): boolean {
  if (hold === "pin") return false;
  if (hold === "boundary") {
    const b = nextBoundary(rows, setAt, tz);
    return b !== null && b.getTime() <= now.getTime();
  }
  // 'event': survives boundaries; expires at the next rollover after it was set.
  return nextRollover(setAt, tz, rolloverHour).getTime() <= now.getTime();
}

/** The program the slot should render right now: an UNEXPIRED manual override wins; else the
 *  active scheduled program; else null = rotation. Pure (D3/D4). */
export function resolveEffectiveProgram(
  slot: SlotProgramState, rows: ScheduleRow[], now: Date, tz: string, rolloverHour: number,
): SlotProgram | null {
  if (slot.program) {
    const hold: ProgramHold = slot.program_hold ?? "pin";
    const setAt = slot.program_set_at ? new Date(slot.program_set_at) : now;
    if (!isHoldExpired(hold, setAt, now, tz, rows, rolloverHour)) return slot.program;
  }
  return activeScheduledProgram(rows, now, tz);
}

/** The next instant the effective program could change — for a precise re-render timeout (a crisp
 *  daypart/override flip; the display's 30s tick is the safety net). null = nothing scheduled/held. */
export function nextTransition(
  slot: SlotProgramState, rows: ScheduleRow[], now: Date, tz: string, rolloverHour: number,
): Date | null {
  const cands: number[] = [];
  const b = nextBoundary(rows, now, tz);
  if (b) cands.push(b.getTime());
  if (slot.program && slot.program_hold && slot.program_hold !== "pin") {
    const setAt = slot.program_set_at ? new Date(slot.program_set_at) : now;
    const exp = slot.program_hold === "event"
      ? nextRollover(setAt, tz, rolloverHour)
      : nextBoundary(rows, setAt, tz);
    if (exp && exp.getTime() > now.getTime()) cands.push(exp.getTime());
  }
  return cands.length ? new Date(Math.min(...cands)) : null;
}

/* ── plain-phrase helpers for the hub (day chips / TILL CLOSE / "daily 4 PM – close") ──── */

const DAY_ORDER = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const DAY_SHORT: Record<string, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };

/** "4:00 PM" for minutes past venue-local midnight (1440 → "12:00 AM"). */
export function minuteLabel(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  let h = Math.floor(mm / 60);
  const min = mm % 60;
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(min).padStart(2, "0")} ${ap}`;
}

/** "daily" (empty or all 7), else "Mon, Tue" in week order. */
export function daysPhrase(days: string[]): string {
  const set = new Set(days.map((d) => d.toUpperCase()));
  if (set.size === 0 || set.size === 7) return "daily";
  return DAY_ORDER.filter((d) => set.has(d)).map((d) => DAY_SHORT[d]).join(", ");
}

/** A daypart phrase: "daily · 4:00 PM – close" (endMinute===closeMinute renders "close"). */
export function schedulePhrase(row: { daysOfWeek: string[]; startMinute: number; endMinute: number }, closeMinute: number | null): string {
  const end = closeMinute != null && row.endMinute === closeMinute ? "close" : minuteLabel(row.endMinute);
  return `${daysPhrase(row.daysOfWeek)} · ${minuteLabel(row.startMinute)} – ${end}`;
}
