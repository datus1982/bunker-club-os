/**
 * MENU GROUP slide (0065) — the PURE half: row resolution + the whole sizing model.
 *
 * No React, no Supabase, no `@/` alias imports (the eventStage.ts contract), so it runs
 * unchanged under `tsx` — scripts/test-menu-group.ts imports THIS file, not the component.
 * useSignage.ts re-exports the row surface so the app keeps one import.
 *
 * ── THE SIZING MODEL (rebuilt 2026-09-01 after the cold review, WARN-2) ─────────────────
 * The first cut sized the row NAME-first (name = 45% of the row) and gave the description
 * whatever fell out, then ellipsized what didn't fit. On the owner's real data that clipped a
 * description on nearly every row — Tiki Tuesday 6 of 7, Signature Cocktails 8 of 8 — which is
 * the worst outcome on a menu: a half-sentence of ingredients is more annoying than none.
 *
 * The ruling is WHOLE DESCRIPTIONS OR NONE. So the budget is now DESCRIPTION-FIRST:
 *   1. measure how many lines each description needs AT the shared SUPPORT_TEXT floor,
 *   2. reserve that, and give the NAME the remainder (never below the floor, never above a cap),
 *   3. grow the description back up from the floor to the largest size where every kept row
 *      still fits WHOLE,
 *   4. a description that cannot fit whole even at the floor is OMITTED for that row — there is
 *      no ellipsis and no line-clamp anywhere in this template,
 *   5. and if reserving descriptions would push a NAME under its own floor, the slide drops
 *      descriptions entirely and the names take the row (the "or none" half of the ruling).
 *
 * ── WHY THE ARITHMETIC IS EXACT ────────────────────────────────────────────────────────
 * Every signage surface renders in VT323 (terminal-theme.css), a MONOSPACE face whose advance
 * width MEASURED at 0.400 × font-size, exactly and linearly, at 40/60/100px (headless Chrome,
 * 2026-09-01, after `document.fonts.load('100px VT323')` — an unloaded font measures against
 * fallback metrics and lies, see PR #89). So text width is arithmetic, not a guess:
 *     width(chars, size) = chars × (MG_MONO_RATIO × size + letterSpacing)
 * and line counts are a plain greedy word-wrap. The component still MEASURES the ratio at
 * runtime and feeds it back in, so a font fallback (Share Tech Mono) self-corrects instead of
 * silently mis-planning; MG_MONO_RATIO is only the first-frame default.
 *
 * Remember `.terminal-theme *` sets font-size on EVERY element, so nothing inherits — every
 * size this module computes is applied as an explicit inline px by the component (PR #89).
 */
import type { Orientation, SignageItem, ToastCacheRow, PriceOption } from "./useSignage";
import { SUPPORT_TEXT } from "./supportText";
import { balanceHeadline } from "./eventStage";

/* ── row resolution ───────────────────────────────────────────────────────────── */

/** The exact toast_menu_cache `menu_group` string a MENU GROUP slide lists (fields.group). */
export function menuGroupOf(item: SignageItem): string {
  const v = item.fields?.group;
  return typeof v === "string" ? v.trim() : "";
}

/** One resolved menu line, in the shape the slide renders. Mirrors the public /menu row
 *  (modules/website/useMenu.ts MenuItem) so the two surfaces show the SAME item the same way. */
export interface MenuGroupRow {
  guid: string;
  name: string;
  price: number | null;
  image: string | null;
  blurb: string | null;
  priceOptions: PriceOption[] | null;
  /** Toast's own menu ordering (public_menu.item_position). null for an item Toast gives no
   *  position — those fall to name order behind the positioned ones. */
  position: number | null;
}

/** The website-parity filters a MENU GROUP slide applies on top of the Toast mirror. */
export interface MenuGroupFilters {
  /** venue_settings.site_menu_hidden_guids — POS-convenience rows the owner suppresses publicly. */
  hidden: Set<string>;
  /** public_menu.item_position by guid (0064). Empty when the read fails ⇒ name order. */
  order: Map<string, number>;
}

