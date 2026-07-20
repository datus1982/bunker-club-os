// scheduleResolve.ts (Deno / edge-fn port) — the M3 program+schedule resolver.
//
// ⚠ PARITY REQUIREMENT — PORTED VERBATIM from
//   apps/web/src/modules/signage/scheduleResolve.ts
// This is the SAME pure logic the TV runs to decide what a slot actually plays. The Q-SYS
// `status` command MUST report what the TV shows, not the raw stale slot.program row (the
// WARN-1 hub/TV parity lesson, applied to Q-SYS). If you change one file, change the other.
// Both are mirrored by unit tests:
//   web  → scripts/test-schedule-resolve.ts    (source of truth, 31 asserts)
//   deno → scripts/test-qsys-status-resolve.ts (this port, the boundary-relevant cases)
//
// Dependency-free: no Deno/supabase imports — pure venue-local wall-time math via Intl.
// `mapScheduleRow` (added here) is the fn-side mirror of useSignage.ts's mapper of the same name.

/** The program a slot can run. Minimal shape — only `kind`/`playlist_id` matter to status. */
export type SlotProgram =
  | { kind: "playlist"; playlist_id: string }
  | { kind: "capture"; device_match?: string; presentation?: string; audio?: boolean }
  | { kind: "multiview"; main: unknown; panel_slot_id: string };

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

/** Where the effective program comes from — for the hub/UCI to label the source (parity: the
 *  status readout must show what the TV is ACTUALLY playing, not the raw stale slot.program row). */
export type ProgramSource = "override" | "pinned" | "scheduled" | "rotation";

/** The program the slot should render right now + WHERE it comes from: an UNEXPIRED manual override
 *  wins ('override' for boundary/event, 'pinned' for pin); else the active scheduled daypart
 *  ('scheduled'); else null = rotation ('rotation'). Pure (D3/D4). An expired override (its DB row
 *  is never cleared, DECISION-1) resolves to the schedule/rotation here, exactly as the TV yields. */
export function resolveEffectiveProgramWithSource(
  slot: SlotProgramState, rows: ScheduleRow[], now: Date, tz: string, rolloverHour: number,
): { program: SlotProgram | null; source: ProgramSource } {
  if (slot.program) {
    const hold: ProgramHold = slot.program_hold ?? "pin";
    const setAt = slot.program_set_at ? new Date(slot.program_set_at) : now;
    if (!isHoldExpired(hold, setAt, now, tz, rows, rolloverHour)) {
      return { program: slot.program, source: hold === "pin" ? "pinned" : "override" };
    }
  }
  const scheduled = activeScheduledProgram(rows, now, tz);
  return { program: scheduled, source: scheduled ? "scheduled" : "rotation" };
}

/** The program the slot should render right now (source discarded). */
export function resolveEffectiveProgram(
  slot: SlotProgramState, rows: ScheduleRow[], now: Date, tz: string, rolloverHour: number,
): SlotProgram | null {
  return resolveEffectiveProgramWithSource(slot, rows, now, tz, rolloverHour).program;
}

/** Map a raw slot_program_schedule row to the resolver's ScheduleRow shape (fn-side mirror of
 *  useSignage.ts mapScheduleRow). A null program column ⇒ the {kind:'rotation'} sentinel. */
export function mapScheduleRow(r: {
  id: string; program: unknown; days_of_week: string[] | null;
  start_minute: number; end_minute: number; position: number; active: boolean;
}): ScheduleRow {
  return {
    id: r.id,
    program: (r.program ?? { kind: "rotation" }) as ScheduleProgram,
    daysOfWeek: r.days_of_week ?? [],
    startMinute: r.start_minute,
    endMinute: r.end_minute,
    position: r.position,
    active: r.active,
  };
}
