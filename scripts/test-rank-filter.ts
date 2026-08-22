/**
 * Unit test for the ranked-surface gates (PR #93 — "86'd = not advertised in ANY way" + the
 * mixer-pollution display filter). `npx tsx scripts/test-rank-filter.ts` (pnpm test:rankfilter).
 * Pure — no DB, no network.
 *
 * Covers BOTH copies of the gate and asserts they agree:
 *   • supabase/functions/toast-sync/rankFilter.ts — the WRITE-time gate on sales_cache (blockedGuids)
 *   • apps/web/src/modules/signage/rankGates.ts   — the READ/render-time gate on the two surfaces
 *     that do not read sales_cache (CHAMPION from sales_history, UNDERDOGS from the toast cache)
 *
 * The PORT PARITY block is the important one: the two parsers are deliberate copies across the
 * Deno/Vite boundary, so every fail-open shape is asserted identical on both sides. If they ever
 * diverge, this test is what catches it.
 */
import { blockedGuids, type RankCacheRow } from "../supabase/functions/toast-sync/rankFilter.ts";
import { parseExcludedGroups } from "../supabase/functions/toast-sync/lastRung.ts";
import {
  isGroupExcluded,
  isRankable,
  parseRankExcludedGroups,
  type RankGateRow,
} from "../apps/web/src/modules/signage/rankGates.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `: got ${g}, want ${w}`}`);
}
/** Sets compare by sorted contents so assertion output is stable. */
const setOf = (s: Set<string>) => [...s].sort();

const SOFT = new Set(["soft drinks"]);
const NONE = new Set<string>();

// A realistic slice of the live venue's toast_menu_cache (2026-08-22 probe): the two mixers that
// out-ranked every real drink, a genuinely 86'd signature cocktail, food (must still rank), and a
// row with unknown stock.
const rows: RankCacheRow[] = [
  { guid: "soda", menu_group: "Soft Drinks", out_of_stock: false },
  { guid: "redbull", menu_group: "Soft Drinks", out_of_stock: false },
  { guid: "polar", menu_group: "Soft Drinks", out_of_stock: true },   // excluded AND 86'd
  { guid: "upatom", menu_group: "Signature Cocktails", out_of_stock: true },
  { guid: "sputnik", menu_group: "Signature Cocktails", out_of_stock: false },
  { guid: "hotdog", menu_group: "Food", out_of_stock: false },
  { guid: "mystery", menu_group: null, out_of_stock: null },          // unknown group + stock
  { guid: "nostock", menu_group: "Draft Beers" },                     // out_of_stock absent
];

console.log("── blockedGuids: the write-time sales_cache gate ──");
check("86'd items are blocked; in-stock ones are not",
  setOf(blockedGuids(rows, NONE)), ["polar", "upatom"]);
check("rank-excluded group ∪ 86'd (the shipped config)",
  setOf(blockedGuids(rows, SOFT)), ["polar", "redbull", "soda", "upatom"]);
check("FOOD still ranks with the shipped config (owner's Hot Dog champion ruling)",
  blockedGuids(rows, SOFT).has("hotdog"), false);
check("unknown stock (null) ⇒ fail-open, not blocked",
  blockedGuids(rows, SOFT).has("mystery"), false);
check("absent out_of_stock field ⇒ fail-open, not blocked",
  blockedGuids(rows, SOFT).has("nostock"), false);
check("no exclusions + nothing 86'd ⇒ empty set (byte-identical to pre-gate behavior)",
  setOf(blockedGuids([{ guid: "a", menu_group: "Gin", out_of_stock: false }], NONE)), []);
check("empty excluded-group set still applies the 86'd half (early-return guard)",
  setOf(blockedGuids([{ guid: "a", menu_group: "Gin", out_of_stock: true }], NONE)), ["a"]);
check("empty rows ⇒ empty set", setOf(blockedGuids([], SOFT)), []);
check("group match is case- and whitespace-insensitive",
  setOf(blockedGuids([{ guid: "a", menu_group: "  sOfT   ", out_of_stock: false }], new Set(["soft"]))), ["a"]);
check("a row with no guid is skipped, not crashed on",
  setOf(blockedGuids([{ guid: "", menu_group: "Soft Drinks", out_of_stock: true }], SOFT)), []);
check("a blocked guid appears exactly once when both rules fire",
  blockedGuids(rows, SOFT).size, 4);