/**
 * Resolve ONE Toast menu group into the rows a MENU GROUP slide lists.
 *
 * DECISION (website parity — the owner asked for it "similarly to how it is on the website"):
 * this applies the SAME three gates modules/website/useMenu.ts applies to /menu —
 *   1. `pos_visible` (0034 owner principle: never advertise what isn't active on the POS view),
 *   2. out-of-stock (86'd items are hidden, not greyed),
 *   3. venue_settings.site_menu_hidden_guids (the "Sputnik 1/2 off" class of register-only row),
 * so a drink the owner has taken off the public menu never reappears on a bar TV.
 *
 * PURE — one function shared by the template (what to draw) and resolveRotation (whether the
 * card survives at all), so the auto-hide can never disagree with the render and leave a blank
 * dwell. `filters` is optional: absent ⇒ no hidden-guid suppression and name ordering (the hub
 * and the item editor's preview have no live settings read; see useSiteMenuFilters).
 */
export function menuGroupRows(
  toast: Map<string, ToastCacheRow>,
  group: string,
  filters?: MenuGroupFilters,
): MenuGroupRow[] {
  const want = group.trim().toLowerCase();
  if (!want) return [];
  const rows: MenuGroupRow[] = [];
  for (const [guid, r] of toast) {
    if ((r.menu_group ?? "").trim().toLowerCase() !== want) continue;
    if (r.out_of_stock || !r.pos_visible) continue;
    if (filters?.hidden.has(guid)) continue;
    if (!r.name) continue;
    rows.push({
      guid,
      name: r.name,
      price: r.price,
      image: r.image,
      blurb: r.public_blurb,
      priceOptions: cleanPriceOptions(r.price_options),
      position: filters?.order.get(guid) ?? null,
    });
  }
  // Toast's own order first (nulls last — an unpositioned item never jumps the list), then name.
  rows.sort((a, b) => {
    const ap = a.position ?? Number.MAX_SAFE_INTEGER;
    const bp = b.position ?? Number.MAX_SAFE_INTEGER;
    return ap - bp || a.name.localeCompare(b.name);
  });
  return rows;
}

/** Defensive price-options clean (byte-mirrors modules/website/useMenu.ts cleanOptions): only
 *  well-formed {label:string, price:number} entries survive, and an empty result is null so the
 *  row falls back to the single-price path instead of rendering an empty options strip. */
function cleanPriceOptions(raw: PriceOption[] | null): PriceOption[] | null {
  if (!Array.isArray(raw)) return null;
  const ok = raw.filter(
    (o): o is PriceOption =>
      !!o && typeof o.label === "string" && o.label.length > 0 && typeof o.price === "number",
  );
  return ok.length > 0 ? ok : null;
}

/* ── constants ────────────────────────────────────────────────────────────────── */

/** VT323 advance width as a fraction of font-size — MEASURED, not assumed (see the header). */
export const MG_MONO_RATIO = 0.4;
/** Letter-spacing on the NAME cell, matching FitText's `letterSpacing: 1`. Descriptions and
 *  prices render at the browser default (0) — no rule in terminal-theme.css touches them. */
const NAME_LS = 1;
/** Line box multipliers: names are a headline (tight), descriptions are prose (airier). */
const LH_NAME = 1.05;
const LH_BLURB = 1.25;

/** Slide title size. Landscape slimmed 66 → 56 with the sub-line moved INLINE (cold-review
 *  NOTE-5: the landscape header was eating 215 of 863px before the first row). */
export const MG_HEADER: Record<Orientation, number> = { portrait: 88, landscape: 56 };

