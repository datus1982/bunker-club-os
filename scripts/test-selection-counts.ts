/**
 * Unit test for the cross-ring per-selection counting core (selectionCounts.ts).
 * Runs under Node/tsx: `npx tsx scripts/test-selection-counts.ts` (or `pnpm test:selectioncounts`).
 * Pure — no DB, no network. Proves the owner's invariant: a cocktail rung EITHER way (item +
 * liquor-mod, or liquor + cocktail-mod) produces IDENTICAL credits.
 *
 * Covers: path-1 (item + liquor upgrade — both credited), path-2 (liquor + cocktail mod — both
 * credited), path-1 == path-2, void selection (nothing), void modifier (skipped), quantity
 * multiplication, modifier qty 2, unmatched modifiers (pour sizes / garnishes ignored), ambiguous
 * name exclusion, item-backed mixer guid-equal fast path, no-modifier selection, nested modifiers
 * (one level walked, two levels not), duplicate-guid credits, and empty-nameMap (rung only).
 */
import {
  buildNameMap,
  creditsForSelection,
  emptyNameMap,
  normalizeName,
  type Credit,
  type CountSelection,
} from "../supabase/functions/toast-sync/selectionCounts.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `: got ${g}, want ${w}`}`);
}
// Sort credits into a stable order for order-independent comparison.
const sorted = (cs: Credit[]) =>
  [...cs].sort((a, b) => (a.guid + a.source).localeCompare(b.guid + b.source));

// ── name map from a toast_menu_cache snapshot (guid, name) ────────────────────
const cacheRows = [
  { guid: "of", name: "Old Fashioned" },
  { guid: "kc", name: "Knob Creek" },
  { guid: "sprite", name: "Sprite" },        // item-backed mixer (mod guid === item guid)
  { guid: "amaretto", name: "Amaretto Sour" },
  { guid: "hp1", name: "House Punch" },       // ambiguous — two items share the name
  { guid: "hp2", name: "House Punch" },
];
const nameMap = buildNameMap(cacheRows);

check("buildNameMap — byName has unambiguous names", nameMap.byName.get("knob creek"), "kc");
check("buildNameMap — ambiguous name excluded from byName", nameMap.byName.has("house punch"), false);
check("buildNameMap — ambiguous set records the collision", nameMap.ambiguous.has("house punch"), true);
check("buildNameMap — guids includes both ambiguous items (fast path still works)", nameMap.guids.has("hp1") && nameMap.guids.has("hp2"), true);
check("normalizeName — trim + lowercase", normalizeName("  Old Fashioned "), "old fashioned");

// ── no modifiers → rung item only ─────────────────────────────────────────────
check("no modifiers → rung item only",
  creditsForSelection({ item: { guid: "kc" }, quantity: 1 }, nameMap),
  [{ guid: "kc", qty: 1, source: "item" }]);

// ── path 1: COCKTAIL item + liquor-upgrade modifier ───────────────────────────
const path1 = creditsForSelection(
  { item: { guid: "of" }, quantity: 1, displayName: "Old Fashioned", modifiers: [{ displayName: "Knob Creek" }] },
  nameMap,
);
check("path-1 credits {OF item, KC modifier}", sorted(path1),
  sorted([{ guid: "of", qty: 1, source: "item" }, { guid: "kc", qty: 1, source: "modifier" }]));

// ── path 2: LIQUOR item + cocktail modifier ───────────────────────────────────
const path2 = creditsForSelection(
  { item: { guid: "kc" }, quantity: 1, displayName: "Knob Creek", modifiers: [{ displayName: "Old Fashioned" }] },
  nameMap,
);
check("path-2 credits {KC item, OF modifier}", sorted(path2),
  sorted([{ guid: "kc", qty: 1, source: "item" }, { guid: "of", qty: 1, source: "modifier" }]));

// ── THE INVARIANT: both paths credit the same guids by the same amounts ───────
const guidQty = (cs: Credit[]) => {
  const m: Record<string, number> = {};
  for (const c of cs) m[c.guid] = (m[c.guid] ?? 0) + c.qty;
  // Sort keys so the comparison is order-independent (JSON.stringify is key-order sensitive).
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));
};
check("path-1 and path-2 produce IDENTICAL tallies", guidQty(path1), guidQty(path2));
check("  …and the tally is KC:1, OF:1", guidQty(path1), { kc: 1, of: 1 });