console.log("\n── isGroupExcluded / isRankable: the display-side gate ──");
check("excluded group", isGroupExcluded("Soft Drinks", SOFT), true);
check("excluded group, case/whitespace insensitive", isGroupExcluded("  soft drinks ", SOFT), true);
check("non-excluded group", isGroupExcluded("Signature Cocktails", SOFT), false);
check("null group ⇒ fail-open", isGroupExcluded(null, SOFT), false);
check("blank group ⇒ fail-open", isGroupExcluded("   ", SOFT), false);
check("empty exclusion set ⇒ nothing excluded", isGroupExcluded("Soft Drinks", NONE), false);

const rankable = (over: Partial<RankGateRow>): boolean =>
  isRankable({ menu_group: "Signature Cocktails", out_of_stock: false, pos_visible: true, ...over }, SOFT);
check("in-stock, POS-visible, allowed group ⇒ rankable", rankable({}), true);
check("86'd ⇒ NOT rankable (the owner's ruling A)", rankable({ out_of_stock: true }), false);
check("POS-hidden ⇒ NOT rankable (0034, pre-existing)", rankable({ pos_visible: false }), false);
check("rank-excluded group ⇒ NOT rankable (ruling B)", rankable({ menu_group: "Soft Drinks" }), false);
check("FOOD is rankable under the shipped config", rankable({ menu_group: "Food" }), true);
check("unknown group ⇒ rankable (fail-open)", rankable({ menu_group: null }), true);
check("all three failing at once ⇒ still just false",
  isRankable({ menu_group: "Soft Drinks", out_of_stock: true, pos_visible: false }, SOFT), false);

console.log("\n── PORT PARITY: the two parsers must agree on every shape ──");
const shapes: [string, unknown][] = [
  ["array of names", ["Soft Drinks", "Merch"]],
  ["JSON string containing an array", '["Soft Drinks"]'],
  ["malformed JSON string", "{not json"],
  ["plain non-JSON string", "Soft Drinks"],
  ["null", null],
  ["undefined", undefined],
  ["number", 7],
  ["boolean", true],
  ["object (wrong shape)", { groups: ["Soft Drinks"] }],
  ["empty array", []],
  ["array with non-string entries", ["Soft Drinks", 3, null, { a: 1 }]],
  ["array with blank/whitespace entries", ["Soft Drinks", "", "   "]],
  ["mixed case + padding", ["  SOFT drinks  ", "MERCH"]],
  ["duplicate entries", ["Soft Drinks", "soft drinks", "SOFT DRINKS"]],
  ["nested array", [["Soft Drinks"]]],
  ["JSON string of a non-array", "42"],
];
for (const [label, value] of shapes) {
  const fn = setOf(parseExcludedGroups(value));
  const web = setOf(parseRankExcludedGroups(value));
  check(`parity — ${label}`, web, fn);
}
// Spot-check the actual values behind the parity (parity alone would pass if both were broken).
check("parser normalizes to trimmed lowercase",
  setOf(parseRankExcludedGroups(["  SOFT drinks  ", "MERCH"])), ["merch", "soft drinks"]);
check("malformed value FAILS OPEN to an empty set",
  setOf(parseRankExcludedGroups("{not json")), []);
check("the shipped rank config parses",
  setOf(parseRankExcludedGroups(["Soft Drinks"])), ["soft drinks"]);
check("the shipped rung config parses",
  setOf(parseRankExcludedGroups(["Food", "Merch", "Soft Drinks"])), ["food", "merch", "soft drinks"]);

console.log("\n── the live regression this shipped for ──");
// MAIN_MENU_ALL on 20260821 was: Soda Water 18 (#1), Tito's 16, Red Bull 15 (#3), Pizza Slice 14,
// Miller Lite 14 … — two mixers credited by PR #55's cross-ring counting sitting above every real
// drink. With the gate the mixers drop out and the real leaders close ranks.
const nightly = [
  { guid: "soda", qty: 18 }, { guid: "titos", qty: 16 }, { guid: "redbull", qty: 15 },
  { guid: "pizza", qty: 14 }, { guid: "miller", qty: 14 },
];
const gate = blockedGuids([
  { guid: "soda", menu_group: "Soft Drinks", out_of_stock: false },
  { guid: "redbull", menu_group: "Soft Drinks", out_of_stock: false },
  { guid: "titos", menu_group: "Vodka", out_of_stock: false },
  { guid: "pizza", menu_group: "Food", out_of_stock: false },
  { guid: "miller", menu_group: "Draft Beers", out_of_stock: false },
], SOFT);
check("mixers gone, food kept, order preserved",
  nightly.filter((i) => !gate.has(i.guid)).map((i) => i.guid), ["titos", "pizza", "miller"]);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll rank-filter tests passed.");
