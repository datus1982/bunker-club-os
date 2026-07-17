# Toast Descriptions — Formatting Handoff

Standalone brief for whoever (or whatever session) is driving the Toast description paste run.
The goal: fill in the **Description** field on Toast menu items. Once filled and published,
the content flows automatically — no deploy, no code — to:

- the public website menu (bunkerokc.com/menu — the short blurb under the item name)
- What's-On promo card bodies (website + TV event cards that reference the item)
- drink-slide ingredient fallbacks on the bar TVs (hand-authored slide overrides still win)
- the long-form description (the eloquent write-up), which renders under the menu
  ingredient line on the website and is available to signage surfaces

## The formatting rule that matters

Every description uses this **three-part** shape, **all on one line**:

```
Short public blurb --- build recipe | Long-form public description
```

Two delimiters, in this order:

- **`---`** splits **public short blurb** (before) from **staff-only** (after).
- **`|`** — the FIRST pipe *after* `---` — splits the **private recipe** (before the
  pipe) from the **public long-form description** (after it).

So the three segments are:

1. **Short blurb** — before `---`. Public. This is the line customers see on the menu,
   in What's-On card bodies, and as the slide ingredient fallback. Keep it sign-length.
2. **Recipe** — between `---` and the first `|`. **PRIVATE.** Never stored, never shown
   anywhere public — it never leaves the write-side sync.
3. **Long-form** — after the first `|`. Public. The eloquent write-up; renders under the
   menu ingredient line and is available to signage.

Behavior notes:

- **No `---` at all = nothing shows publicly** (short blurb empty AND long-form empty).
  Deliberate safety default (old descriptions may carry recipes/costs), so a description
  without the delimiter is treated as all-private. If an item should show anything, it
  MUST contain `---`.
- **No `|` after `---` = no long-form** (everything after `---` is private recipe).
  Fine — the short blurb still shows. Add `|` only when you have a long-form to publish.
- Only the FIRST `---` counts, and only the FIRST `|` *after* it counts. A second `---`,
  or pipes that appear *inside the long-form*, are just part of that later text.

### ⚠ The `|` rule (WARN-2) — DO NOT put a pipe inside the recipe

The first `|` after `---` **starts the public long-form.** That means **any `|` inside
the recipe segment publishes everything after it** — your build would leak onto the
website.

- **FORBIDDEN:** a `|` anywhere in the recipe. Use commas or semicolons in builds instead
  (`1.5oz vodka; .75 midori; top pineapple` — never `1.5oz vodka | .75 midori`).
- **Harmless:** pipes in the **short blurb** (before `---`) — only pipes *after* `---` are
  delimiters, so a `|` in the blurb stays part of the blurb.
- **Fine:** pipes in the **long-form** (after the first `|`) — they're just text there.

### Two hard constraints from Toast

1. **1,000-character cap** on the whole field, all three segments combined.
2. **Line breaks don't survive** the bulk-edit grid — keep the entire thing inline,
   `---` and `|` included. Do not try to format with new lines.

### Examples

Good (all three parts):
```
Vodka, midori, pineapple, glow-in-the-dark garnish. Our radioactive signature. --- 1.5oz vodka, .75 midori, top pineapple; highball, sonic ice | Our most-poured drink glows for a reason: a bright, tropical rush with a garnish that literally lights up the bar.
```
- Menu line (short blurb): "Vodka, midori, pineapple, glow-in-the-dark garnish. Our radioactive signature."
- Under the ingredient line (long-form): "Our most-poured drink glows for a reason…"
- Never shown: the recipe between `---` and `|`.

Good (blurb + recipe, no long-form — just omit the pipe):
```
Gin, elderflower, lemon — bright and floral. --- 1.5oz gin, .5 elderflower, .5 lemon
```

Bad (no delimiter — shows NOTHING publicly even though it looks harmless):
```
Vodka, midori, pineapple, glow-in-the-dark garnish.
```

Bad (pipe INSIDE the recipe — leaks the rest of the build publicly as "long-form"):
```
Bright and floral. --- 1.5oz gin | .5 elderflower, .5 lemon
```
Publishes ".5 elderflower, .5 lemon" as the public long-form. Use `;` in the build instead.

## Where to do it in Toast (the proven path)

Toast web dashboard → **Menus → Bulk management → Advanced properties**.
That opens a spreadsheet-style grid with a **Description** column you can type straight into.

1. Edit descriptions in the grid (paste works cell-by-cell).
2. **Save** (top of the grid).
3. **Publish** (Toast changes are inert until published).

⚠️ **Known trap (learned the hard way, 2026-07-16): the grid SILENTLY DROPS bulk
multi-row saves.** Single-row edits save fine, and the Save button greys out as if it
worked — but reload the grid after any multi-row save and CHECK the values actually
stuck. If they didn't, the working bulk path is the grid's own API endpoint
(`POST /advancedproperties/updatechildren`, chunked ~40 rows — a dev/cowork session
can drive it), followed by the **global Publish Config page** (the page-level Publish
button stays greyed for API saves).

Do **NOT** use the CSV "Item Update Template" import path — it's irreversible and
plan-gated. The Advanced-properties grid is the safe way for small edits.

## Verifying it worked

`toast-menu-sync` runs every 2 minutes, so within ~2–3 minutes of Publish:
check bunkerokc.com/menu — the blurb appears under the item. That's the whole loop.

Notes:
- Items hidden from the POS view don't show on the website at all (deliberate gate —
  the `pos_visible` WHERE-clause on the `public_menu` view), so don't be surprised if a
  POS-hidden item's blurb never appears. (Winter Cocktails is the standing example.)
- The bulk description run is done (~230 items, 2026-07-16) in the three-part format —
  any published item is a reference for what finished entries look like.

## Photos (separate, slower chore)

There is **no bulk image path** in Toast — item photos are one-by-one on each item's
page. Recommended size 750×450. Same Save + Publish rule. Photos flow to the website
menu and drink slides the same automatic way.

## The worksheet

A pre-filled worksheet (all 33 unique drinks transcribed from the hand-made slide PNGs,
22 rows matched to menu items, in ready-to-paste `public --- private` format) was
delivered 2026-07-14 but lived in a temp directory that's gone. If it would help, any
Bunker OS dev session can regenerate it from `docs/Drink Slides.zip` in the repo —
ask for "regenerate the toast-descriptions worksheet." The formatting rules above
stand alone without it.
