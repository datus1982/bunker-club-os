/**
 * Unit test for the pour-size price-options extractor (toast-menu-sync priceOptions).
 * `pnpm test:priceoptions` (npx tsx scripts/test-price-options.ts). Pure fixtures, no I/O —
 * same style as test-menu-text.ts.
 *
 * Contract under test (owner ask 2026-07-17):
 *   - candidate group = referenced group whose NAME matches /size|tier|pour/i;
 *   - label: parenthetical wins → uppercased; else the name itself uppercased; leading-decimal
 *     fractions (.25oz/.5oz/.75) EXCLUDED (internal builds);
 *   - multi-group transition: pick the group used by MORE items venue-wide, tiebreak ref id;
 *   - dedupe by normalized label (first wins); sort ascending by price; $0/absent excluded;
 *     empty → null.
 */
import {
  deriveOptionLabel,
  isSizeGroupName,
  buildGroupUsage,
  extractPriceOptions,
  type RawModifierGroup,
  type RawModifierOption,
  type PriceOption,
} from "../supabase/functions/toast-menu-sync/priceOptions.ts";

let failures = 0;
function eq<T>(label: string, got: T, want: T) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}: got ${g}, want ${w}`);
}

// ── deriveOptionLabel ────────────────────────────────────────────────────────
eq("paren wins: 1oz (Shot) → SHOT", deriveOptionLabel("1oz (Shot)"), "SHOT");
eq("paren: 1.5oz (Cocktail) → COCKTAIL", deriveOptionLabel("1.5oz (Cocktail)"), "COCKTAIL");
eq("paren: 2oz (Double) → DOUBLE", deriveOptionLabel("2oz (Double)"), "DOUBLE");
eq("paren: 16oz (Pint) → PINT", deriveOptionLabel("16oz (Pint)"), "PINT");
eq("paren: 48oz (Pitcher) → PITCHER", deriveOptionLabel("48oz (Pitcher)"), "PITCHER");
eq("paren case-insensitive: 1oz (shot) → SHOT", deriveOptionLabel("1oz (shot)"), "SHOT");
eq("paren with spaces: 1.5 oz (Cocktail) → COCKTAIL", deriveOptionLabel("1.5 oz (Cocktail)"), "COCKTAIL");
eq("bare Pint → PINT", deriveOptionLabel("Pint"), "PINT");
eq("bare Pitcher → PITCHER", deriveOptionLabel("Pitcher"), "PITCHER");
eq("Sugar Free → SUGAR FREE", deriveOptionLabel("Sugar Free"), "SUGAR FREE");
eq("Regular → REGULAR", deriveOptionLabel("Regular"), "REGULAR");
eq("Tall → TALL", deriveOptionLabel("Tall"), "TALL");
eq("bare Double → DOUBLE", deriveOptionLabel("Double"), "DOUBLE");
eq("whole-number pour: 1.5oz → 1.5OZ (shows)", deriveOptionLabel("1.5oz"), "1.5OZ");
eq("leading-decimal .25oz → excluded", deriveOptionLabel(".25oz"), null);
eq("leading-decimal .5oz → excluded", deriveOptionLabel(".5oz"), null);
eq("leading-decimal .75oz → excluded", deriveOptionLabel(".75oz"), null);
eq("bare fraction .75 → excluded", deriveOptionLabel(".75"), null);
eq("0.5oz → excluded", deriveOptionLabel("0.5oz"), null);
eq("empty → null", deriveOptionLabel(""), null);
eq("null → null", deriveOptionLabel(null), null);
eq("whitespace-only → null", deriveOptionLabel("   "), null);

// ── isSizeGroupName ──────────────────────────────────────────────────────────
eq("Size is candidate", isSizeGroupName("Size"), true);
eq("Size GC Vodka is candidate", isSizeGroupName("Size GC Vodka"), true);
eq("Pour Size is candidate", isSizeGroupName("Pour Size"), true);
eq("Tier 1 is candidate (future shared)", isSizeGroupName("Tier 1"), true);
eq("Well Tier is candidate", isSizeGroupName("Well Tier"), true);
eq("Cocktail Mods NOT candidate", isSizeGroupName("Cocktail Mods"), false);
eq("Mixers NOT candidate", isSizeGroupName("Mixers"), false);
eq("Garnish NOT candidate", isSizeGroupName("Garnish"), false);
eq("1 oz Zing Zang NOT candidate", isSizeGroupName("1 oz Zing Zang"), false);
eq("null NOT candidate", isSizeGroupName(null), false);

// ── extractPriceOptions ──────────────────────────────────────────────────────
const optionRefs: Record<string, RawModifierOption> = {
  // Jameson-style Size group (real per-item shape from the live probe)
  "1001": { name: "1oz (Shot)", price: 6 },
  "1002": { name: "1.5oz (Cocktail)", price: 9 },
  "1003": { name: "2oz (Double)", price: 11 },
  "1004": { name: ".25oz", price: 2 },
  "1005": { name: ".75oz", price: 6 },
  // Draft beer with parenthetical
  "2001": { name: "16oz (Pint)", price: 5 },
  "2002": { name: "48oz (Pitcher)", price: 18 },
  // Draft beer with BARE size names (Miller Lite shape)
  "2101": { name: "Pint", price: 4 },
  "2102": { name: "Pitcher", price: 15 },
  // Blantons: bare whole-number pour + Double
  "3001": { name: "1.5oz", price: 20 },
  "3002": { name: "Double", price: 35 },
  // Red Bull: descriptive names, two share a price
  "4001": { name: "Regular", price: 4 },
  "4002": { name: "Sugar Free", price: 4 },
  "4003": { name: "Tall", price: 6 },
  // A $0-only decoy "Pour Size" group (ref-464 shape)
  "5001": { name: "1 oz (Shot)", price: 0 },
  "5002": { name: "1.5 oz (Cocktail)", price: 0 },
  // Cocktail Mods (NOT a size group) — must never surface
  "6001": { name: "Aviation", price: 4 },
  "6002": { name: "Cosmo", price: 3 },
  // Dedup: two options normalizing to the same label, different prices (first wins)
  "7001": { name: "Double", price: 12 },
  "7002": { name: "Double", price: 99 },
  // Group whose options are ALL internal fractions → empty → null
  "8001": { name: ".25oz", price: 3 },
  "8002": { name: ".75oz", price: 6 },
};
const groupRefs: Record<string, RawModifierGroup> = {
  "100": { name: "Size", modifierOptionReferences: [1001, 1002, 1003, 1004, 1005] },
  "200": { name: "Size", modifierOptionReferences: [2001, 2002] },
  "210": { name: "Size", modifierOptionReferences: [2101, 2102] },
  "300": { name: "Size", modifierOptionReferences: [3001, 3002] },
  "377": { name: "Size", modifierOptionReferences: [4001, 4002, 4003] },
  "464": { name: "Pour Size", modifierOptionReferences: [5001, 5002] },
  "600": { name: "Cocktail Mods", modifierOptionReferences: [6001, 6002] },
  "700": { name: "Size", modifierOptionReferences: [7001, 7002] },
  "800": { name: "Size", modifierOptionReferences: [8001, 8002] },
  // Shared tier group used by many bottles (future restructure)
  "900": { name: "Well Tier", modifierOptionReferences: [1001, 1002, 1003] },
};

function opts(groupRefIds: Array<number | string>, usage: Record<string, number> = {}): PriceOption[] | null {
  return extractPriceOptions({ groupRefIds, groupRefs, optionRefs, usage });
}

eq(
  "Jameson: SHOT $6 · COCKTAIL $9 · DOUBLE $11 (fractions dropped, sorted)",
  opts([100, 600]),
  [{ label: "SHOT", price: 6 }, { label: "COCKTAIL", price: 9 }, { label: "DOUBLE", price: 11 }],
);
eq(
  "Draft (paren): PINT $5 · PITCHER $18",
  opts([200]),
  [{ label: "PINT", price: 5 }, { label: "PITCHER", price: 18 }],
);
eq(
  "Draft (bare): PINT $4 · PITCHER $15",
  opts([210]),
  [{ label: "PINT", price: 4 }, { label: "PITCHER", price: 15 }],
);
eq(
  "Blantons: 1.5OZ $20 · DOUBLE $35 (bare whole-number pour shows)",
  opts([300]),
  [{ label: "1.5OZ", price: 20 }, { label: "DOUBLE", price: 35 }],
);
eq(
  "Red Bull: REGULAR $4 · SUGAR FREE $4 · TALL $6 (equal prices kept, order stable)",
  opts([377]),
  [{ label: "REGULAR", price: 4 }, { label: "SUGAR FREE", price: 4 }, { label: "TALL", price: 6 }],
);
eq("no groups → null", opts([]), null);
eq("only a non-size group → null", opts([600]), null);
eq("$0-only Pour Size decoy → null", opts([464]), null);
eq("all-fraction size group → null", opts([800]), null);
eq(
  "dedup by label, first wins ($12 not $99)",
  opts([700]),
  [{ label: "DOUBLE", price: 12 }],
);

// Multi-group transition: item references BOTH a per-item Size (used by 1) and a shared Well
// Tier (used by 30). Shared tier wins; options are the tier's, never merged with the per-item.
eq(
  "transition: shared tier (more usage) wins over per-item Size",
  opts([100, 900], { "100": 1, "900": 30 }),
  [{ label: "SHOT", price: 6 }, { label: "COCKTAIL", price: 9 }, { label: "DOUBLE", price: 11 }],
);
// Tie on usage (both 1) → lower ref id wins (100 < 900 → Size group, which has fractions too).
eq(
  "transition tie → lower ref id wins (deterministic)",
  opts([900, 100], { "100": 1, "900": 1 }),
  [{ label: "SHOT", price: 6 }, { label: "COCKTAIL", price: 9 }, { label: "DOUBLE", price: 11 }],
);

// ── buildGroupUsage ──────────────────────────────────────────────────────────
eq(
  "usage counts distinct items per group",
  buildGroupUsage([[100, 600], [900, 100], [900], [900, 900]]),
  { "100": 2, "600": 1, "900": 3 },
);
eq("usage handles empty/nullish lists", buildGroupUsage([[], null, undefined, [100]]), { "100": 1 });

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll price-options tests passed.");
