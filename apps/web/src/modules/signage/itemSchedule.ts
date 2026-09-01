import { dayAllowed, venueBusinessDay } from "./venueTime";

/**
 * Pure per-ITEM airing rules for a rotation asset (signage_items).
 *
 * NO react, NO supabase — imported by the display (useSignage.resolveRotation), by the hub
 * surfaces, and by the unit test (scripts/test-item-schedule.ts), exactly like eventStage.ts
 * and scheduleResolve.ts.
 *
 * Two independent gates, ANDed:
 *   1. the one-shot window  — starts_at / ends_at (unchanged; what resolveRotation always did)
 *   2. the recurrence gate  — signage_items.recurrence jsonb (migration 0009), which until now
 *      was persisted + badged and consumed by NOTHING. It is honored HERE, at read time, in the
 *      venue's business day — never a cron re-arm that rewrites starts_at/ends_at (the 0051
 *      "expiry DERIVED at read, never precomputed" pattern: a screen that is off all night can
 *      come back and still resolve correctly, and nothing can leave a stale row behind).
 *
 * BUSINESS DAY, not calendar day: a Tuesdays-only slide is still on screen at 1:30 AM Wednesday,
 * because the bar is still in Tuesday night's service until the 04:00 closeout rollover. All of
 * the DST-correct wall-clock math lives in venueTime.venueBusinessDay — this module never
 * reimplements it, and depends on nothing heavier, so the public website can gate its 🌐 promos
 * on the same rule without pulling the program-schedule resolver into the eager Home bundle.
 *
 * DECISION: the persisted shape is UNCHANGED — { kind:'weekly', daysOfWeek:['TU',…] } |
 *   { kind:'annual', month, day }, exactly what ItemEditor's RecurrenceField has always written
 *   (0009/0010 comment shape). The task brief allowed extending it to { days:number[] }; that
 *   would have been a second weekday vocabulary in a codebase where 'MO'..'SU' tokens are
 *   already the idiom (scheduled_events.recurrence.daysOfWeek, slot_program_schedule.days_of_week
 *   / 0051, scheduleResolve.dayAllowed). Nothing to migrate, nothing to backfill.
 *
 * DECISION: NO daily time window. The 0009 comment mentions "plus a time window", but no such
 *   field was ever written by the editor and none is read here. An item that must appear only
 *   during part of a day is a WINDOW event (docs/13), which already owns that behaviour with a
 *   whole scheduling engine behind it; duplicating it on rotation assets would give the owner
 *   two different places to author the same thing. The shape stays additive-friendly if that
 *   ever changes.
 *
 * DECISION: ANNUAL is honored the same way (business day's month/day must match) rather than
 *   left badge-only. It is the same one-line gate, it is what the badge has always implied, and
 *   it is provably a zero-regression change: at build time ZERO rows in signage_items carried a
 *   non-null recurrence (live probe), so no running slide's behaviour changes.
 *
 * DECISION: a malformed / unknown recurrence value FAILS OPEN (parsed as null ⇒ the item airs on
 *   its window alone). A TV must never go dark because a jsonb blob was hand-edited into a shape
 *   this parser doesn't know — same fail-open posture as resolveRotation's unknown-guid rule.
 */

/** recurrence jsonb shape (0009; same family as scheduled_events). null = one-shot / always. */
export type ItemRecurrence =
  | { kind: "annual"; month: number; day: number }
  | { kind: "weekly"; daysOfWeek: string[] };

/** The venue's clock: timezone + business-day closeout hour (venue_settings.toast_closeout_hour). */
export interface VenueClock {
  timezone: string;
  closeoutHour: number;
}

/** Fallbacks, matching useVenue()/useCloseoutHour() exactly — used when the venue queries have
 *  not resolved yet, so a first paint can't accidentally hide a slide. */
export const DEFAULT_VENUE_CLOCK: VenueClock = { timezone: "America/Chicago", closeoutHour: 4 };

/** The item fields these rules read. Both SignageItem and AdminItem satisfy it. */
export interface SchedulableItem {
  starts_at: string | null;
  ends_at: string | null;
  recurrence?: ItemRecurrence | null;
}

const DOW_TOKENS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
/** Plural chip words, indexed by JS weekday (0=Sun). */
const DOW_PLURAL = ["SUNDAYS", "MONDAYS", "TUESDAYS", "WEDNESDAYS", "THURSDAYS", "FRIDAYS", "SATURDAYS"];
const DOW_SHORT: Record<string, string> = { SU: "SUN", MO: "MON", TU: "TUE", WE: "WED", TH: "THU", FR: "FRI", SA: "SAT" };
/** Week order for chip labels — Mon-first, matching the events builder's DOW. */
const CHIP_ORDER = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Read a raw recurrence jsonb value into the typed shape. Anything unrecognised → null
 * (fail open). Day tokens are upper-cased and filtered to the seven real ones, so a stray
 * "" / "MON" / 3 in the array can't silently match nothing and black the slide out.
 */
/** Days in a 1..12 month, counting Feb as 29 — a Feb 29 rule is legal and simply doesn't fire
 *  in common years, whereas rejecting it would forbid a real date. Used by the editor's DAY
 *  clamp and by parseRecurrence to reject dates no business day can ever match (Feb 31). */
export function daysInMonth(month: number): number {
  const lengths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[Math.min(11, Math.max(0, Math.trunc(month) - 1))];
}

