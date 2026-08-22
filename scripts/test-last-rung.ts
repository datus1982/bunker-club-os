/**
 * Unit test for the NOW POURING "last item rung in" derivation (toast-sync/lastRung.ts).
 * Runs under Node/tsx: `npx tsx scripts/test-last-rung.ts` (or `pnpm test:lastrung`).
 * Pure — no DB, no network.
 *
 * Covers: latest-order-wins + last-selection-within-an-order, voided order/check/selection,
 * excessFood, blank/missing openedDate, blank display name, pos_visible exclusion by guid and by
 * name, the NEW menu-group exclusion (Food/Merch) incl. keep-walking-to-an-earlier-selection,
 * cache-miss fail-open, no-qualifying-selection → null, and the parse/resolve helpers'
 * fail-open contract for a missing or malformed venue_settings value.
 */
import {
  computeLastRung,
  excludedGuidsForGroups,
  parseExcludedGroups,
  type RungOrder,
} from "../supabase/functions/toast-sync/lastRung.ts";
import { blockedGuids } from "../supabase/functions/toast-sync/rankFilter.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `: got ${g}, want ${w}`}`);
}

const NONE = new Set<string>();

// ── toast_menu_cache snapshot (guid, menu_group) ──────────────────────────────
const cacheRows = [
  { guid: "gin", menu_group: "Gin" },
  { guid: "hotdog", menu_group: "Food" },
  { guid: "pizza", menu_group: " food " },      // whitespace + case variance
  { guid: "tee", menu_group: "Merch" },
  { guid: "og", menu_group: null },             // no group recorded
];

// ── parseExcludedGroups — the venue_settings.value contract ───────────────────
check("parse — jsonb array", [...parseExcludedGroups(["Food", "Merch"])], ["food", "merch"]);
check("parse — JSON string array", [...parseExcludedGroups('["Food","Merch"]')], ["food", "merch"]);
check("parse — trims + lowercases", [...parseExcludedGroups(["  FoOd  "])], ["food"]);
check("parse — drops blanks and non-strings", [...parseExcludedGroups(["Food", "", "   ", 7, null, {}])], ["food"]);
check("parse — missing key (undefined) fails open", parseExcludedGroups(undefined).size, 0);
check("parse — null fails open", parseExcludedGroups(null).size, 0);
check("parse — object fails open", parseExcludedGroups({ groups: ["Food"] }).size, 0);
check("parse — number fails open", parseExcludedGroups(3).size, 0);
check("parse — malformed JSON string fails open", parseExcludedGroups("[Food").size, 0);
check("parse — empty array = no exclusions", parseExcludedGroups([]).size, 0);

// ── excludedGuidsForGroups — cache rows → guid set ────────────────────────────
const excluded = excludedGuidsForGroups(cacheRows, parseExcludedGroups(["Food", "Merch"]));
check("resolve — Food + Merch guids collected (case/space-insensitive)",
  [...excluded].sort(), ["hotdog", "pizza", "tee"]);
check("resolve — non-excluded group not collected", excluded.has("gin"), false);
check("resolve — null menu_group not collected", excluded.has("og"), false);
check("resolve — empty exclusion set ⇒ empty result",
  excludedGuidsForGroups(cacheRows, NONE).size, 0);

// ── order fixtures ────────────────────────────────────────────────────────────
const order = (openedDate: string | null, sels: { guid: string; name: string; voided?: boolean }[], extra: Partial<RungOrder> = {}): RungOrder => ({
  openedDate,
  checks: [{ selections: sels.map((s) => ({ item: { guid: s.guid }, displayName: s.name, voided: !!s.voided })) }],
  ...extra,
});

const T1 = "2026-08-21T22:00:00.000Z";
const T2 = "2026-08-21T23:00:00.000Z";

// ── baseline (no exclusions) ──────────────────────────────────────────────────
check("latest order wins",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "og", name: "Old Fashioned" }])], NONE, NONE),
  { name: "Old Fashioned", at: T2 });
check("within one order the LAST selection wins",
  computeLastRung([order(T2, [{ guid: "gin", name: "Gin & Tonic" }, { guid: "og", name: "Old Fashioned" }])], NONE, NONE),
  { name: "Old Fashioned", at: T2 });
check("voided selection skipped",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "og", name: "Old Fashioned", voided: true }])], NONE, NONE),
  { name: "Gin & Tonic", at: T1 });
check("voided order skipped",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "og", name: "Old Fashioned" }], { voided: true })], NONE, NONE),
  { name: "Gin & Tonic", at: T1 });
check("excessFood order skipped",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "og", name: "Old Fashioned" }], { excessFood: true })], NONE, NONE),
  { name: "Gin & Tonic", at: T1 });
check("voided check skipped",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), {
    openedDate: T2, checks: [{ voided: true, selections: [{ item: { guid: "og" }, displayName: "Old Fashioned" }] }],
  }], NONE, NONE),
  { name: "Gin & Tonic", at: T1 });
check("missing openedDate skipped",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(null, [{ guid: "og", name: "Old Fashioned" }])], NONE, NONE),
  { name: "Gin & Tonic", at: T1 });
check("blank display name skipped",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "og", name: "   " }])], NONE, NONE),
  { name: "Gin & Tonic", at: T1 });
