/**
 * Unit test for the Phase 7 events DISPLAY stage machine (docs/13).
 * `npx tsx scripts/test-event-stage.ts` (pnpm test:eventstage).
 *
 * Imports the PURE module (no react / no supabase / no `@/` alias) so it runs
 * standalone. Asserts eventStage() across every boundary of the moment arc
 * (tease start, alert start, fire, +15s payoff→event, window end→all-clear,
 * all-clear end→null), the window/message 'active' window, and null fire_at.
 * Boundaries are [inclusive, exclusive) — each edge is probed on both sides.
 */
import {
  eventStage, isTakeoverStage, secondsToFire, minutesToFire, formatTMinus,
  MOMENT_PAYOFF_MS, ALL_CLEAR_MS, type LiveEvent,
} from "../apps/web/src/modules/signage/eventStage.ts";

let failures = 0;
function assert(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    got  ${g}\n    want ${w}`}`);
}

const MIN = 60_000;
// Anchor fire_at at a fixed instant so the math is pure.
const F = new Date("2026-07-14T05:00:00.000Z").getTime(); // arbitrary

function moment(over: Partial<LiveEvent> = {}): LiveEvent {
  return {
    id: "m", venue_id: "v", name: "Midnight Launch", kind: "moment", skin: "launch",
    fields: {}, toast_guid: null, fire_at: new Date(F).toISOString(),
    tease_minutes: 60, alert_minutes: 5, window_minutes: 30, interrupt_game: false, status: "scheduled",
    ...over,
  };
}
function windowEv(over: Partial<LiveEvent> = {}): LiveEvent {
  return {
    id: "w", venue_id: "v", name: "Happy Hour", kind: "window", skin: "generic",
    fields: {}, toast_guid: null, fire_at: new Date(F).toISOString(),
    tease_minutes: 0, alert_minutes: 0, window_minutes: 180, interrupt_game: false, status: "running",
    ...over,
  };
}

console.log("\n── eventStage() — MOMENT arc boundaries ──");
const m = moment();
const teaseStart = F - 60 * MIN;
const alertStart = F - 5 * MIN;
const payoffEnd = F + MOMENT_PAYOFF_MS;      // +15s
const windowEnd = F + 30 * MIN;
const allClearEnd = windowEnd + ALL_CLEAR_MS; // +2min

assert("before tease start → null", eventStage(m, teaseStart - 1), null);
assert("tease start (inclusive) → tease", eventStage(m, teaseStart), "tease");
assert("mid-tease → tease", eventStage(m, teaseStart + 10 * MIN), "tease");
assert("1ms before alert → tease", eventStage(m, alertStart - 1), "tease");
assert("alert start (inclusive) → alert", eventStage(m, alertStart), "alert");
assert("mid-alert → alert", eventStage(m, alertStart + 60_000), "alert");
assert("1ms before fire → alert", eventStage(m, F - 1), "alert");
assert("fire (inclusive) → moment", eventStage(m, F), "moment");
assert("mid-payoff (+7s) → moment", eventStage(m, F + 7_000), "moment");
assert("1ms before payoff end → moment", eventStage(m, payoffEnd - 1), "moment");
assert("payoff end (+15s, inclusive) → event", eventStage(m, payoffEnd), "event");
assert("mid-event → event", eventStage(m, F + 15 * MIN), "event");
assert("1ms before window end → event", eventStage(m, windowEnd - 1), "event");
assert("window end (inclusive) → allclear", eventStage(m, windowEnd), "allclear");
assert("mid-all-clear → allclear", eventStage(m, windowEnd + 60_000), "allclear");
assert("1ms before all-clear end → allclear", eventStage(m, allClearEnd - 1), "allclear");
assert("all-clear end (exclusive) → null", eventStage(m, allClearEnd), null);
assert("well after → null", eventStage(m, allClearEnd + 10 * MIN), null);

console.log("\n── eventStage() — WINDOW / MESSAGE ──");
const w = windowEv();
const wEnd = F + 180 * MIN;
assert("1ms before fire → null", eventStage(w, F - 1), null);
assert("fire (inclusive) → active", eventStage(w, F), "active");
assert("mid-window → active", eventStage(w, F + 90 * MIN), "active");
assert("1ms before window end → active", eventStage(w, wEnd - 1), "active");
assert("window end (exclusive) → null", eventStage(w, wEnd), null);
assert("message kind behaves like window", eventStage(windowEv({ kind: "message", window_minutes: 120 }), F + 60 * MIN), "active");

console.log("\n── eventStage() — degenerate inputs ──");
assert("null fire_at → null", eventStage(moment({ fire_at: null }), F), null);
assert("null fire_at (window) → null", eventStage(windowEv({ fire_at: null }), F), null);
assert("invalid fire_at → null", eventStage(moment({ fire_at: "not-a-date" }), F), null);
assert("accepts Date instance for now", eventStage(m, new Date(F)), "moment");

console.log("\n── isTakeoverStage() ──");
assert("alert is takeover", isTakeoverStage("alert"), true);
assert("moment is takeover", isTakeoverStage("moment"), true);
assert("event is takeover", isTakeoverStage("event"), true);
assert("allclear is takeover", isTakeoverStage("allclear"), true);
assert("tease is NOT takeover", isTakeoverStage("tease"), false);
assert("active is NOT takeover", isTakeoverStage("active"), false);
assert("null is NOT takeover", isTakeoverStage(null), false);

console.log("\n── countdown helpers ──");
assert("secondsToFire at T-90s → 90", secondsToFire(m, F - 90_000), 90);
assert("secondsToFire past fire → 0", secondsToFire(m, F + 5_000), 0);
assert("minutesToFire at T-42min (rounds) → 42", minutesToFire(m, F - 42 * MIN), 42);
assert("minutesToFire at T-89s → 1", minutesToFire(m, F - 89_000), 1);
assert("formatTMinus 299 → T−04:59", formatTMinus(299), "T−04:59");
assert("formatTMinus 5 → T−00:05", formatTMinus(5), "T−00:05");
assert("formatTMinus 0 → T−00:00", formatTMinus(0), "T−00:00");

if (failures > 0) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
console.log("\nAll eventStage assertions passed.");