export function parseRecurrence(raw: unknown): ItemRecurrence | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "weekly") {
    const src = Array.isArray(r.daysOfWeek) ? r.daysOfWeek : [];
    const days = src
      .filter((d): d is string => typeof d === "string")
      .map((d) => d.trim().toUpperCase())
      .filter((d) => (DOW_TOKENS as readonly string[]).includes(d));
    return { kind: "weekly", daysOfWeek: [...new Set(days)] };
  }
  if (r.kind === "annual") {
    const month = Number(r.month);
    const day = Number(r.day);
    if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
    if (month < 1 || month > 12 || day < 1) return null;
    // An impossible date (Feb 31) can never equal a business day, so honoring it literally
    // would leave the asset queued, badged, and silently never on screen. Fail open instead —
    // running every day is a loud, noticeable error; never running is an invisible one.
    if (day > daysInMonth(month)) return null;
    return { kind: "annual", month: Math.trunc(month), day: Math.trunc(day) };
  }
  return null;
}

/** Is the item inside its one-shot starts_at/ends_at window? (Byte-identical to the rule
 *  resolveRotation applied before this module existed: start inclusive, end exclusive.) */
export function inTimeWindow(item: SchedulableItem, now: Date): boolean {
  const t = now.getTime();
  if (item.starts_at && new Date(item.starts_at).getTime() > t) return false;
  if (item.ends_at && new Date(item.ends_at).getTime() <= t) return false;
  return true;
}

/**
 * Does the recurrence admit TODAY (the venue business day of `now`)?
 *   • no recurrence               → true (evergreen, unchanged)
 *   • weekly with NO days picked  → true — "weekly, days TBD" is the shape RecurrenceField holds
 *     the instant CERTAIN DAYS is clicked, and it is also dayAllowed()'s empty-means-every-day
 *     rule; an unfinished pick must never black out a live slide. The editor now refuses to SAVE
 *     that shape, and it carries its own NO_DAYS_CHIP wherever it does exist, so it can't be
 *     mistaken for a restriction that is silently doing nothing.
 *   • weekly with days            → the business day's weekday is in the set
 *   • annual                      → the business day's month/day matches
 */
export function itemAirsToday(
  item: SchedulableItem, now: Date, venue: VenueClock = DEFAULT_VENUE_CLOCK,
): boolean {
  const rec = parseRecurrence(item.recurrence);
  if (!rec) return true;
  const bday = venueBusinessDay(now, venue.timezone, venue.closeoutHour);
  if (rec.kind === "weekly") return dayAllowed(rec.daysOfWeek, bday.dow);
  return rec.month === bday.m1 && rec.day === bday.d;
}

/** The whole gate: inside its window AND admitted by its recurrence. */
export function itemAirsNow(
  item: SchedulableItem, now: Date, venue: VenueClock = DEFAULT_VENUE_CLOCK,
): boolean {
  return inTimeWindow(item, now) && itemAirsToday(item, now, venue);
}

/** A weekly rule with an EMPTY day set: legal, saved, and behaviourally every-day — but not
 *  what anyone means by picking "CERTAIN DAYS", so it gets its own visible chip rather than
 *  silently looking identical to an unrestricted asset. The editor blocks creating new ones;
 *  this exists for rows that already carry the shape. */
export const NO_DAYS_CHIP = "NO DAYS PICKED";

/** True for the weekly-with-zero-days shape (see NO_DAYS_CHIP). */
export function isEmptyWeekly(raw: unknown): boolean {
  const rec = parseRecurrence(raw);
  return rec?.kind === "weekly" && rec.daysOfWeek.length === 0;
}

/**
 * Short chip label for a recurrence: "TUESDAYS" (one day), "MON·WED·FRI" (several, week order),
 * "JAN 1" (annual), NO_DAYS_CHIP (weekly, nothing picked). null = nothing to show — no
 * recurrence, or all seven days, which IS unrestricted and must not read as a restriction.
 */
export function recurrenceChipLabel(raw: unknown): string | null {
  const rec = parseRecurrence(raw);
  if (!rec) return null;
  if (rec.kind === "annual") return `${MONTHS[rec.month - 1]} ${rec.day}`;
  const set = new Set(rec.daysOfWeek);
  if (set.size === 0) return NO_DAYS_CHIP; // saved as "certain days" but none chosen
  if (set.size === 7) return null;         // every day = no restriction
  const ordered = CHIP_ORDER.filter((d) => set.has(d));
  if (ordered.length === 1) return DOW_PLURAL[DOW_TOKENS.indexOf(ordered[0] as (typeof DOW_TOKENS)[number])];
  return ordered.map((d) => DOW_SHORT[d]).join("·");
}

/** Plain sentence for the editor ("Runs on tuesdays only." / "Runs one day a year — OCT 31."). */
export function recurrenceSentence(raw: unknown): string {
  const rec = parseRecurrence(raw);
  if (!rec) return "Runs whenever it's queued — every day.";
  if (rec.kind === "annual") return `Runs one day a year — ${MONTHS[rec.month - 1]} ${rec.day}.`;
  if (rec.daysOfWeek.length === 0) return "Pick at least one day — nothing is selected yet.";
  const label = recurrenceChipLabel(rec);
  // All seven picked: a real, deliberate selection that happens to mean no restriction.
  if (!label) return "Runs every day.";
  return `Runs on ${label.toLowerCase().replace(/·/g, ", ")} only.`;
}
