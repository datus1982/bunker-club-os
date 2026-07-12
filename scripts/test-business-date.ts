/**
 * Unit test for the toast-sync business-date logic (docs/08 TZ-1 fix).
 * Runs under Node/tsx: `npx tsx scripts/test-business-date.ts` (or `pnpm test:businessdate`).
 * Asserts the venue-local Toast businessDate is correct across the CDT late-night window,
 * midnight rollover, closeout hour, and month boundaries — the cases the hardcoded-UTC-6
 * legacy got wrong.
 */
import { businessDateFor } from "../supabase/functions/toast-sync/businessDate.ts";

let failures = 0;
function check(label: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}: got ${got}, want ${want}`);
}

const CHI = "America/Chicago";

// 11:30 PM CDT (the documented bug window). 23:30 local July 15 = 04:30 UTC July 16.
// Correct business date is July 15 — a naive getUTCDate() would wrongly say July 16.
check("11:30 PM CDT → same day", businessDateFor(new Date("2026-07-16T04:30:00Z"), CHI, 0), "20260715");

// 11:30 PM CDT on a MONTH boundary. 23:30 local Jul 31 = 04:30 UTC Aug 1.
// Proves we use venue-local date, not UTC (UTC would say Aug 1).
check("11:30 PM CDT month-end → Jul 31", businessDateFor(new Date("2026-08-01T04:30:00Z"), CHI, 0), "20260731");

// 12:30 AM CDT, no closeout → calendar date rolls to the new day.
check("12:30 AM CDT, closeout 0 → new day", businessDateFor(new Date("2026-07-16T05:30:00Z"), CHI, 0), "20260716");

// 12:30 AM CDT with a 4am closeout → still the previous business day (bar rolls at 4am).
check("12:30 AM CDT, closeout 4 → prev day", businessDateFor(new Date("2026-07-16T05:30:00Z"), CHI, 4), "20260715");

// 3:59 AM CDT with 4am closeout → still previous business day.
check("3:59 AM CDT, closeout 4 → prev day", businessDateFor(new Date("2026-07-16T08:59:00Z"), CHI, 4), "20260715");

// 4:00 AM CDT with 4am closeout → new business day begins.
check("4:00 AM CDT, closeout 4 → new day", businessDateFor(new Date("2026-07-16T09:00:00Z"), CHI, 4), "20260716");

// Winter CST 11:30 PM (UTC-6). 23:30 local Jan 15 = 05:30 UTC Jan 16.
check("11:30 PM CST → same day", businessDateFor(new Date("2026-01-16T05:30:00Z"), CHI, 0), "20260115");

// Noon CDT sanity.
check("12:00 PM CDT → same day", businessDateFor(new Date("2026-07-15T17:00:00Z"), CHI, 0), "20260715");

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll business-date tests passed.");
