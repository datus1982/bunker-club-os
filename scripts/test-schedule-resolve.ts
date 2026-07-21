/**
 * Unit test for the media M3 schedule + program-hold resolver (docs/15 §M3, D3/D4/D5).
 * `npx tsx scripts/test-schedule-resolve.ts` (pnpm test:scheduleresolve).
 *
 * Imports the PURE module (no react / supabase / `@/` alias). Asserts venue-TZ coverage,
 * wrap-past-midnight / TILL CLOSE dayparts, overlap tiebreak, the TWO hold tiers (boundary vs
 * event) with the owner's overtime case, business-day rollover expiry, and DST-transition math.
 * All instants hand-computed for America/Chicago (CDT = UTC−5 summer, CST = UTC−6 winter).
 */
import {
  rowCovers, activeScheduledProgram, resolveEffectiveProgram, isHoldExpired,
  nextBoundary, nextRollover, venueLocalParts,
  type ScheduleRow, type SlotProgramState,
} from "../apps/web/src/modules/signage/scheduleResolve.ts";

let failures = 0;
function assert(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    got  ${g}\n    want ${w}`}`);
}

const TZ = "America/Chicago";
const ROLL = 4; // 04:00 closeout

// Summer (CDT, UTC−5) instants — Wed 2026-07-15 / Thu 2026-07-16.
const wed3pm = new Date("2026-07-15T20:00:00Z"); // 3:00 PM CDT
const wed4pm = new Date("2026-07-15T21:00:00Z"); // 4:00 PM CDT
const wed5pm = new Date("2026-07-15T22:00:00Z"); // 5:00 PM CDT  (a manual flip)
const wed6pm = new Date("2026-07-15T23:00:00Z"); // 6:00 PM CDT
const thu1am = new Date("2026-07-16T06:00:00Z"); // 1:00 AM CDT
const thu230 = new Date("2026-07-16T07:30:00Z"); // 2:30 AM CDT  (after the 2 AM daypart end)
const thu3am = new Date("2026-07-16T08:00:00Z"); // 3:00 AM CDT
const thu5am = new Date("2026-07-16T10:00:00Z"); // 5:00 AM CDT  (after 4 AM rollover)

const PLAY: ScheduleRow = {
  id: "r1", program: { kind: "playlist", playlist_id: "P1" },
  daysOfWeek: [], startMinute: 960 /*4 PM*/, endMinute: 120 /*2 AM, TILL CLOSE → wraps*/,
  position: 0, active: true,
};
const CAP = { kind: "capture", device_match: "Roku" } as const;

/* ── venueLocalParts ─────────────────────────────────────────────── */
assert("localParts Wed 4PM", venueLocalParts(wed4pm, TZ), { dow: 3, minute: 960 });
assert("localParts Thu 1AM", venueLocalParts(thu1am, TZ), { dow: 4, minute: 60 });

/* ── coverage (wrap past midnight / TILL CLOSE) ──────────────────── */
assert("covers Wed 4PM (start edge)", rowCovers(PLAY, 3, 960), true);
assert("covers Wed 3PM (before start)", rowCovers(PLAY, 3, 900), false);
assert("covers Thu 1AM (post-midnight, from Wed)", rowCovers(PLAY, 4, 60), true);
assert("covers Thu 3AM (after 2AM end)", rowCovers(PLAY, 4, 180), false);
assert("scheduled @ Wed 6PM", activeScheduledProgram([PLAY], wed6pm, TZ), { kind: "playlist", playlist_id: "P1" });
assert("scheduled @ Thu 3AM = rotation(null)", activeScheduledProgram([PLAY], thu3am, TZ), null);

/* ── overlap tiebreak: higher position wins ──────────────────────── */
const CAPROW: ScheduleRow = {
  id: "r2", program: CAP, daysOfWeek: ["WE"], startMinute: 960, endMinute: 1320 /*10 PM*/,
  position: 5, active: true,
};
assert("overlap → higher position wins", activeScheduledProgram([PLAY, CAPROW], wed6pm, TZ), CAP);

/* ── explicit rotation daypart sentinel ──────────────────────────── */
const ROT: ScheduleRow = { id: "r3", program: { kind: "rotation" }, daysOfWeek: [], startMinute: 960, endMinute: 1140 /*7 PM*/, position: 9, active: true };
assert("rotation sentinel → null", activeScheduledProgram([PLAY, ROT], wed6pm, TZ), null);

/* ── CAROUSEL program value flows through the resolver like any other ── */
const CAROUSEL = { kind: "carousel", order: "random" } as const;
const CAROUSEL_ROW: ScheduleRow = {
  id: "rc", program: CAROUSEL, daysOfWeek: [], startMinute: 960, endMinute: 120, position: 0, active: true,
};
assert("scheduled carousel @ Wed 6PM", activeScheduledProgram([CAROUSEL_ROW], wed6pm, TZ), CAROUSEL);
assert("scheduled carousel @ Thu 3AM = rotation(null)", activeScheduledProgram([CAROUSEL_ROW], thu3am, TZ), null);
const carouselFlip: SlotProgramState = { program: { kind: "carousel", order: "ordered" }, program_hold: "event", program_set_at: wed5pm.toISOString() };
assert("eff carousel override @ Wed 6PM = carousel", resolveEffectiveProgram(carouselFlip, [PLAY], wed6pm, TZ, ROLL), { kind: "carousel", order: "ordered" });
assert("eff carousel event @ Thu 5AM = rotation (rolled over)", resolveEffectiveProgram(carouselFlip, [PLAY], thu5am, TZ, ROLL), null);
assert("null program + carousel daypart → carousel", resolveEffectiveProgram({ program: null, program_hold: null, program_set_at: null }, [CAROUSEL_ROW], wed6pm, TZ, ROLL), CAROUSEL);

