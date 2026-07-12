/**
 * Unit test for the docs/09 description-safety rule (toast-menu-sync publicBlurb).
 * `npx tsx scripts/test-menu-text.ts`. Internal recipe text after `---` must NEVER be
 * exposed; with no delimiter, nothing is safe to auto-show.
 */
import { publicBlurb } from "../supabase/functions/toast-menu-sync/menuText.ts";

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

if (failures > 0) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log("\nAll menu-text tests passed.");
