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

// publicLongform — the OWNER-AUTHORED long-form description (docs/09 extension, 2026-07-16).
//
// Format the owner adopted for ~230 Toast items:
//   <short public blurb>  ---  <recipe>  |  <long-form description with character>
//
// The segment AFTER the first `|` that FOLLOWS the `---` is public BY CONSTRUCTION — he
// wrote it for display. The RECIPE (between `---` and that first `|`) is PRIVATE and must
// never leave the edge function or land in our DB — so we parse the long-form out and
// discard the recipe, preserving publicBlurb's posture of never storing post-`---` text
// wholesale.
//
// Contract (must match publicBlurb's safety exactly):
//   • No `---` anywhere → "" (nothing public — a bare `|` with no `---` is NOT a delimiter).
//   • Text after `---` with no `|` → "" (recipe only, no long-form was authored).
//   • Split at the FIRST `|` after `---` only; the long-form may itself contain `|`.
//   • A `|` in the public segment BEFORE `---` is just text (we only inspect after `---`).
// Pure + dependency-free so it runs under Deno (edge fn) and Node/tsx (unit test).
export function publicLongform(description: string | null | undefined): string {
  if (!description) return "";
  const idx = description.indexOf("---");
  if (idx === -1) return ""; // no delimiter → nothing is public
  const tail = description.slice(idx + 3); // everything after the first `---` (recipe + long-form)
  const pipe = tail.indexOf("|");
  if (pipe === -1) return ""; // recipe only, no `|` → no authored long-form
  return tail.slice(pipe + 1).trim(); // long-form is everything after the FIRST post-`---` pipe
}
