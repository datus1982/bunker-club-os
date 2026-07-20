/**
 * Parity test for the Q-SYS media-control `status` command's PORTED resolver
 * (supabase/functions/media-control/scheduleResolve.ts) vs the web source of truth
 * (apps/web/src/modules/signage/scheduleResolve.ts, tested by scripts/test-schedule-resolve.ts).
 *
 * `npx tsx scripts/test-qsys-status-resolve.ts`
 *
 * The port is a transliteration — this asserts the boundary-relevant branches the UCI status
 * readout depends on produce IDENTICAL results to the web suite's hand-computed instants, PLUS
 * the source labelling (pinned/override/scheduled/rotation) the UCI highlights reality with.
 * All instants are the same America/Chicago values as the web suite (CDT = UTC−5, CST = UTC−6).
 */
import {
  rowCovers, activeScheduledProgram, resolveEffectiveProgram, resolveEffectiveProgramWithSource,
  isHoldExpired, nextBoundary, nextRollover, venueLocalParts, mapScheduleRow,
  type ScheduleRow, type SlotProgramState,
} from "../supabase/functions/media-control/scheduleResolve.ts";

let failures = 0;
function assert(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    got  ${g}\n    want ${w}`}`);
}

const TZ = "America/Chicago";
const ROLL = 4;

const wed3pm = new Date("2026-07-15T20:00:00Z");
const wed5pm = new Date("2026-07-15T22:00:00Z");
const wed6pm = new Date("2026-07-15T23:00:00Z");
const thu1am = new Date("2026-07-16T06:00:00Z");
const thu230 = new Date("2026-07-16T07:30:00Z");
const thu3am = new Date("2026-07-16T08:00:00Z");
const thu5am = new Date("2026-07-16T10:00:00Z");

const PLAY: ScheduleRow = {
  id: "r1", program: { kind: "playlist", playlist_id: "P1" },
  daysOfWeek: [], startMinute: 960, endMinute: 120, position: 0, active: true,
};
const CAP = { kind: "capture", device_match: "Roku" } as const;

/* ── coverage / scheduled program (mirrors the web suite) ─────────────── */
assert("localParts Wed 4PM", venueLocalParts(new Date("2026-07-15T21:00:00Z"), TZ), { dow: 3, minute: 960 });
assert("covers Thu 1AM (post-midnight, from Wed)", rowCovers(PLAY, 4, 60), true);
assert("scheduled @ Wed 6PM", activeScheduledProgram([PLAY], wed6pm, TZ), { kind: "playlist", playlist_id: "P1" });
assert("scheduled @ Thu 3AM = rotation(null)", activeScheduledProgram([PLAY], thu3am, TZ), null);

/* ── boundaries + rollover ───────────────────────────────────────────── */
assert("nextBoundary Wed 6PM → Thu 2AM", nextBoundary([PLAY], wed6pm, TZ)?.toISOString(), "2026-07-16T07:00:00.000Z");
assert("nextRollover Thu 1AM → Thu 4AM CDT", nextRollover(thu1am, TZ, ROLL).toISOString(), "2026-07-16T09:00:00.000Z");

/* ── D4 two-tier hold: boundary vs event (the overtime case) ─────────── */
assert("boundary: not expired @ Wed 6PM", isHoldExpired("boundary", wed5pm, wed6pm, TZ, [PLAY], ROLL), false);
assert("boundary: EXPIRED @ Thu 2:30AM", isHoldExpired("boundary", wed5pm, thu230, TZ, [PLAY], ROLL), true);
assert("event: SURVIVES 2AM boundary @ Thu 2:30AM", isHoldExpired("event", wed5pm, thu230, TZ, [PLAY], ROLL), false);
assert("event: EXPIRED @ Thu 5AM (past rollover)", isHoldExpired("event", wed5pm, thu5am, TZ, [PLAY], ROLL), true);
assert("pin: never expires", isHoldExpired("pin", wed5pm, thu5am, TZ, [PLAY], ROLL), false);

/* ── resolveEffectiveProgram: override + schedule together ───────────── */
const flipBoundary: SlotProgramState = { program: CAP, program_hold: "boundary", program_set_at: wed5pm.toISOString() };
const flipEvent: SlotProgramState = { program: CAP, program_hold: "event", program_set_at: wed5pm.toISOString() };
assert("eff boundary @ Wed 6PM = capture (override)", resolveEffectiveProgram(flipBoundary, [PLAY], wed6pm, TZ, ROLL), CAP);
assert("eff boundary @ Thu 2:30AM = rotation (yielded)", resolveEffectiveProgram(flipBoundary, [PLAY], thu230, TZ, ROLL), null);
assert("eff event @ Thu 2:30AM = capture (overtime hold)", resolveEffectiveProgram(flipEvent, [PLAY], thu230, TZ, ROLL), CAP);
assert("eff event @ Thu 5AM = rotation (rolled over)", resolveEffectiveProgram(flipEvent, [PLAY], thu5am, TZ, ROLL), null);

/* ── the SOURCE labelling the UCI highlights reality with ────────────── */
// pinned (no schedule + pin) → 'pinned'.
const pinNoSched: SlotProgramState = { program: CAP, program_hold: "pin", program_set_at: wed5pm.toISOString() };
assert("source: no-schedule pin → pinned", resolveEffectiveProgramWithSource(pinNoSched, [], thu5am, TZ, ROLL).source, "pinned");
// live boundary override → 'override'.
assert("source: live boundary override → override", resolveEffectiveProgramWithSource(flipBoundary, [PLAY], wed6pm, TZ, ROLL).source, "override");
// yielded boundary override → falls to 'scheduled' (the daypart still covers 6PM… but at 2:30AM it's past 2AM → rotation).
assert("source: yielded override @ Thu 2:30AM → rotation", resolveEffectiveProgramWithSource(flipBoundary, [PLAY], thu230, TZ, ROLL).source, "rotation");
// no override, schedule active → 'scheduled'.
const noOverride: SlotProgramState = { program: null, program_hold: null, program_set_at: null };
assert("source: schedule active → scheduled", resolveEffectiveProgramWithSource(noOverride, [PLAY], wed6pm, TZ, ROLL).source, "scheduled");
assert("source: nothing → rotation", resolveEffectiveProgramWithSource(noOverride, [], wed3pm, TZ, ROLL).source, "rotation");
// scheduled capture daypart while no override → 'scheduled' + the capture program.
const capDaypart: ScheduleRow = { id: "c1", program: CAP, daysOfWeek: [], startMinute: 960, endMinute: 1320, position: 5, active: true };
const r = resolveEffectiveProgramWithSource(noOverride, [capDaypart], wed6pm, TZ, ROLL);
assert("scheduled capture → source scheduled", r.source, "scheduled");
assert("scheduled capture → kind capture", r.program?.kind, "capture");

/* ── mapScheduleRow (fn-side mirror of useSignage.ts) ─────────────────── */
assert("mapScheduleRow null program → rotation sentinel", mapScheduleRow({
  id: "x", program: null, days_of_week: null, start_minute: 0, end_minute: 60, position: 0, active: true,
}), { id: "x", program: { kind: "rotation" }, daysOfWeek: [], startMinute: 0, endMinute: 60, position: 0, active: true });

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