/**
 * The minimum row height a page may use before the list PAGINATES instead of shrinking further.
 * DERIVED: a row must hold a NAME at 1.4 × the shared SUPPORT_TEXT floor (a name is a headline,
 * not a supporting label) PLUS one description line at the floor, inside the 0.94 usable share:
 *   portrait   (40×1.4×1.05 + 40×1.25 + 9) / 0.94 = 125.6 → 126
 *   landscape  (32×1.4×1.05 + 32×1.25 + 6) / 0.94 =  98.8 → 100
 * Against the MEASURED content zones of the two bar screens (portrait 984×1418, landscape
 * 1808×719 — read off the running app, 2026-09-01) that is 10 rows per portrait page and 6 per
 * landscape column, so the owner's cases (Tiki Tuesday 7, Signature Cocktails 8) are ONE page in
 * both orientations and a monster group like Cordials (55 showable) pages rather than rendering
 * an unreadable 55-line wall.
 */
export const MG_MIN_ROW: Record<Orientation, number> = { portrait: 126, landscape: 100 };

/** Name size ceilings. DENSE = this slide renders descriptions (the name shares the row);
 *  ROOMY = it does not, so the name grows into the freed budget. Caps stop a short group
 *  going cartoonish; the small-group boost below relaxes them for 1–3 row sections. */
export const MG_NAME_CAP = {
  dense: { portrait: 120, landscape: 88 },
  roomy: { portrait: 200, landscape: 150 },
} as const;
/** Description ceiling — it is never LOUDER than the name it describes, and never below the
 *  shared SUPPORT_TEXT floor (below the floor it is omitted instead). */
export const MG_BLURB_CAP: Record<Orientation, number> = { portrait: 52, landscape: 40 };

/** Cold-review NOTE-4: a 1–3 row group (Wine has exactly one showable bottle) left ~300px of
 *  content in a 1418px row. Small groups get proportionally bigger caps and a photo that takes
 *  the whole row, so they still read as a full slide. */
export const MG_SMALL_GROUP = 3;
export const MG_SMALL_BOOST = 1.6;

/** Horizontal gaps INSIDE a row (photo↔text, text↔price) and BETWEEN landscape columns. */
const MG_ROW_GAP: Record<Orientation, number> = { portrait: 26, landscape: 20 };
export const MG_COL_GAP = 56;
/** Breathing room to the right of the price cell, and the two gaps inside a pour-option strip. */
const PRICE_PAD = 10;
export const MG_OPT_GAP = 16;
export const MG_OPT_LABEL_GAP = 6;
/** Hard ceiling on the price column as a share of the row — the measure-tight width below is
 *  what normally wins (cold-review NOTE-1: a fixed 0.42 share reserved 368px for a strip that
 *  measures ~330px, and the stolen 40px is exactly what dropped long names under their floor). */
const PRICE_W_CAP = {
  options: { portrait: 0.44, landscape: 0.42 },
  single: { portrait: 0.24, landscape: 0.22 },
} as const;

/**
 * NAME COLOUR. docs/09's colour-state rule renders live-sourced values GREEN, and every value on
 * this slide is live from Toast — but a full screen of green names is the "wall" the TopSellers
 * beat explicitly avoids, and a printed menu reads names in the body colour. So the PRICE (the
 * value that actually moves) is green and the names stay ambient amber. Owner ruling pending:
 * flip this ONE constant to render names green, the CHAMPION_COUNT_GREEN precedent.
 */
export const MENU_GROUP_NAME_GREEN = false;

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ── text metrics (exact for a monospace face) ────────────────────────────────── */

/** Rendered width of `chars` monospace characters at `size` px with `ls` px letter-spacing. */
export function textWidth(chars: number, size: number, ls: number, ratio = MG_MONO_RATIO): number {
  return chars * (ratio * size + ls);
}

/** How many characters fit on one line of `width` px at `size` px (letter-spacing 0). */
export function charsPerLine(width: number, size: number, ratio = MG_MONO_RATIO): number {
  return Math.max(1, Math.floor(width / (ratio * size)));
}

/** Greedy word wrap — the line count a browser produces for `text` in a box `cpl` chars wide.
 *  A single word longer than the line takes as many lines as it needs (browsers overflow rather
 *  than hyphenate, but counting it honestly keeps the budget conservative). */