/* ── boundaries + rollover ───────────────────────────────────────── */
assert("nextBoundary Wed 6PM → Thu 2AM", nextBoundary([PLAY], wed6pm, TZ)?.toISOString(), "2026-07-16T07:00:00.000Z");
assert("nextBoundary Wed 3PM → Wed 4PM (start)", nextBoundary([PLAY], wed3pm, TZ)?.toISOString(), "2026-07-15T21:00:00.000Z");
assert("nextBoundary no rows → null", nextBoundary([], wed6pm, TZ), null);
assert("nextRollover Thu 1AM → Thu 4AM CDT", nextRollover(thu1am, TZ, ROLL).toISOString(), "2026-07-16T09:00:00.000Z");
assert("nextRollover Thu 5AM → Fri 4AM CDT", nextRollover(thu5am, TZ, ROLL).toISOString(), "2026-07-17T09:00:00.000Z");

/* ── D4 two-tier hold: boundary vs event (the overtime case) ─────── */
// A plain flip (boundary) set at Wed 5 PM yields at the next boundary (Thu 2 AM).
assert("boundary: not expired @ Wed 6PM", isHoldExpired("boundary", wed5pm, wed6pm, TZ, [PLAY], ROLL), false);
assert("boundary: EXPIRED @ Thu 2:30AM", isHoldExpired("boundary", wed5pm, thu230, TZ, [PLAY], ROLL), true);
// A SPECIAL EVENT hold set at Wed 5 PM SURVIVES the 2 AM boundary, dies at the 4 AM rollover.
assert("event: SURVIVES 2AM boundary @ Thu 2:30AM", isHoldExpired("event", wed5pm, thu230, TZ, [PLAY], ROLL), false);
assert("event: EXPIRED @ Thu 5AM (past rollover)", isHoldExpired("event", wed5pm, thu5am, TZ, [PLAY], ROLL), true);
assert("pin: never expires", isHoldExpired("pin", wed5pm, thu5am, TZ, [PLAY], ROLL), false);

/* ── resolveEffectiveProgram: override + schedule together ───────── */
const flipBoundary: SlotProgramState = { program: CAP, program_hold: "boundary", program_set_at: wed5pm.toISOString() };
const flipEvent: SlotProgramState = { program: CAP, program_hold: "event", program_set_at: wed5pm.toISOString() };
assert("eff boundary @ Wed 6PM = capture (override)", resolveEffectiveProgram(flipBoundary, [PLAY], wed6pm, TZ, ROLL), CAP);
assert("eff boundary @ Thu 2:30AM = rotation (yielded)", resolveEffectiveProgram(flipBoundary, [PLAY], thu230, TZ, ROLL), null);
assert("eff event @ Thu 2:30AM = capture (overtime hold)", resolveEffectiveProgram(flipEvent, [PLAY], thu230, TZ, ROLL), CAP);
assert("eff event @ Thu 5AM = rotation (rolled over)", resolveEffectiveProgram(flipEvent, [PLAY], thu5am, TZ, ROLL), null);

/* ── no schedule ⇒ manual is a permanent pin (unchanged from M1/M2) ─ */
const noSchedPin: SlotProgramState = { program: CAP, program_hold: "pin", program_set_at: wed5pm.toISOString() };
const noSchedBoundary: SlotProgramState = { program: CAP, program_hold: "boundary", program_set_at: wed5pm.toISOString() };
assert("no schedule + pin → capture forever", resolveEffectiveProgram(noSchedPin, [], thu5am, TZ, ROLL), CAP);
assert("no schedule + boundary → capture (no boundary to yield to)", resolveEffectiveProgram(noSchedBoundary, [], thu5am, TZ, ROLL), CAP);
assert("null program + schedule active → scheduled playlist", resolveEffectiveProgram({ program: null, program_hold: null, program_set_at: null }, [PLAY], wed6pm, TZ, ROLL), { kind: "playlist", playlist_id: "P1" });

/* ── DST: winter offset + fall-back rollover (unambiguous 4 AM) ──── */
const dec1am = new Date("2026-12-17T07:00:00Z"); // 1:00 AM CST (UTC−6)
assert("nextRollover winter (CST) → 4AM CST", nextRollover(dec1am, TZ, ROLL).toISOString(), "2026-12-17T10:00:00.000Z");
// Fall-back night: Sun 2026-11-01, 4 AM CST is unambiguous.
const novFall = new Date("2026-11-01T06:30:00Z"); // 1:30 AM CDT before the 2AM→1AM fall-back
assert("nextRollover across fall-back → 4AM CST", nextRollover(novFall, TZ, ROLL).toISOString(), "2026-11-01T10:00:00.000Z");
// Spring-forward gap (2:30 AM does not exist on 2026-03-08): a boundary there must still yield a
// finite instant strictly between 1 AM and 4 AM local (no NaN, monotonic).
const gapRow: ScheduleRow = { id: "g", program: CAP, daysOfWeek: [], startMinute: 60 /*1AM*/, endMinute: 150 /*2:30AM gap*/, position: 0, active: true };
const springBefore = new Date("2026-03-08T07:00:00Z"); // 1:00 AM CST
const b = nextBoundary([gapRow], springBefore, TZ);
assert("spring-forward gap boundary is finite", b !== null && !Number.isNaN(b!.getTime()), true);
assert("spring-forward gap boundary after 1AM start", b !== null && b!.getTime() > new Date("2026-03-08T07:00:00Z").getTime(), true);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