check("nothing qualifies → null", computeLastRung([order(T2, [])], NONE, NONE), null);
check("no orders → null", computeLastRung([], NONE, NONE), null);

// ── pos_visible exclusions (pre-existing behavior, unchanged) ─────────────────
check("pos-hidden guid skipped, walk continues to earlier selection",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "og", name: "Old Fashioned" }])],
    new Set(["og"]), NONE),
  { name: "Gin & Tonic", at: T1 });
check("pos-hidden NAME skipped (case-insensitive)",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "og", name: "Old Fashioned" }])],
    NONE, new Set(["old fashioned"])),
  { name: "Gin & Tonic", at: T1 });

// ── THE NEW BEHAVIOR — menu-group exclusion ───────────────────────────────────
check("food rung last → skipped, earlier drink wins",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "hotdog", name: "Hot Dog" }])],
    NONE, NONE, excluded),
  { name: "Gin & Tonic", at: T1 });
check("food last WITHIN an order → earlier selection in the same order wins",
  computeLastRung([order(T2, [{ guid: "gin", name: "Gin & Tonic" }, { guid: "hotdog", name: "Hot Dog" }])],
    NONE, NONE, excluded),
  { name: "Gin & Tonic", at: T2 });
check("merch excluded too",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "tee", name: "Bunker Tee" }])],
    NONE, NONE, excluded),
  { name: "Gin & Tonic", at: T1 });
check("ONLY food rung all day → null (prior value left in place by the caller)",
  computeLastRung([order(T1, [{ guid: "hotdog", name: "Hot Dog" }]), order(T2, [{ guid: "pizza", name: "Dead Slice" }])],
    NONE, NONE, excluded),
  null);
check("drink still wins when it is genuinely last",
  computeLastRung([order(T1, [{ guid: "hotdog", name: "Hot Dog" }]), order(T2, [{ guid: "gin", name: "Gin & Tonic" }])],
    NONE, NONE, excluded),
  { name: "Gin & Tonic", at: T2 });
check("guid NOT in toast_menu_cache is NOT excluded (fail-open)",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "unknown-guid", name: "Mystery Item" }])],
    NONE, NONE, excluded),
  { name: "Mystery Item", at: T2 });
check("empty exclusion set ⇒ pre-v9 behavior (food shows)",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "hotdog", name: "Hot Dog" }])],
    NONE, NONE, NONE),
  { name: "Hot Dog", at: T2 });
check("omitted 4th arg ⇒ pre-v9 behavior (back-compat default)",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "hotdog", name: "Hot Dog" }])],
    NONE, NONE),
  { name: "Hot Dog", at: T2 });
check("exclusions compose — food AND pos-hidden both skipped",
  computeLastRung([
    order("2026-08-21T21:00:00.000Z", [{ guid: "gin", name: "Gin & Tonic" }]),
    order(T1, [{ guid: "og", name: "Old Fashioned" }]),
    order(T2, [{ guid: "hotdog", name: "Hot Dog" }]),
  ], new Set(["og"]), NONE, excluded),
  { name: "Gin & Tonic", at: "2026-08-21T21:00:00.000Z" });

// ── v10: 86'd items are barred from NOW POURING too ──────────────────────────
// computeLastRung itself is UNCHANGED — the caller now composes the excluded set with
// rankFilter.blockedGuids(), which unions the menu-group exclusion with out_of_stock. These
// assertions pin that composition at the call site's contract.
const blocked = blockedGuids(
  [
    { guid: "hotdog", menu_group: "Food", out_of_stock: false },
    { guid: "keg", menu_group: "Draft Beers", out_of_stock: true },   // 86'd — the blown keg
    { guid: "gin", menu_group: "Gin", out_of_stock: false },
    { guid: "soda", menu_group: "Soft Drinks", out_of_stock: false },
  ],
  parseExcludedGroups(["Food", "Merch", "Soft Drinks"]),
);
check("86'd item is skipped — the walk falls back to the last POURABLE thing",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "keg", name: "Bunker Beer" }])],
    NONE, NONE, blocked),
  { name: "Gin & Tonic", at: T1 });
check("a rung soda water is not a pour (Soft Drinks now in the rung config)",
  computeLastRung([order(T1, [{ guid: "gin", name: "Gin & Tonic" }]), order(T2, [{ guid: "soda", name: "Soda Water" }])],
    NONE, NONE, blocked),
  { name: "Gin & Tonic", at: T1 });
check("in-stock drink still wins over a later 86'd one AND later food",
  computeLastRung([
    order("2026-08-21T21:00:00.000Z", [{ guid: "gin", name: "Gin & Tonic" }]),
    order(T1, [{ guid: "keg", name: "Bunker Beer" }]),
    order(T2, [{ guid: "hotdog", name: "Hot Dog" }]),
  ], NONE, NONE, blocked),
  { name: "Gin & Tonic", at: "2026-08-21T21:00:00.000Z" });
check("nothing pourable qualifies ⇒ null (caller leaves the prior value to age out)",
  computeLastRung([order(T2, [{ guid: "keg", name: "Bunker Beer" }])], NONE, NONE, blocked),
  null);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll last-rung tests passed.");