export function wrapLines(text: string, cpl: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let lines = 1;
  let len = 0;
  for (const w of words) {
    const add = len === 0 ? w.length : len + 1 + w.length;
    if (len > 0 && add > cpl) { lines += 1; len = w.length; } else { len = add; }
    while (len > cpl) { lines += 1; len -= cpl; } // an over-long single word
  }
  return lines;
}

/* ── layout: how the stage divides into rows ──────────────────────────────────── */

export interface MGLayout {
  perPage: number;
  pages: number;
  /** 1 in portrait; 2 in landscape once the list outgrows a single column (TopSellers idiom). */
  cols: number;
  /** Rows per column on this page — the grid's row count and the `last in column` divisor. */
  rowsUsed: number;
  rowH: number;
  gap: number;
  colW: number;
  /** Largest square photo the row allows (0 when no row in the group has a photo). */
  thumb: number;
  /** 1–3 showable rows: caps relax so a short section still fills the screen (NOTE-4). */
  small: boolean;
}

/** Divide the measured stage among the rows. Independent of row CONTENT, so every page of a
 *  paged group gets identical geometry. */
export function mgLayout(
  availH: number, availW: number, count: number, o: Orientation, withPhotos: boolean,
): MGLayout {
  const port = o === "portrait";
  const H = availH > 0 ? availH : (port ? 1620 : 860);
  const W = availW > 0 ? availW : (port ? 984 : 1808);
  const n = Math.max(1, count);
  const small = n <= MG_SMALL_GROUP;

  // Rows that clear the legible floor in ONE column, counting the gaps between them.
  const perCol = Math.max(1, Math.floor((H + 8) / (MG_MIN_ROW[o] + 8)));
  // DECISION (landscape two-column): a landscape stage is barely a third as tall as a portrait
  // one but more than twice as wide, so a long list there runs out of height while acres of width
  // sit idle. Once the list outgrows one column, landscape splits into TWO, column-major — the
  // exact idiom TopSellers already uses for its 10-row landscape board. Portrait is always one
  // column (that IS the menu shape), and a landscape list that fits one column stays one column.
  const cols = !port && n > perCol ? 2 : 1;
  const perPage = Math.min(perCol * cols, n);
  const pages = Math.max(1, Math.ceil(n / perPage));
  // Rows actually drawn per column on this page — a 4-item landscape page is 2×2, not 2 columns
  // of 6 slots with 8 blanks. Rows then divide the FULL stage height, so the page always fills it.
  const rowsUsed = Math.max(1, Math.ceil(perPage / cols));

  const gap = Math.round(clampN((H / rowsUsed) * 0.08, 8, port ? 32 : 22));
  const rowH = (H - (rowsUsed - 1) * gap) / rowsUsed;
  const colW = (W - (cols - 1) * MG_COL_GAP) / cols;

  // "Images as large as possible" (owner) = the full row height, capped so the name column keeps
  // usable width. A small group takes the whole row and a wider share (NOTE-4).
  const thumb = withPhotos
    ? Math.round(Math.min(rowH * (small ? 1 : 0.94), colW * (small ? 0.45 : 0.36)))
    : 0;

  return { perPage, pages, cols, rowsUsed, rowH, gap, colW, thumb, small };
}

/* ── typography: the description-first row budget ─────────────────────────────── */

/** One row's content, in the minimal shape the planner needs (the component formats currency). */
export interface MGRowInput {
  name: string;
  blurb: string | null;
  /** The rendered single price, e.g. "$13" — null when the row prices as pour options or $0. */
  priceText: string | null;
  /** Pour-size options, already formatted, e.g. [{label:"1 OZ", priceText:"$5"}]. */
  options: { label: string; priceText: string }[] | null;
}

