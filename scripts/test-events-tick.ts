/**
 * Seed-and-assert test for the Phase 7 scheduled-events engine (migration 0035).
 * `npx tsx scripts/test-events-tick.ts` (pnpm test:eventstick).
 *
 * Two halves, both against the live DB via service role (bypasses RLS):
 *   (1) next_scheduled_occurrence() re-arm math — fixed anchors incl. BOTH US DST
 *       crossings (spring-forward + fall-back) to prove the venue-TZ math never uses a
 *       fixed offset, plus weekday selection and one-shot (null) handling.
 *   (2) tick_scheduled_events() status machine — seeds rows and asserts the three
 *       transitions: live window → running, missed one-shot → completed (never fires
 *       retroactively), recurring → re-armed to the next venue-local occurrence.
 *
 * Cleans up its fixture rows at the end (always). Recognizable ids: e0e70035-…
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const VENUE = process.env.VENUE_ID ?? "11111111-1111-1111-1111-111111111111";
const TZ = "America/Chicago";

const ID = {
  live: "e0e70035-0000-4000-8000-0000000000b1",
  missed: "e0e70035-0000-4000-8000-0000000000b2",
  recurring: "e0e70035-0000-4000-8000-0000000000b3",
};

let failures = 0;
function assert(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    got  ${g}\n    want ${w}`}`);
}

async function nextOcc(recurrence: unknown, afterISO: string): Promise<string | null> {
  const { data, error } = await admin.rpc("next_scheduled_occurrence", {
    p_recurrence: recurrence,
    p_after: afterISO,
    p_tz: TZ,
  });
  if (error) throw new Error(`next_scheduled_occurrence rpc: ${error.message}`);
  return data as string | null;
}

/** Compare two instants by epoch ms (tolerates +00:00 vs Z formatting). */
function sameInstant(gotISO: string | null, wantISO: string | null): boolean {
  if (gotISO === null || wantISO === null) return gotISO === wantISO;
  return new Date(gotISO).getTime() === new Date(wantISO).getTime();
}

async function cleanup() {
  await admin.from("scheduled_events").delete().in("id", Object.values(ID));
}

