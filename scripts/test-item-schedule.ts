/**
 * Unit test for the per-ITEM airing rules (window + recurrence weekday/annual gate).
 * `npx tsx scripts/test-item-schedule.ts` (pnpm test:itemschedule).
 *
 * Imports the PURE module (no react / supabase / `@/` alias), exactly like
 * test-schedule-resolve.ts. Asserts: weekday match in the venue BUSINESS day (the 04:00
 * rollover, so Tuesday night runs past midnight), null-recurrence passthrough, empty-days
 * passthrough, starts_at/ends_at intersection, annual, malformed fail-open, chip labels, and
 * DST-transition days. All instants hand-computed for America/Chicago
 * (CDT = UTC−5 summer, CST = UTC−6 winter).
 */
import {
  itemAirsNow, itemAirsToday, inTimeWindow, parseRecurrence,
  recurrenceChipLabel, recurrenceSentence, DEFAULT_VENUE_CLOCK,
  type SchedulableItem, type VenueClock,
} from "../apps/web/src/modules/signage/itemSchedule.ts";
import { venueBusinessDay } from "../apps/web/src/modules/signage/scheduleResolve.ts";

let failures = 0;
function assert(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    got  ${g}\n    want ${w}`}`);
}

const VENUE: VenueClock = { timezone: "America/Chicago", closeoutHour: 4 };

/** An asset with no window at all — recurrence is then the only gate. */
const item = (recurrence: unknown, starts_at: string | null = null, ends_at: string | null = null): SchedulableItem =>
  ({ starts_at, ends_at, recurrence: recurrence as SchedulableItem["recurrence"] });

const TUESDAYS = { kind: "weekly", daysOfWeek: ["TU"] };
const MWF = { kind: "weekly", daysOfWeek: ["MO", "WE", "FR"] };

/* Summer (CDT, UTC−5). 2026-09-01 is a TUESDAY. */
const tue10am = new Date("2026-09-01T15:00:00Z"); // Tue 10:00 AM CDT
const tue5pm  = new Date("2026-09-01T22:00:00Z"); // Tue  5:00 PM CDT
const tue1130 = new Date("2026-09-02T04:30:00Z"); // Tue 11:30 PM CDT
const wed130  = new Date("2026-09-02T06:30:00Z"); // Wed  1:30 AM CDT — still TUESDAY's service
const wed359  = new Date("2026-09-02T08:59:00Z"); // Wed  3:59 AM CDT — last minute of Tuesday
const wed430  = new Date("2026-09-02T09:30:00Z"); // Wed  4:30 AM CDT — Wednesday now
const wed6pm  = new Date("2026-09-02T23:00:00Z"); // Wed  6:00 PM CDT

/* ── venueBusinessDay: the rollover is the whole point ────────────────── */
assert("bizday Tue 5PM      → Tue",  venueBusinessDay(tue5pm,  "America/Chicago", 4), { y: 2026, m1: 9, d: 1, dow: 2 });
assert("bizday Tue 11:30PM  → Tue",  venueBusinessDay(tue1130, "America/Chicago", 4), { y: 2026, m1: 9, d: 1, dow: 2 });
assert("bizday Wed 1:30AM   → Tue",  venueBusinessDay(wed130,  "America/Chicago", 4), { y: 2026, m1: 9, d: 1, dow: 2 });
assert("bizday Wed 3:59AM   → Tue",  venueBusinessDay(wed359,  "America/Chicago", 4), { y: 2026, m1: 9, d: 1, dow: 2 });
assert("bizday Wed 4:30AM   → Wed",  venueBusinessDay(wed430,  "America/Chicago", 4), { y: 2026, m1: 9, d: 2, dow: 3 });
// closeoutHour 0 = plain calendar day (a venue with no late service).
assert("bizday Wed 1:30AM, closeout 0 → Wed", venueBusinessDay(wed130, "America/Chicago", 0), { y: 2026, m1: 9, d: 2, dow: 3 });

/* ── the owner's case: a TUESDAYS-only slide ──────────────────────────── */
assert("TUE slide @ Tue 10AM airs",            itemAirsNow(item(TUESDAYS), tue10am, VENUE), true);
assert("TUE slide @ Tue 11:30PM airs",         itemAirsNow(item(TUESDAYS), tue1130, VENUE), true);
assert("TUE slide @ Wed 1:30AM STILL airs",    itemAirsNow(item(TUESDAYS), wed130,  VENUE), true);
assert("TUE slide @ Wed 3:59AM STILL airs",    itemAirsNow(item(TUESDAYS), wed359,  VENUE), true);
assert("TUE slide @ Wed 4:30AM is OFF",        itemAirsNow(item(TUESDAYS), wed430,  VENUE), false);
assert("TUE slide @ Wed 6PM is OFF",           itemAirsNow(item(TUESDAYS), wed6pm,  VENUE), false);