export interface MGRowPlan {
  /** The name as rendered — one entry per line (2 only when wrapping renders BIGGER). */
  lines: string[];
  /** Nominal px for this row's name before the renderer's own shrink-to-fit. */
  nameSize: number;
  /** Predicted px AFTER shrink-to-fit — what a guest actually reads. Never below the floor
   *  unless the group is unrenderable at any budget (then the caller has already dropped
   *  descriptions to give the names everything there is). */
  effName: number;
  showBlurb: boolean;
  blurbLines: number;
}

export interface MGType {
  /** False when this slide renders NO descriptions — either the owner turned them off, or
   *  keeping them whole would have pushed a name under its floor. */
  withBlurbs: boolean;
  name: number;
  price: number;
  optPrice: number;
  optLabel: number;
  priceW: number;
  /** 0 when this slide renders no descriptions. */
  blurb: number;
  thumb: number;
  colTextW: number;
  rowGap: number;
  padV: number;
  inner: number;
  rows: MGRowPlan[];
  /** Smallest predicted name px on the slide — the 20-foot-test assertion. */
  minNamePx: number;
  /** Rows whose description could not fit WHOLE and was therefore left out entirely. */
  omitted: number;
}

interface TypeInput {
  layout: MGLayout;
  rows: MGRowInput[];
  o: Orientation;
  showBlurbs: boolean;
  ratio: number;
}

/**
 * The description-first budget (see the module header). Returns the variant actually used:
 * descriptions ON when they fit whole AND every name still clears its floor, otherwise OFF.
 */
export function mgTypography(input: TypeInput): MGType {
  const { rows, o, showBlurbs } = input;
  const anyBlurb = rows.some((r) => !!r.blurb);
  const withBlurbsWanted = showBlurbs && anyBlurb;
  const floor = SUPPORT_TEXT[o];

  const A = withBlurbsWanted ? computeVariant(input, true) : null;
  if (A && A.withBlurbs && A.minNamePx >= floor) return A;
  const B = computeVariant(input, false);
  // Descriptions only lose to names when they'd actually cost legibility. If dropping them buys
  // nothing (a pathologically narrow column), keep them — the guest gets more, not less.
  if (A && A.withBlurbs && A.minNamePx >= B.minNamePx) return A;
  return B;
}

