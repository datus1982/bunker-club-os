/**
 * Unit test for the docs/09 description-safety rule (toast-menu-sync publicBlurb).
 * `npx tsx scripts/test-menu-text.ts`. Internal recipe text after `---` must NEVER be
 * exposed; with no delimiter, nothing is safe to auto-show.
 */
import { publicBlurb, publicLongform } from "../supabase/functions/toast-menu-sync/menuText.ts";

let failures = 0;
function check(label: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

check("blurb before delimiter is public", publicBlurb("Smoky, bittersweet. ---2oz mezcal, secret bitters"), "Smoky, bittersweet.");
check("no delimiter → nothing shown", publicBlurb("2oz mezcal, house bitters, internal recipe"), "");
check("empty/null → empty", publicBlurb(null), "");
check("empty string → empty", publicBlurb(""), "");
check("delimiter at start → empty blurb", publicBlurb("---all secret"), "");
check("trims whitespace", publicBlurb("  Crisp lager  \n---brewed in OKC"), "Crisp lager");

// ── publicLongform (docs/09 extension): the authored long-form after `--- recipe |` ──
// Recipe (between `---` and the first following `|`) is PRIVATE and must never appear here.
check("no delimiter → nothing", publicLongform("Just a plain description, no delimiters"), "");
check("--- only, no pipe → nothing", publicLongform("Smoky, bittersweet. ---2oz mezcal, house bitters"), "");
check("--- recipe | long → long-form only", publicLongform("Smoky. --- 2oz mezcal, 0.75oz lime | A whisper of the old world, aflame and citrus."), "A whisper of the old world, aflame and citrus.");
check("--- | long (empty recipe) → long-form", publicLongform("Crisp. --- | Brewed a mile from the bunker."), "Brewed a mile from the bunker.");
check("pipe-before-`---` only → '' (recipe has no pipe)", publicLongform("Tart | tangy --- 2oz gin, lemon"), "");
check("blurb keeps its pipe when recipe has no pipe", publicBlurb("Tart | tangy --- 2oz gin, lemon"), "Tart | tangy");
check("pipe with no `---` → nothing public (longform)", publicLongform("Bright | citrusy, no delimiter here"), "");
check("pipe with no `---` → nothing public (blurb)", publicBlurb("Bright | citrusy, no delimiter here"), "");
check("multiple pipes after `---` → split at FIRST, long-form keeps its pipes", publicLongform("Herbal. --- 1oz Chartreuse | Green | verdant | alpine."), "Green | verdant | alpine.");
check("long-form whitespace trimmed", publicLongform("Rich. ---  espresso, cream   |    Midnight in a mug.   "), "Midnight in a mug.");
check("null/empty → empty (longform)", publicLongform(null), "");
check("empty string → empty (longform)", publicLongform(""), "");
check("blurb unaffected by full 3-part format", publicBlurb("Smoky. --- 2oz mezcal | A whisper of the old world."), "Smoky.");

if (failures > 0) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log("\nAll menu-text tests passed.");