/* ── multi-day sets ───────────────────────────────────────────────────── */
assert("MON·WED·FRI @ Tue 5PM off",            itemAirsNow(item(MWF), tue5pm, VENUE), false);
assert("MON·WED·FRI @ Wed 6PM airs",           itemAirsNow(item(MWF), wed6pm, VENUE), true);
assert("MON·WED·FRI @ Wed 1:30AM off (=Tue)",  itemAirsNow(item(MWF), wed130, VENUE), false);
// Lowercase / stray tokens are normalised, not treated as a no-match blackout.
assert("lowercase 'tu' still matches Tuesday", itemAirsNow(item({ kind: "weekly", daysOfWeek: ["tu"] }), tue5pm, VENUE), true);
assert("junk token dropped, real one kept",    itemAirsNow(item({ kind: "weekly", daysOfWeek: ["TU", "MON", ""] }), tue5pm, VENUE), true);

/* ── no recurrence / empty days = unchanged behaviour ─────────────────── */
assert("null recurrence always airs",          itemAirsNow(item(null), wed6pm, VENUE), true);
assert("undefined recurrence always airs",     itemAirsNow({ starts_at: null, ends_at: null }, wed6pm, VENUE), true);
assert("weekly with NO days airs (every day)", itemAirsNow(item({ kind: "weekly", daysOfWeek: [] }), wed6pm, VENUE), true);
assert("all 7 days airs",                      itemAirsNow(item({ kind: "weekly", daysOfWeek: ["SU","MO","TU","WE","TH","FR","SA"] }), wed6pm, VENUE), true);

/* ── malformed jsonb FAILS OPEN (a TV must never go dark over a bad blob) ─ */
assert("garbage recurrence airs",              itemAirsNow(item({ kind: "lunar", every: 3 }), wed6pm, VENUE), true);
assert("string recurrence airs",               itemAirsNow(item("TUESDAYS"), wed6pm, VENUE), true);
assert("annual with bad month airs",           itemAirsNow(item({ kind: "annual", month: 13, day: 1 }), wed6pm, VENUE), true);
assert("parse garbage → null",                 parseRecurrence({ kind: "lunar" }), null);
assert("parse dedupes + uppercases",           parseRecurrence({ kind: "weekly", daysOfWeek: ["tu", "TU", "xx"] }), { kind: "weekly", daysOfWeek: ["TU"] });

/* ── the window still applies ON TOP of the day rule ──────────────────── */
const endedTue = item(TUESDAYS, null, "2026-09-01T18:00:00Z"); // ended Tue 1 PM CDT
const startsLater = item(TUESDAYS, "2026-09-08T22:00:00Z", null); // starts NEXT Tuesday
assert("right day but window ENDED → off",     itemAirsNow(endedTue, tue5pm, VENUE), false);
assert("right day but not STARTED → off",      itemAirsNow(startsLater, tue5pm, VENUE), false);
assert("…and the day rule is still true",      itemAirsToday(endedTue, tue5pm, VENUE), true);
assert("window-only item (no recurrence) airs", itemAirsNow(item(null, "2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z"), tue5pm, VENUE), true);
assert("ends_at is EXCLUSIVE (unchanged rule)", inTimeWindow(item(null, null, "2026-09-01T22:00:00Z"), tue5pm), false);
assert("starts_at is INCLUSIVE (unchanged)",    inTimeWindow(item(null, "2026-09-01T22:00:00Z", null), tue5pm), true);

/* ── annual ───────────────────────────────────────────────────────────── */
const halloween = { kind: "annual", month: 10, day: 31 };
const oct31_8pm = new Date("2026-11-01T01:00:00Z"); // Sat Oct 31, 8:00 PM CDT
const nov1_2am  = new Date("2026-11-01T07:00:00Z"); // Sun Nov 1, 1:00 AM CST (the fall-back
                                                    // repeat hour) — still Oct 31's night
const nov1_6pm  = new Date("2026-11-02T00:00:00Z"); // Sun Nov 1, 6:00 PM CST
assert("annual Oct 31 @ 8PM airs",             itemAirsNow(item(halloween), oct31_8pm, VENUE), true);
assert("annual Oct 31 @ Nov1 1AM still airs",  itemAirsNow(item(halloween), nov1_2am,  VENUE), true);
assert("annual Oct 31 @ Nov1 6PM off",         itemAirsNow(item(halloween), nov1_6pm,  VENUE), false);

