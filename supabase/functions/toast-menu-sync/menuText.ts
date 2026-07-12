// menuText.ts — description-safety rule (docs/09). Pure + dependency-free so it runs under
// Deno (the edge function) and Node/tsx (unit test).
//
// Toast item descriptions may contain internal recipes/notes. NEVER auto-display the raw
// description. Convention: only the text BEFORE a `---` delimiter is public blurb; with no
// delimiter, show NOTHING until a human fills a blurb override. This function returns the
// safe-to-display blurb (or '').
export function publicBlurb(description: string | null | undefined): string {
  if (!description) return "";
  const idx = description.indexOf("---");
  if (idx === -1) return ""; // no delimiter → nothing is safe to auto-show
  return description.slice(0, idx).trim();
}
