# Toast Descriptions — Formatting Handoff

Standalone brief for whoever (or whatever session) is driving the Toast description paste run.
The goal: fill in the **Description** field on Toast menu items. Once filled and published,
the content flows automatically — no deploy, no code — to:

- the public website menu (bunkerokc.com/menu — blurb under the item name)
- What's-On promo card bodies (website + TV event cards that reference the item)
- drink-slide ingredient fallbacks on the bar TVs (hand-authored slide overrides still win)

## The one formatting rule that matters

Every description uses this shape, **all on one line**:

```
Public text customers can see --- private staff notes / build recipe
```

- Everything **before** the first `---` is the public blurb.
- Everything **after** `---` is staff-only. It is never rendered anywhere public.
- **No `---` at all = nothing shows publicly.** This is a deliberate safety default
  (old descriptions may contain recipes/costs), so a description without the delimiter
  is treated as all-private. If an item should show a blurb, it MUST contain `---`.
- Nothing private to say? End with the delimiter anyway:
  `Gin, elderflower, lemon — bright and floral ---`
- Only the FIRST `---` counts; a second one just becomes part of the private text.

### Two hard constraints from Toast

1. **1,000-character cap** on the whole field, public + private combined.
2. **Line breaks don't survive** the bulk-edit grid — keep the entire thing inline,
   `---` included. Do not try to format with new lines.

### Examples

Good:
```
Vodka, midori, pineapple, glow-in-the-dark garnish. Our radioactive signature. --- 1.5oz vodka, .75 midori, top pineapple. Highball, sonic ice.
```
Shows publicly: "Vodka, midori, pineapple, glow-in-the-dark garnish. Our radioactive signature."

Bad (no delimiter — shows NOTHING publicly even though it looks harmless):
```
Vodka, midori, pineapple, glow-in-the-dark garnish.
```

## Where to do it in Toast (the proven path)

Toast web dashboard → **Menus → Bulk management → Advanced properties**.
That opens a spreadsheet-style grid with a **Description** column you can type straight into.

1. Edit descriptions in the grid (paste works cell-by-cell).
2. **Save** (top of the grid).
3. **Publish** (Toast changes are inert until published).

Do **NOT** use the CSV "Item Update Template" import path — it's irreversible and
plan-gated. The Advanced-properties grid is the safe way.

## Verifying it worked

`toast-menu-sync` runs every 2 minutes, so within ~2–3 minutes of Publish:
check bunkerokc.com/menu — the blurb appears under the item. That's the whole loop.

Notes:
- Items hidden from the POS view don't show on the website at all (deliberate gate),
  so don't be surprised if a POS-hidden item's blurb never appears.
- The Signature Cocktails group is already done (pasted 2026-07-15) — it's the
  reference for what finished entries look like.

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