/* ── DST edges (the reason none of this reimplements offset math) ─────── */
// Spring forward: Sun 2026-03-08, 2 AM CST → 3 AM CDT (08:00Z). 3:30 AM CDT is BEFORE the
// 4 AM closeout, so it still belongs to SATURDAY's business day — and note the naive
// "subtract 4 hours from the instant" shortcut would land an hour off here.
const springSun330 = new Date("2026-03-08T08:30:00Z"); // 3:30 AM CDT
const springSun430 = new Date("2026-03-08T09:30:00Z"); // 4:30 AM CDT — Sunday has begun
assert("spring-forward 3:30AM → Saturday",     venueBusinessDay(springSun330, "America/Chicago", 4).dow, 6);
assert("SAT slide airs at spring-forward 3:30AM", itemAirsNow(item({ kind: "weekly", daysOfWeek: ["SA"] }), springSun330, VENUE), true);
assert("spring-forward 4:30AM → Sunday",       venueBusinessDay(springSun430, "America/Chicago", 4).dow, 0);
assert("SAT slide OFF at spring-forward 4:30AM", itemAirsNow(item({ kind: "weekly", daysOfWeek: ["SA"] }), springSun430, VENUE), false);
// Fall back: Sun 2026-11-01, 2 AM CDT → 1 AM CST. The 1:30 AM local hour happens TWICE;
// both instants are before closeout, so both belong to Saturday — no flap.
const fallFirst  = new Date("2026-11-01T06:30:00Z"); // 1:30 AM CDT (first pass)
const fallSecond = new Date("2026-11-01T07:30:00Z"); // 1:30 AM CST (second pass)
assert("fall-back 1:30AM pass 1 → Saturday",   venueBusinessDay(fallFirst,  "America/Chicago", 4).dow, 6);
assert("fall-back 1:30AM pass 2 → Saturday",   venueBusinessDay(fallSecond, "America/Chicago", 4).dow, 6);
// Winter (CST, UTC−6): Tue 2026-12-15 6 PM CST.
const decTue6pm = new Date("2026-12-16T00:00:00Z");
assert("TUE slide airs in winter (CST)",       itemAirsNow(item(TUESDAYS), decTue6pm, VENUE), true);

/* ── a non-US venue clock is honored (nothing is hardcoded to Chicago) ── */
const NYC: VenueClock = { timezone: "America/New_York", closeoutHour: 4 };
// Wed 2:30 AM CDT = Wed 3:30 AM EDT — before closeout in BOTH, so Tuesday either way.
assert("NYC clock: Wed 3:30AM ET → Tuesday",   venueBusinessDay(new Date("2026-09-02T07:30:00Z"), "America/New_York", 4).dow, 2);
assert("NYC TUE slide airs then",              itemAirsNow(item(TUESDAYS), new Date("2026-09-02T07:30:00Z"), NYC), true);
// Wed 5:30 AM ET (4:30 CDT) is Wednesday in NY but the Chicago clock agrees here too.
assert("NYC clock: Wed 5:30AM ET → Wednesday", venueBusinessDay(new Date("2026-09-02T09:30:00Z"), "America/New_York", 4).dow, 3);

/* ── defaults match useVenue()/useCloseoutHour() ──────────────────────── */
assert("default clock",                         DEFAULT_VENUE_CLOCK, { timezone: "America/Chicago", closeoutHour: 4 });
assert("default clock used when omitted",       itemAirsNow(item(TUESDAYS), wed130), true);

/* ── chip labels + editor sentence ────────────────────────────────────── */
assert("chip one day",                          recurrenceChipLabel(TUESDAYS), "TUESDAYS");
assert("chip three days (week order)",          recurrenceChipLabel({ kind: "weekly", daysOfWeek: ["FR", "MO", "WE"] }), "MON·WED·FRI");
assert("chip includes Sunday last",             recurrenceChipLabel({ kind: "weekly", daysOfWeek: ["SU", "SA"] }), "SAT·SUN");
assert("chip all 7 = no restriction",           recurrenceChipLabel({ kind: "weekly", daysOfWeek: ["SU","MO","TU","WE","TH","FR","SA"] }), null);
assert("chip empty = no restriction",           recurrenceChipLabel({ kind: "weekly", daysOfWeek: [] }), null);
assert("chip null",                             recurrenceChipLabel(null), null);
assert("chip annual",                           recurrenceChipLabel(halloween), "OCT 31");
assert("sentence weekly",                       recurrenceSentence(TUESDAYS), "Runs on tuesdays only.");
assert("sentence multi",                        recurrenceSentence(MWF), "Runs on mon, wed, fri only.");
assert("sentence none",                         recurrenceSentence(null), "Runs whenever it's queued — every day.");
assert("sentence weekly-no-days",               recurrenceSentence({ kind: "weekly", daysOfWeek: [] }), "No days picked yet — it runs every day until you pick some.");
assert("sentence annual",                       recurrenceSentence(halloween), "Runs one day a year — OCT 31.");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