async function testReArmMath() {
  console.log("\n── next_scheduled_occurrence() re-arm math ──");
  const daily = { daysOfWeek: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"], time: "16:00" };

  // Spring forward: US DST 2026 begins Sun Mar 8. Anchor Sat 2026-03-07 17:30 CST (UTC-6).
  // Next daily 16:00 → Sun 2026-03-08 16:00 CDT (UTC-5) = 21:00Z. A fixed -6 offset would
  // wrongly yield 22:00Z, so this asserts DST-correctness.
  assert("spring-forward: 2026-03-07 17:30 CST + daily 16:00 → 2026-03-08 21:00Z (CDT)",
    sameInstant(await nextOcc(daily, "2026-03-07T23:30:00Z"), "2026-03-08T21:00:00Z"), true);

  // Fall back: US DST 2026 ends Sun Nov 1. Anchor Sat 2026-10-31 17:00 CDT (UTC-5).
  // Next daily 16:00 → Sun 2026-11-01 16:00 CST (UTC-6) = 22:00Z.
  assert("fall-back: 2026-10-31 17:00 CDT + daily 16:00 → 2026-11-01 22:00Z (CST)",
    sameInstant(await nextOcc(daily, "2026-10-31T22:00:00Z"), "2026-11-01T22:00:00Z"), true);

  // Weekday selection: anchor Mon 2026-07-13 12:00 CDT, days ['FR'] 20:00 → Fri 2026-07-17
  // 20:00 CDT = 2026-07-18T01:00Z.
  assert("weekday: Mon + Friday-only 20:00 → next Fri 2026-07-18 01:00Z",
    sameInstant(await nextOcc({ daysOfWeek: ["FR"], time: "20:00" }, "2026-07-13T17:00:00Z"), "2026-07-18T01:00:00Z"), true);

  // Same-weekday but time already passed → skip a full week, not fire same day.
  // Anchor Fri 2026-07-17 21:00 CDT (= 2026-07-18T02:00Z), days ['FR'] 20:00 → next Fri
  // 2026-07-24 20:00 CDT = 2026-07-25T01:00Z.
  assert("same-day-passed: Fri 21:00 + Friday-only 20:00 → next week 2026-07-25 01:00Z",
    sameInstant(await nextOcc({ daysOfWeek: ["FR"], time: "20:00" }, "2026-07-18T02:00:00Z"), "2026-07-25T01:00:00Z"), true);

  // One-shot / malformed recurrence → null.
  assert("null recurrence → null", await nextOcc(null, "2026-07-13T17:00:00Z"), null);
  assert("empty daysOfWeek → null", await nextOcc({ daysOfWeek: [], time: "16:00" }, "2026-07-13T17:00:00Z"), null);
}

async function testTick() {
  console.log("\n── tick_scheduled_events() status machine ──");
  await cleanup();

  // Live window: fired 10m ago, 60m window → active now. scheduled → running.
  await admin.from("scheduled_events").insert({
    id: ID.live, venue_id: VENUE, name: "tick live window", kind: "window",
    fire_at: new Date(Date.now() - 10 * 60_000).toISOString(), window_minutes: 60, status: "scheduled",
  });
  // Missed one-shot: window ended 60m ago, no recurrence → completed, never running.
  await admin.from("scheduled_events").insert({
    id: ID.missed, venue_id: VENUE, name: "tick missed", kind: "window",
    fire_at: new Date(Date.now() - 90 * 60_000).toISOString(), window_minutes: 30, status: "scheduled", recurrence: null,
  });
  // Recurring: window long past, daily 16:00 → re-armed to next occurrence, status scheduled.
  await admin.from("scheduled_events").insert({
    id: ID.recurring, venue_id: VENUE, name: "tick recurring", kind: "window",
    fire_at: new Date(Date.now() - 2 * 3600_000).toISOString(), window_minutes: 30, status: "scheduled",
    recurrence: { daysOfWeek: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"], time: "16:00" },
  });

  const beforeFireAt = (await admin.from("scheduled_events").select("fire_at").eq("id", ID.recurring).single()).data!.fire_at as string;

  const { error: tickErr } = await admin.rpc("tick_scheduled_events");
  if (tickErr) throw new Error(`tick_scheduled_events rpc: ${tickErr.message}`);

  const rows = await admin.from("scheduled_events").select("id,status,fire_at").in("id", Object.values(ID));
  const byId = Object.fromEntries((rows.data ?? []).map((r) => [r.id, r]));

  assert("live window → running", byId[ID.live]?.status, "running");
  assert("missed one-shot → completed", byId[ID.missed]?.status, "completed");
  assert("recurring → re-armed (scheduled)", byId[ID.recurring]?.status, "scheduled");

  const rearmed = byId[ID.recurring]?.fire_at as string;
  assert("recurring: fire_at advanced to a future instant", new Date(rearmed).getTime() > Date.now(), true);
  assert("recurring: fire_at moved forward from the stale value", new Date(rearmed).getTime() > new Date(beforeFireAt).getTime(), true);
  // Re-armed local time must be 16:00 in the venue TZ.
  const localHM = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(rearmed));
  assert("recurring: re-armed local time is 16:00 America/Chicago", localHM, "16:00");
  console.log(`   re-arm: ${beforeFireAt} → ${rearmed} (${localHM} ${TZ})`);
}

async function main() {
  try {
    await testReArmMath();
    await testTick();
  } finally {
    await cleanup();
  }
  if (failures > 0) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
  console.log("\nAll scheduled-events engine assertions passed.");
}

main().catch((e) => { console.error("\n✗", e.message); cleanup().finally(() => process.exit(1)); });