function computeVariant(input: TypeInput, withBlurbs: boolean): MGType {
  const { layout, rows, o, ratio } = input;
  const { rowH, colW, small } = layout;
  const port = o === "portrait";
  const floor = SUPPORT_TEXT[o];
  const rowGap = MG_ROW_GAP[o];

  const padV = Math.round(clampN(rowH * 0.03, 3, 10));
  const usable = rowH - 2 * padV;
  const inner = Math.round(clampN(rowH * 0.05, 6, 16));
  const boost = small ? MG_SMALL_BOOST : 1;
  const cap = Math.round((withBlurbs ? MG_NAME_CAP.dense[o] : MG_NAME_CAP.roomy[o]) * boost);
  const hasOptions = rows.some((r) => !!r.options);
  const priceCap = colW * (hasOptions ? PRICE_W_CAP.options[o] : PRICE_W_CAP.single[o]);
  const maxNameChars = Math.max(1, ...rows.map((r) => r.name.length));
  const nameFloorNeed = textWidth(maxNameChars, floor, NAME_LS, ratio);

  // The three widths depend on each other (price size ← name size ← description lines ← text
  // column ← price width), but the loop is a contraction, not a cycle: four passes from a
  // mid-range seed settle to the px on every real group. No fixed point is required — the last
  // pass is what renders, and each quantity is independently clamped to a legible range.
  let nameFit = Math.floor(clampN(usable * 0.5, floor, cap));
  let price = 0, optPrice = 0, priceW = 0, thumb = layout.thumb, colTextW = colW;
  for (let pass = 0; pass < 4; pass++) {
    price = Math.round(nameFit * 0.92);
    // The pour LABEL ("SHOT", "1 OZ") is a supporting label, so it holds the shared SUPPORT_TEXT
    // floor by rendering at the SAME size as its price and separating on opacity alone — the way
    // the public /menu pairs them.
    optPrice = Math.round(clampN(nameFit * 0.46, floor, port ? 60 : 46));
    const need = Math.max(0, ...rows.map((r) => stripWidth(r, price, optPrice, ratio)));
    priceW = Math.round(Math.min(need > 0 ? need + PRICE_PAD : 0, priceCap));

    // WIDTH CRUNCH ORDER (DECISION): when the row cannot hold photo + name-at-floor + price, the
    // PHOTO gives way first (down to 60% of the row) — a slightly smaller square costs the guest
    // far less than a name they cannot read at 20 feet, and the price strip's labels have their
    // own floor to protect.
    thumb = layout.thumb;
    if (thumb > 0) {
      const room = colW - 2 * rowGap - priceW - nameFloorNeed;
      if (thumb > room) thumb = Math.round(clampN(room, rowH * 0.6, thumb));
    }
    // Last resort: hand back price-column width too, and let FitScale shrink the strip. This is
    // the ONE place a pour label may render under the SUPPORT_TEXT floor, and it is deliberate —
    // an unreadable NAME is a worse slide than a small "1 OZ". It does not fire on any real
    // group (the Rum board's tight strip already leaves the longest name its floor exactly);
    // it exists so the never-below-floor name invariant holds on geometry nobody has authored yet.
    if (priceW > 0) {
      const room = colW - 2 * rowGap - thumb - nameFloorNeed;
      if (priceW > room) priceW = Math.round(clampN(room, priceW * 0.45, priceW));
    }
    colTextW = Math.max(80, colW - (thumb > 0 ? thumb + rowGap : 0) - priceW - rowGap);

    // FLOOR, never round: rounding the name UP by half a pixel eats into the description budget
    // that was just reserved, and a 2-line description then fails its own fit check by 0.1px and
    // gets omitted (caught by test:menugroup — Tiki landscape lost 4 of 7 descriptions to it).
    if (!withBlurbs) {
      nameFit = Math.floor(clampN(usable / LH_NAME, floor, cap));
    } else {
      const linesAtFloor = Math.max(
        1, ...rows.filter((r) => r.blurb).map((r) => wrapLines(r.blurb!, charsPerLine(colTextW, floor, ratio))),
      );
      nameFit = Math.floor(clampN((usable - inner - linesAtFloor * floor * LH_BLURB) / LH_NAME, floor, cap));
    }
  }

  // RECLAIM. The name above was reserved against the LONGEST description in the group. When the
  // row cannot actually afford that many lines (the name hit its floor first), the reservation is
  // dead space: the long descriptions are going to be omitted anyway, so the name should have the
  // room back. Settle the two against each other — at most three passes, each strictly reducing
  // the reserved line count, and only accepted when the resulting budget still affords the lines
  // it was computed for. (Live example: the Rum board's 111px rows reserved two 32px lines for a
  // description that could never fit, pinning every name at the 32px floor; this returns 56px.)
  let name2 = nameFit;
  let budget = withBlurbs ? usable - nameFit * LH_NAME - inner : 0;
  let maxLines = withBlurbs ? Math.floor(budget / (floor * LH_BLURB)) : 0;
  if (withBlurbs) {
    let want = maxLines;
    for (let pass = 0; pass < 3 && want >= 1; pass++) {
      const n = Math.floor(clampN((usable - inner - want * floor * LH_BLURB) / LH_NAME, floor, cap));
      const b = usable - n * LH_NAME - inner;
      const m = Math.floor(b / (floor * LH_BLURB));
      if (m >= want) { name2 = n; budget = b; maxLines = m; break; }
      want = m;
    }
  }
  const name = name2;
  let blurb = 0;
  let effWithBlurbs = withBlurbs && maxLines >= 1;
  if (effWithBlurbs) {
    const kept = rows.filter(
      (r) => r.blurb && wrapLines(r.blurb, charsPerLine(colTextW, floor, ratio)) <= maxLines,
    );
    if (kept.length === 0) {
      effWithBlurbs = false;
    } else {
      blurb = floor;
      for (let s = MG_BLURB_CAP[o]; s > floor; s--) {
        const fits = kept.every(
          (r) => wrapLines(r.blurb!, charsPerLine(colTextW, s, ratio)) * s * LH_BLURB <= budget,
        );
        if (fits) { blurb = s; break; }
      }
    }
  }

  const plans: MGRowPlan[] = rows.map((r) => {
    const lines = effWithBlurbs && r.blurb
      ? wrapLines(r.blurb, charsPerLine(colTextW, blurb, ratio))
      : 0;
    const showBlurb = effWithBlurbs && lines > 0 && lines * blurb * LH_BLURB <= budget;
    const blurbLines = showBlurb ? lines : 0;
    const nameRoom = usable - (showBlurb ? inner + blurbLines * blurb * LH_BLURB : 0);

    // One line, shrunk to fit if need be (what the renderer's FitText will do for real).
    const need1 = textWidth(r.name.length, name, NAME_LS, ratio);
    const eff1 = need1 <= colTextW ? name : (name * colTextW) / need1;

    // TWO lines, when wrapping renders BIGGER than shrinking (cold-review NOTE-1: long landscape
    // names like "Gosling's Black Seal 151 Rum" shrank to 28–32px against a 32px floor). The
    // choice is by predicted rendered px, so it can never make a name smaller.
    let best: MGRowPlan = { lines: [r.name], nameSize: name, effName: eff1, showBlurb, blurbLines };
    const size2 = Math.min(name, nameRoom / (2 * LH_NAME));
    if (size2 >= floor) {
      const two = balanceHeadline(r.name, 2).split("\n");
      if (two.length === 2) {
        const maxc = Math.max(...two.map((l) => l.length));
        const need2 = textWidth(maxc, size2, NAME_LS, ratio);
        const eff2 = need2 <= colTextW ? size2 : (size2 * colTextW) / need2;
        if (eff2 > eff1 + 0.5) {
          best = { lines: two, nameSize: Math.round(size2), effName: eff2, showBlurb, blurbLines };
        }
      }
    }
    return best;
  });

  return {
    withBlurbs: effWithBlurbs,
    name, price, optPrice, optLabel: optPrice, priceW,
    blurb: effWithBlurbs ? blurb : 0,
    thumb, colTextW, rowGap, padV, inner,
    rows: plans,
    minNamePx: Math.min(...plans.map((p) => p.effName)),
    omitted: rows.filter((r, i) => !!r.blurb && !plans[i].showBlurb).length,
  };
}

