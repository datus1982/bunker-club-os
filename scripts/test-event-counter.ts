/**
 * Unit test for the Phase 7 event SALES COUNTER math (docs/13 "Counter mechanics").
 * Runs under Node/tsx: `npx tsx scripts/test-event-counter.ts` (or `pnpm test:eventcounter`).
 * Pure — no DB, no network. Covers: window boundary inclusivity, voided order/check/selection
 * exclusion, quantity>1 summing, guid filtering, baseline averaging (incl. the <3-dates skip
 * and same-date exclusion / multi-group max collapse), vs-avg percent, and non-clobbering
 * fields merge.
 */
import {
  countUnitsForGuid,
  averageUnitsPerDate,
  vsAvgPct,
  mergeFields,
  type RawOrder,
  type SalesRow,
} from "../supabase/functions/toast-sync/eventCounter.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `: got ${g}, want ${w}`}`);
}

const GUID = "item-rocket-sauce";
const OTHER = "item-other";

// Window: [10:00, 10:30] on 2026-07-14 (UTC for test determinism).
const FROM = Date.parse("2026-07-14T10:00:00.000Z");
const TO = Date.parse("2026-07-14T10:30:00.000Z");

const orders: RawOrder[] = [
  // In-window, qty 1 → counts.
  { openedDate: "2026-07-14T10:05:00.000Z", checks: [{ selections: [{ item: { guid: GUID }, quantity: 1 }] }] },
  // In-window, qty 3 → counts 3.
  { openedDate: "2026-07-14T10:10:00.000Z", checks: [{ selections: [{ item: { guid: GUID }, quantity: 3 }] }] },
  // Exactly at FROM boundary (inclusive) → counts.
  { openedDate: "2026-07-14T10:00:00.000Z", checks: [{ selections: [{ item: { guid: GUID }, quantity: 1 }] }] },
  // Exactly at TO boundary (inclusive) → counts.
  { openedDate: "2026-07-14T10:30:00.000Z", checks: [{ selections: [{ item: { guid: GUID }, quantity: 1 }] }] },
  // 1ms before FROM → excluded.
  { openedDate: "2026-07-14T09:59:59.999Z", checks: [{ selections: [{ item: { guid: GUID }, quantity: 5 }] }] },
  // 1ms after TO → excluded.
  { openedDate: "2026-07-14T10:30:00.001Z", checks: [{ selections: [{ item: { guid: GUID }, quantity: 5 }] }] },
  // In-window but voided selection → excluded.
  { openedDate: "2026-07-14T10:12:00.000Z", checks: [{ selections: [{ item: { guid: GUID }, quantity: 2, voided: true }] }] },
  // In-window but voided check → excluded.
  { openedDate: "2026-07-14T10:13:00.000Z", checks: [{ voided: true, selections: [{ item: { guid: GUID }, quantity: 4 }] }] },
  // In-window but whole order voided → excluded.
  { openedDate: "2026-07-14T10:14:00.000Z", voided: true, checks: [{ selections: [{ item: { guid: GUID }, quantity: 6 }] }] },
  // In-window, different item → excluded.
  { openedDate: "2026-07-14T10:15:00.000Z", checks: [{ selections: [{ item: { guid: OTHER }, quantity: 9 }] }] },
  // In-window, missing quantity → defaults to 1.
  { openedDate: "2026-07-14T10:16:00.000Z", checks: [{ selections: [{ item: { guid: GUID } }] }] },
  // In-window, mixed check with both items → only GUID selection counts (qty 2).
  { openedDate: "2026-07-14T10:17:00.000Z", checks: [{ selections: [
    { item: { guid: OTHER }, quantity: 7 },
    { item: { guid: GUID }, quantity: 2 },
  ] }] },
  // Unparseable openedDate → excluded.
  { openedDate: "not-a-date", checks: [{ selections: [{ item: { guid: GUID }, quantity: 8 }] }] },
];

// Expected: 1 + 3 + 1(from) + 1(to) + 1(missing qty) + 2(mixed) = 9.
check("countUnitsForGuid — window/void/qty/guid handling", countUnitsForGuid(orders, GUID, FROM, TO), 9);
check("countUnitsForGuid — other item", countUnitsForGuid(orders, OTHER, FROM, TO), 16); // 9 + 7
check("countUnitsForGuid — empty orders", countUnitsForGuid([], GUID, FROM, TO), 0);

// ── baseline averaging ───────────────────────────────────────────────────────
const EVENT_DATE = "20260714";

// 4 prior dates + the event date. Event-date rows excluded. Multi-group same-date collapses
// to MAX (20260710 appears twice: 10 and 10 → 10, not 20).
const salesRows: SalesRow[] = [
  { business_date: "20260710", sales_count: 10 }, // group cache
  { business_date: "20260710", sales_count: 10 }, // MAIN_MENU_ALL (same count)
  { business_date: "20260711", sales_count: 20 },
  { business_date: "20260712", sales_count: 30 },
  { business_date: "20260713", sales_count: 40 },
  { business_date: EVENT_DATE, sales_count: 999 }, // excluded
];
// avg over {10,20,30,40} = 25.
check("averageUnitsPerDate — 4 dates, exclude event date, max-collapse", averageUnitsPerDate(salesRows, EVENT_DATE), { avg: 25, dates: 4 });

// Exactly 3 dates → computes.
check("averageUnitsPerDate — 3 dates ok", averageUnitsPerDate([
  { business_date: "20260710", sales_count: 10 },
  { business_date: "20260711", sales_count: 20 },
  { business_date: "20260712", sales_count: 30 },
], EVENT_DATE), { avg: 20, dates: 3 });

// 2 distinct dates after exclusion → skip (avg null).
check("averageUnitsPerDate — <3 dates → skip", averageUnitsPerDate([
  { business_date: "20260710", sales_count: 10 },
  { business_date: "20260711", sales_count: 20 },
  { business_date: EVENT_DATE, sales_count: 50 },
], EVENT_DATE), { avg: null, dates: 2 });

check("averageUnitsPerDate — no rows → skip", averageUnitsPerDate([], EVENT_DATE), { avg: null, dates: 0 });

// ── vs-avg percent ─────────────────────────────────────────────────────────
check("vsAvgPct — above average", vsAvgPct(30, 25), 20); // (30-25)/25 = +20%
check("vsAvgPct — below average", vsAvgPct(20, 25), -20);
check("vsAvgPct — rounds to whole percent", vsAvgPct(33, 25), 32); // 0.32 → 32
check("vsAvgPct — null baseline → null", vsAvgPct(30, null), null);
check("vsAvgPct — zero baseline → null", vsAvgPct(30, 0), null);

// ── fields merge (non-clobbering) ────────────────────────────────────────────
check("mergeFields — preserves siblings", mergeFields(
  { title: "Rocket Sauce", directive: "FUEL UP", live_count: 5 },
  { live_count: 12 },
), { title: "Rocket Sauce", directive: "FUEL UP", live_count: 12 });

check("mergeFields — adds final_stats, keeps live_count", mergeFields(
  { title: "T", live_count: 47 },
  { final_stats: { units: 47, window_minutes: 30, vs_avg_pct: 20, computed_at: "2026-07-14T11:00:00.000Z" } },
), { title: "T", live_count: 47, final_stats: { units: 47, window_minutes: 30, vs_avg_pct: 20, computed_at: "2026-07-14T11:00:00.000Z" } });

check("mergeFields — null existing", mergeFields(null, { live_count: 1 }), { live_count: 1 });

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll event-counter tests passed.");