// ── void selection → nothing ──────────────────────────────────────────────────
check("voided selection credits nothing",
  creditsForSelection({ voided: true, item: { guid: "of" }, modifiers: [{ displayName: "Knob Creek" }] }, nameMap),
  []);

// ── void modifier → skipped, rung item still credited ─────────────────────────
check("voided modifier skipped, rung item kept",
  creditsForSelection({ item: { guid: "of" }, quantity: 1, modifiers: [{ displayName: "Knob Creek", voided: true }] }, nameMap),
  [{ guid: "of", qty: 1, source: "item" }]);

// ── quantity multiplication (selQty × modQty) ─────────────────────────────────
check("qty multiplication: selQty 3 × modQty 2", sorted(creditsForSelection(
  { item: { guid: "of" }, quantity: 3, modifiers: [{ displayName: "Knob Creek", quantity: 2 }] }, nameMap,
)), sorted([{ guid: "of", qty: 3, source: "item" }, { guid: "kc", qty: 6, source: "modifier" }]));

// ── modifier with qty 2 ───────────────────────────────────────────────────────
check("modifier qty 2", sorted(creditsForSelection(
  { item: { guid: "kc" }, quantity: 1, modifiers: [{ displayName: "Amaretto Sour", quantity: 2 }] }, nameMap,
)), sorted([{ guid: "kc", qty: 1, source: "item" }, { guid: "amaretto", qty: 2, source: "modifier" }]));

// ── unmatched modifiers (pour sizes / garnishes) → ignored ────────────────────
check("unmatched modifiers ignored (pour size, dirty, garnish)",
  creditsForSelection({ item: { guid: "kc" }, quantity: 1, modifiers: [
    { displayName: ".25oz" }, { displayName: "Dirty" }, { displayName: "Extra Olive" },
  ] }, nameMap),
  [{ guid: "kc", qty: 1, source: "item" }]);

// ── ambiguous name → NOT credited (never guess) ───────────────────────────────
check("ambiguous modifier name not credited",
  creditsForSelection({ item: { guid: "kc" }, quantity: 1, modifiers: [{ displayName: "House Punch" }] }, nameMap),
  [{ guid: "kc", qty: 1, source: "item" }]);

// ── item-backed mixer: guid-equal FAST PATH (name doesn't match, guid does) ───
check("item-backed mixer credited via guid fast path", sorted(creditsForSelection(
  { item: { guid: "kc" }, quantity: 1, modifiers: [{ displayName: "Sprite (sub)", item: { guid: "sprite" } }] }, nameMap,
)), sorted([{ guid: "kc", qty: 1, source: "item" }, { guid: "sprite", qty: 1, source: "modifier" }]));

// ── nested modifiers: ONE level walked ────────────────────────────────────────
check("nested modifier one level deep is credited", sorted(creditsForSelection(
  { item: { guid: "kc" }, quantity: 1, modifiers: [{ displayName: "unmatched", modifiers: [{ displayName: "Old Fashioned" }] }] }, nameMap,
)), sorted([{ guid: "kc", qty: 1, source: "item" }, { guid: "of", qty: 1, source: "modifier" }]));

check("nested modifier TWO levels deep is NOT walked",
  creditsForSelection({ item: { guid: "kc" }, quantity: 1, modifiers: [
    { displayName: "x", modifiers: [{ displayName: "y", modifiers: [{ displayName: "Old Fashioned" }] }] },
  ] }, nameMap),
  [{ guid: "kc", qty: 1, source: "item" }]);

// ── duplicate-guid credits are correct (caller sums) ──────────────────────────
check("item credited as both rung and modifier → two entries", sorted(creditsForSelection(
  { item: { guid: "of" }, quantity: 1, modifiers: [{ displayName: "Old Fashioned" }] }, nameMap,
)), sorted([{ guid: "of", qty: 1, source: "item" }, { guid: "of", qty: 1, source: "modifier" }]));

// ── empty name map → rung item only (modifiers never match) ───────────────────
check("empty nameMap → rung item only",
  creditsForSelection({ item: { guid: "of" }, quantity: 1, modifiers: [{ displayName: "Knob Creek" }] }, emptyNameMap()),
  [{ guid: "of", qty: 1, source: "item" }]);

// ── selection with no item guid but a matched modifier → modifier only ────────
check("no rung item, matched modifier still credited",
  creditsForSelection({ quantity: 1, modifiers: [{ displayName: "Knob Creek" }] } as CountSelection, nameMap),
  [{ guid: "kc", qty: 1, source: "modifier" }]);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll selection-counts tests passed.");