/**
 * Allocate the next page seed for ONE asset (cold-review WARN-1). A module-global counter
 * stranded pages whenever two menu_group cards shared a slot: card i's seed advanced by k every
 * pass, so a 2-page Rum card sharing a slot with a 3-page Whiskey card could never land on Rum's
 * page 2. Keyed by item id, every card walks its own pages 0,1,2… independently.
 */
export function nextMenuGroupSeq(seen: Map<string, number>, id: string): number {
  const n = seen.get(id) ?? 0;
  seen.set(id, n + 1);
  return n;
}

/** Measure-tight width of a row's price cell — a three-option pour strip needs a real share of
 *  the row, a single "$8" needs almost none (cold-review NOTE-1). */
export function stripWidth(
  r: MGRowInput, price: number, optPrice: number, ratio = MG_MONO_RATIO,
): number {
  if (r.options && r.options.length > 0) {
    let w = 0;
    r.options.forEach((o, i) => {
      if (i > 0) w += MG_OPT_GAP;
      w += textWidth(o.label.length, optPrice, 1, ratio)
        + MG_OPT_LABEL_GAP
        + textWidth(o.priceText.length, optPrice, 0, ratio);
    });
    return w;
  }
  return r.priceText ? textWidth(r.priceText.length, price, 0, ratio) : 0;
}
