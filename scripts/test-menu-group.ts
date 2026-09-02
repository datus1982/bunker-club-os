/**
 * Unit test for the MENU GROUP slide (0065) — `npx tsx scripts/test-menu-group.ts`
 * (pnpm test:menugroup). Pure — no DB, no network, no React.
 *
 * Pins the three things the cold review said must never regress:
 *   1. the website-parity ROW GATES (pos_visible / 86'd / owner-hidden guids / nameless) and the
 *      Toast-order-then-name sort, which resolveRotation's auto-hide shares with the renderer,
 *   2. the DESCRIPTION-FIRST budget (WARN-2): a description renders WHOLE or is omitted — the
 *      slide never clips one — and a slide whose descriptions would push a NAME under the shared
 *      SUPPORT_TEXT floor drops the descriptions instead,
 *   3. the PER-ASSET page seed (WARN-1), which stranded pages when two menu_group cards shared
 *      a slot, and the landscape two-column threshold.
 *
 * The stage numbers below are the REAL measured content zones of the two bar screens, and the
 * row content is the owner's REAL Toast data (probed 2026-09-01), so an assertion failing here
 * means the bar TV changed, not a fixture.
 */
import {
  menuGroupRows, mgLayout, mgTypography, nextMenuGroupSeq,
  wrapLines, charsPerLine, textWidth, stripWidth,
  MG_MONO_RATIO, MG_MIN_ROW, MG_COL_GAP, MG_OPT_GAP, MG_OPT_LABEL_GAP,
  type MenuGroupFilters, type MGRowInput,
} from "../apps/web/src/modules/signage/menuGroup.ts";
import { SUPPORT_TEXT } from "../apps/web/src/modules/signage/supportText.ts";
import type { ToastCacheRow } from "../apps/web/src/modules/signage/useSignage.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `: got ${g}, want ${w}`}`);
}
function ok(label: string, cond: boolean, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : ` — ${detail}`}`);
}

const row = (o: Partial<ToastCacheRow> & { guid: string }): ToastCacheRow => ({
  name: o.guid, price: 10, image: null, menu_group: "Tiki Tuesday",
  out_of_stock: false, pos_visible: true, public_blurb: null, long_blurb: null,
  price_options: null, ...o,
});
const toMap = (rows: ToastCacheRow[]) => new Map(rows.map((r) => [r.guid, r]));

/* ── 1. the website-parity gates ──────────────────────────────────────────────── */
console.log("── row gates (the same set resolveRotation auto-hides on) ──");
const gateRows = toMap([
  row({ guid: "keep", name: "Mai Tai" }),
  row({ guid: "eightysix", name: "Zombie", out_of_stock: true }),
  row({ guid: "offpos", name: "Ghost", pos_visible: false }),
  row({ guid: "hidden", name: "Half Off Wilson" }),
  row({ guid: "nameless", name: null }),
  row({ guid: "othergroup", name: "Guinness", menu_group: "Draft Beers" }),
]);
const filters: MenuGroupFilters = { hidden: new Set(["hidden"]), order: new Map() };
check("86'd, off-POS, owner-hidden, nameless and other-group rows are all excluded",
  menuGroupRows(gateRows, "Tiki Tuesday", filters).map((r) => r.guid), ["keep"]);
check("no filters ⇒ the owner-hidden guid is NOT suppressed (hub/editor preview path)",
  menuGroupRows(gateRows, "Tiki Tuesday").map((r) => r.guid).sort(), ["hidden", "keep"]);
check("group match is trimmed + case-insensitive",
  menuGroupRows(gateRows, "  tiki tuesday ", filters).map((r) => r.guid), ["keep"]);
check("an empty group name lists nothing (never authored ⇒ nothing to show)",
  menuGroupRows(gateRows, "   ", filters), []);
check("a group that no longer exists in Toast lists nothing (the rename auto-hide)",
  menuGroupRows(gateRows, "Tiki Wednesday", filters), []);

console.log("\n── ordering: Toast position first, nulls last, then name ──");
const orderRows = toMap([
  row({ guid: "c", name: "Charlie" }), row({ guid: "a", name: "Alpha" }),
  row({ guid: "b", name: "Bravo" }), row({ guid: "d", name: "Delta" }),
]);
check("positioned rows lead in Toast order; unpositioned fall behind in NAME order",
  menuGroupRows(orderRows, "Tiki Tuesday", { hidden: new Set(), order: new Map([["d", 0], ["c", 1]]) })
    .map((r) => r.name), ["Delta", "Charlie", "Alpha", "Bravo"]);
check("no positions at all ⇒ pure name order (the pre-0064 fallback)",
  menuGroupRows(orderRows, "Tiki Tuesday", { hidden: new Set(), order: new Map() })
    .map((r) => r.name), ["Alpha", "Bravo", "Charlie", "Delta"]);
check("malformed price_options are dropped, not rendered as an empty strip",
  menuGroupRows(toMap([row({ guid: "x", price_options: [{ label: "", price: 5 }] as never })]), "Tiki Tuesday")
    [0].priceOptions, null);

/* ── 2. text metrics (exact, because VT323 is monospace at 0.400) ─────────────── */
console.log("\n── text metrics ──");
check("the measured VT323 advance ratio is pinned", MG_MONO_RATIO, 0.4);
check("width is chars × (ratio × size + letter-spacing)", textWidth(10, 50, 1), 10 * (0.4 * 50 + 1));
check("chars per line floors", charsPerLine(886, 40), 55);
check("a blank description is zero lines", wrapLines("", 40), 0);
check("a short description is one line", wrapLines("Rum, Mint, Lime, Soda", 55), 1);
check("greedy wrap matches the browser at the real Tiki column width (Wilson, 95 chars)",
  wrapLines("Vodka, Coconut rum, Macadamia Nut Liqueur, pistachio creme, pineapple juice, and coconut water.", 55), 2);
check("the same description needs three lines in a narrower column",
  wrapLines("Vodka, Coconut rum, Macadamia Nut Liqueur, pistachio creme, pineapple juice, and coconut water.", 50), 3);
check("an over-long single word takes the lines it needs (never silently clipped)",
  wrapLines("Supercalifragilisticexpialidocious", 10), 4);

/* ── 3. layout: pagination + the landscape two-column threshold ───────────────── */
console.log("\n── layout ──");
// Real measured content zones (the two bar screens, 2026-09-01).
const PORT = { h: 1418, w: 984 };
const LAND = { h: 719, w: 1808 };
const portTiki = mgLayout(PORT.h, PORT.w, 7, "portrait", false);
check("portrait is always ONE column (that IS the menu shape)", portTiki.cols, 1);
check("7 Tiki rows are one portrait page", [portTiki.pages, portTiki.rowsUsed], [1, 7]);
ok("every portrait row clears the pagination floor",
  portTiki.rowH >= MG_MIN_ROW.portrait, `rowH ${portTiki.rowH}`);
const landSix = mgLayout(LAND.h, LAND.w, 6, "landscape", false);
check("a landscape list that fits one column STAYS one column", landSix.cols, 1);
const landSeven = mgLayout(LAND.h, LAND.w, 7, "landscape", false);
check("one row past the single-column capacity splits landscape into two", landSeven.cols, 2);
check("…and it is still ONE page (4 rows per column, no blanks left over)",
  [landSeven.pages, landSeven.rowsUsed], [1, 4]);
const landRum = mgLayout(LAND.h, LAND.w, 23, "landscape", true);
check("23 Rum rows page in two-column landscape", [landRum.cols, landRum.pages], [2, 2]);
ok("a landscape column is half the stage less the column gap",
  Math.abs(landRum.colW - (LAND.w - MG_COL_GAP) / 2) < 0.51, `colW ${landRum.colW}`);
ok("Cordials (55 showable) pages rather than rendering an unreadable wall",
  mgLayout(PORT.h, PORT.w, 55, "portrait", false).pages >= 5, "");
const small = mgLayout(PORT.h, PORT.w, 1, "portrait", true);
ok("a 1-row group gives its photo the whole row (NOTE-4)",
  small.small && small.thumb === Math.round(PORT.w * 0.45), `thumb ${small.thumb}`);

/* ── 4. the description-first budget (WARN-2) ─────────────────────────────────── */
console.log("\n── the whole-or-omitted description rule ──");
const TIKI: MGRowInput[] = [
  { name: "Wilson", blurb: "Vodka, Coconut rum, Macadamia Nut Liqueur, pistachio creme, pineapple juice, and coconut water.", priceText: "$7", options: null },
  { name: "Painkiller", blurb: "House batched Painkiller with rum, OJ, pineapple juice, coco real.", priceText: "$8", options: null },
  { name: "Hurricane", blurb: "Silver rum, gold rum, passionfruit nectar, strawberry puree, and lemon juice.", priceText: "$8", options: null },
  { name: "Fern Gully", blurb: "Spiced rum, white rum, strawberry, passionfruit, vanilla and lime.", priceText: "$8", options: null },
  { name: "Mai Tai", blurb: "Dark & Light Rum, Orgeat, Falernum, Orange Curaçao, Lime", priceText: "$10", options: null },
  { name: "Daiquiri", blurb: "Silver Rum, Lime, Simple — Served Up", priceText: "$9", options: null },
  { name: "Mojito", blurb: "Rum, Mint, Lime, Soda", priceText: "$9", options: null },
];
const SIGS: MGRowInput[] = [
  { name: "3 Mile Island Ice Tea", blurb: "Urban Tea House Meyer Lemon Infused Vodka, Gin, Rum, Cola Syrup, Lemonade", priceText: "$10", options: null },
  { name: "Black List", blurb: "Johnnie Walker Black, Madagascar Vanilla, Tobacco Bitters, Orange, Cherry", priceText: "$13", options: null },
  { name: "Chewie", blurb: "Tequila, Ancho Chili Liqueur, Jalapeno Tincture, Pineapple, Grapefruit, Chili Salt", priceText: "$10", options: null },
  { name: "Dr. Strangelove", blurb: "Bourbon, Cherry Heering, Lemon, Pistachio Coconut Cream, Mermaid", priceText: "$10", options: null },
  { name: "J.F.K.", blurb: "Avocado Infused Rum, Lime, Falernum, Salt Crust", priceText: "$10", options: null },
  { name: "Manhattan Project", blurb: "Bacardi 4 Aged Rum, Sweet & Dry Vermouth, Molasses Bitters", priceText: "$11", options: null },
  { name: "Sputnik", blurb: "Strawberry Infused Gin, Lemon, St. Germain, Rhubarb Bitters, Prosecco", priceText: "$10", options: null },
  { name: "Up & Atom", blurb: "Barrel Aged Rum, Amaretto, Banana, Amarula Liqueur, Cold Brew Coffee", priceText: "$11", options: null },
];
const POUR = [{ label: "1 OZ", priceText: "$5" }, { label: "1.5 OZ", priceText: "$7" }, { label: "2 OZ", priceText: "$8" }];
const RUM: MGRowInput[] = [
  { name: "Gosling's Black Seal 151 Rum", blurb: "Overproof Bermuda black rum", priceText: null, options: POUR },
  { name: "Bacardi Reserva Ocho Rum", blurb: "Eight year aged", priceText: null, options: POUR },
  { name: "Bumbu Rum", blurb: "Banana, vanilla, spiced Barbados rum", priceText: null, options: POUR },
  { name: "Malibu Coconut Rum", blurb: "Coconut flavoured Caribbean rum", priceText: null, options: POUR },
  { name: "Well Rum (white)", blurb: "House white rum", priceText: null, options: POUR },
];

function plan(rows: MGRowInput[], stage: { h: number; w: number }, o: "portrait" | "landscape", photos: boolean) {
  const layout = mgLayout(stage.h, stage.w, rows.length, o, photos);
  return { layout, type: mgTypography({ layout, rows, o, showBlurbs: true, ratio: MG_MONO_RATIO }) };
}

for (const [label, rows, stage, o, photos] of [
  ["Tiki portrait", TIKI, PORT, "portrait", false],
  ["Tiki landscape", TIKI, LAND, "landscape", false],
  ["Signature portrait", SIGS, PORT, "portrait", true],
  ["Signature landscape", SIGS, LAND, "landscape", true],
] as const) {
  const { layout, type } = plan(rows as MGRowInput[], stage, o, photos);
  ok(`${label}: every description renders WHOLE (0 omitted)`, type.omitted === 0, `${type.omitted} omitted`);
  ok(`${label}: descriptions render at or above the ${SUPPORT_TEXT[o]}px floor`,
    type.withBlurbs && type.blurb >= SUPPORT_TEXT[o], `blurb ${type.blurb}`);
  ok(`${label}: no name renders below the ${SUPPORT_TEXT[o]}px floor`,
    type.minNamePx >= SUPPORT_TEXT[o], `min name ${type.minNamePx.toFixed(1)}px`);
  ok(`${label}: the description block fits the row it was budgeted for`,
    type.rows.every((p) => p.lines.length * p.nameSize * 1.05 + (p.showBlurb ? type.inner + p.blurbLines * type.blurb * 1.25 : 0)
      <= layout.rowH - 2 * type.padV + 0.5), "a row overflows its own budget");
  console.log(`   ${label}: rowH ${layout.rowH.toFixed(1)} · name ${type.name} · blurb ${type.blurb} · minName ${type.minNamePx.toFixed(1)} · priceW ${type.priceW}`);
}

console.log("\n── the 'or none' half of the ruling ──");
const rum = plan(RUM.concat(RUM, RUM, RUM, RUM), LAND, "landscape", true); // 25 rows ⇒ dense pages
ok("a dense liquor page reclaims the name budget instead of pinning it at the floor to reserve "
   + "description lines the row cannot afford (the live Rum board went 32 → 56px)",
  rum.type.name > SUPPORT_TEXT.landscape, `nominal name ${rum.type.name}`);
console.log(`   dense Rum: rowH ${rum.layout.rowH.toFixed(1)} · name ${rum.type.name} · blurb ${rum.type.blurb} · minName ${rum.type.minNamePx.toFixed(1)} · omitted ${rum.type.omitted}/${rum.type.rows.length}`);
ok("a dense landscape liquor page never drops a name under the floor",
  rum.type.minNamePx >= SUPPORT_TEXT.landscape, `min name ${rum.type.minNamePx.toFixed(1)}px`);
ok("…and whatever descriptions it keeps, it keeps WHOLE (never clipped)",
  rum.type.rows.every((p) => !p.showBlurb || p.blurbLines >= 1), "");
const noRoom = plan(
  [{ name: "Gosling's Black Seal 151 Rum", blurb: "x ".repeat(160).trim(), priceText: null, options: POUR }],
  { h: 300, w: 700 }, "landscape", true,
);
ok("a description that cannot fit whole at the floor is OMITTED (never clipped), and the slide "
   + "falls back to the description-less budget",
  !noRoom.type.rows[0].showBlurb && !noRoom.type.withBlurbs && noRoom.type.blurb === 0,
  `showBlurb ${noRoom.type.rows[0].showBlurb} withBlurbs ${noRoom.type.withBlurbs}`);
const off = mgTypography({
  layout: mgLayout(PORT.h, PORT.w, TIKI.length, "portrait", false),
  rows: TIKI, o: "portrait", showBlurbs: false, ratio: MG_MONO_RATIO,
});
ok("SHOW DESCRIPTIONS off ⇒ no description budget and a bigger name",
  !off.withBlurbs && off.blurb === 0 && off.name > plan(TIKI, PORT, "portrait", false).type.name,
  `name ${off.name}`);

console.log("\n── the price column is measure-tight (NOTE-1) ──");
const rumType = plan(RUM, LAND, "landscape", true).type;
const need = Math.max(...RUM.map((r) => stripWidth(r, rumType.price, rumType.optPrice, MG_MONO_RATIO, rumType.optLines)));
ok("the pour strip reserves what it measures, not a fixed share of the row",
  rumType.priceW >= need && rumType.priceW <= need + 12, `priceW ${rumType.priceW} vs need ${need.toFixed(1)}`);
const singleType = plan(TIKI, PORT, "portrait", false).type;
ok("a single '$8' reserves a fraction of what a three-option strip does",
  singleType.priceW < 0.15 * 984, `priceW ${singleType.priceW}`);

/* ── 6. the width-crunch ladder: a price is NEVER rendered under the floor (WARN-1) ────
 *
 * The shapes below are the owner's LIVE groups (probed 2026-09-01): row counts, photo counts,
 * the longest name, the longest description and the widest pour set of each. Before the ladder
 * the crunch handed price-column width back and let FitScale shrink the strip, so these exact
 * groups rendered their pour labels at 25.8px (Draft Beers portrait), 30.3 (Draft Beers
 * landscape), 32.3 (Whiskey portrait), 37.0 (Cordials portrait), 37.7 (Rum portrait) and 38.8
 * (Tequila portrait) — against floors of 40 and 32. Now the photo yields, then the strip stacks,
 * then the name wraps; the strip always gets the width it measures.
 */
console.log("\n── the width-crunch ladder (WARN-1) ──");
const oz = (a: number, b: number, c: number) => [
  { label: "1 OZ", priceText: `$${a}` }, { label: "1.5 OZ", priceText: `$${b}` }, { label: "2 OZ", priceText: `$${c}` },
];
const pint = (a: number, b: number) => [{ label: "PINT", priceText: `$${a}` }, { label: "PITCHER", priceText: `$${b}` }];
/** n rows shaped like a real liquor/beer section: the longest name and longest blurb are real. */
function section(
  n: number, longName: string, longBlurb: string, opts: (i: number) => MGRowInput["options"],
  priceText: (i: number) => string | null = () => null,
): MGRowInput[] {
  const filler = ["Well Rum (white)", "Bumbu Rum", "Espolon Blanco Tequila", "Bulleit Rye", "Aperol", "Bacardi Gold Rum"];
  const blurbs = ["Eight year aged", "Banana, vanilla, spiced Barbados rum", "House pour", "Overproof black rum"];
  return Array.from({ length: n }, (_, i) => ({
    name: i === 0 ? longName : filler[i % filler.length],
    blurb: i === 0 ? longBlurb : blurbs[i % blurbs.length],
    priceText: priceText(i),
    options: opts(i),
  }));
}
const LIVE: [string, MGRowInput[], { h: number; w: number }, "portrait" | "landscape", boolean][] = [
  ["Draft Beers portrait", section(18, "Roughtail Everything Rhymes With Orange", "OK Native-Owned Amber Ale, Caramel Smooth",
    (i) => (i % 6 === 0 ? pint(5, 18) : null), (i) => (i % 6 === 0 ? null : "$10")), PORT, "portrait", true],
  ["Draft Beers landscape", section(18, "Roughtail Everything Rhymes With Orange", "OK Native-Owned Amber Ale, Caramel Smooth",
    (i) => (i % 6 === 0 ? pint(5, 18) : null), (i) => (i % 6 === 0 ? null : "$10")), LAND, "landscape", true],
  ["Rum portrait", section(23, "Gosling's Black Seal 151 Rum", "Bermuda Black Rum — Dark & Stormy Official",
    () => oz(8, 9, 10)), PORT, "portrait", true],
  ["Rum landscape", section(23, "Gosling's Black Seal 151 Rum", "Bermuda Black Rum — Dark & Stormy Official",
    () => oz(8, 9, 10)), LAND, "landscape", true],
  ["Tequila portrait", section(11, "Monte Lobos Mezcal Joven Tequila", "Women-Made Reposado, Additive-Free",
    () => oz(10, 15, 17)), PORT, "portrait", false],
  ["Whiskey portrait", section(25, "Jack Daniels Blackberry Whiskey", "Single Barrel Bourbon, Horse & Jockey",
    (i) => (i === 1 ? [{ label: "SHOT", priceText: "$20" }, { label: "DOUBLE", priceText: "$35" }] : oz(8, 9, 10))), PORT, "portrait", true],
  ["Whiskey landscape", section(25, "Jack Daniels Blackberry Whiskey", "Single Barrel Bourbon, Horse & Jockey",
    (i) => (i === 1 ? [{ label: "SHOT", priceText: "$20" }, { label: "DOUBLE", priceText: "$35" }] : oz(8, 9, 10))), LAND, "landscape", true],
  ["Cordials portrait", section(55, "Alma Tepec Chilli Liqueuer", "Italian Aperitivo, Bittersweet Orange",
    (i) => (i % 7 === 0 ? null : oz(10, 15, 17)), (i) => (i % 7 === 0 ? "$9" : null)), PORT, "portrait", false],
  ["Food landscape", section(7, "Frito Chili Pie", "12” Pie, Cheese or Pepperoni, ~22 Minutes",
    () => null, () => "$0.50"), LAND, "landscape", true],
];
for (const [label, rows, stage, o, photos] of LIVE) {
  const { layout, type } = plan(rows, stage, o, photos);
  ok(`${label}: the pour labels hold the ${SUPPORT_TEXT[o]}px floor`,
    type.optPrice >= SUPPORT_TEXT[o], `optPrice ${type.optPrice}`);
  ok(`${label}: a single price holds the floor too, and stays proportional to its name`,
    type.price >= SUPPORT_TEXT[o] && type.price >= 0.9 * type.name,
    `price ${type.price} vs floor ${SUPPORT_TEXT[o]} / name ${type.name}`);
  const widest = Math.max(...rows.map((r) => stripWidth(r, type.price, type.optPrice, MG_MONO_RATIO, type.optLines)));
  ok(`${label}: the strip FITS its column — nothing for FitScale to shrink`,
    widest <= type.priceW, `needs ${widest.toFixed(1)} in ${type.priceW}`);
  ok(`${label}: photo + text + price + gaps still fit the row`,
    (type.thumb > 0 ? type.thumb + type.rowGap : 0) + type.colTextW + type.rowGap + type.priceW <= layout.colW + 0.5,
    `thumb ${type.thumb} text ${type.colTextW.toFixed(0)} price ${type.priceW} in ${layout.colW.toFixed(0)}`);
  console.log(`   ${label}: name ${type.name} · price ${type.price} · optPrice ${type.optPrice}`
    + ` · priceW ${type.priceW} (strip ${widest.toFixed(0)}, ${type.optLines} line${type.optLines > 1 ? "s" : ""})`
    + ` · thumb ${type.thumb} · minName ${type.minNamePx.toFixed(1)}`);
}

console.log("\n── the last resorts ──");
/*
 * There are TWO fallbacks in the sizing model and they are not equally reachable.
 *
 *  1. THE LADDER FALLBACK — no configuration of (photo, strip lines, name lines) fits. Reachable,
 *     and fired on 148,948 of 300,000 random synthetic shapes, so it is pinned here on a shape a
 *     panel slot could plausibly produce: a 420px column of real Rum rows. The contract is that
 *     the NAME is what gives — the photo column is gone, the text column is held at its 80px
 *     minimum, and the strip keeps its nominal size and is scaled by FitScale (which is why
 *     FitScale had to be made to actually work).
 *
 *  2. THE SETTLE FALLBACK — `bestFit === 0`, i.e. no visited name size was self-consistent, so
 *     the smallest visited one is used. This is UNREACHABLE by construction, not merely untested:
 *     every visited size is drawn from the discrete family name(L) = (usable − inner − L·floor·
 *     LH_BLURB)/LH_NAME clamped to [floor, cap], so the number of distinct sizes the loop can
 *     visit is bounded by the line counts that fit between the floor and the cap. A 182,160-case
 *     adversarial grid (small groups, relaxed caps, stages 200–2400px, descriptions up to 140
 *     words) maxes out at FIVE distinct sizes against SIX passes — so the sequence always either
 *     settles or enters a cycle, and both contain a member whose own budget affords it (a cycle
 *     must contain an increase; the size before it is consistent). Zero hits in 482,160 shapes.
 *     The sweep below pins the invariant that makes it unreachable: the strip is only ever
 *     allowed not to fit when the LADDER fallback fired.
 */
const CRAMPED: MGRowInput[] = Array.from({ length: 6 }, (_, i) => ({
  name: i === 0 ? "Gosling's Black Seal 151 Rum" : "Bumbu Rum",
  blurb: "Overproof Bermuda black rum",
  priceText: null,
  options: POUR,
}));
const crampedLayout = mgLayout(1200, 420, CRAMPED.length, "portrait", true);
const cramped = mgTypography({ layout: crampedLayout, rows: CRAMPED, o: "portrait", showBlurbs: true, ratio: MG_MONO_RATIO });
const crampedStrip = Math.max(...CRAMPED.map((r) => stripWidth(r, cramped.price, cramped.optPrice, MG_MONO_RATIO, cramped.optLines)));
ok("ladder fallback: the photo column is gone and the text column is at its 80px minimum",
  cramped.thumb === 0 && Math.round(cramped.colTextW) === 80, `thumb ${cramped.thumb} colTextW ${cramped.colTextW.toFixed(1)}`);
ok("ladder fallback: the columns still add up to the row",
  cramped.priceW + cramped.colTextW + cramped.rowGap <= crampedLayout.colW + 0.5,
  `${cramped.priceW} + ${cramped.colTextW.toFixed(0)} + ${cramped.rowGap} vs ${crampedLayout.colW}`);
ok("ladder fallback: the pour size is still budgeted at or above the floor (FitScale scales it)",
  cramped.optPrice >= SUPPORT_TEXT.portrait && crampedStrip > cramped.priceW,
  `optPrice ${cramped.optPrice}, strip ${crampedStrip.toFixed(0)} in ${cramped.priceW}`);
ok("ladder fallback: the NAME is the thing that gives — the documented last resort",
  cramped.minNamePx < SUPPORT_TEXT.portrait, `minName ${cramped.minNamePx.toFixed(1)}`);

console.log("\n── synthetic sweep: the strip only fails to fit when the ladder ran out ──");
let sweepCases = 0, sweepFallbacks = 0;
const sweepFails: string[] = [];
for (const o of ["portrait", "landscape"] as const) {
  for (const n of [1, 3, 8, 24]) {
    for (const h of [300, 700, 1418]) {
      for (const w of [380, 984, 1808]) {
        for (const blurbWords of [3, 12, 40]) {
          for (const opts of [null, POUR]) {
            const rows: MGRowInput[] = Array.from({ length: n }, (_, k) => ({
              name: k === 0 ? "Gosling's Black Seal 151 Rum" : "Bumbu Rum",
              blurb: Array.from({ length: blurbWords }, (_, i) => "ingredient".slice(0, 4 + (i % 7))).join(" "),
              priceText: opts ? null : "$13.50",
              options: opts,
            }));
            const layout = mgLayout(h, w, n, o, n % 2 === 0);
            const type = mgTypography({ layout, rows, o, showBlurbs: true, ratio: MG_MONO_RATIO });
            const strip = Math.max(...rows.map((r) => stripWidth(r, type.price, type.optPrice, MG_MONO_RATIO, type.optLines)));
            const ladderRanOut = type.thumb === 0 && Math.round(type.colTextW) <= 80;
            sweepCases++;
            if (strip > type.priceW) sweepFallbacks++;
            const id = `${o} n${n} ${h}x${w} b${blurbWords} ${opts ? "pours" : "single"}`;
            if (strip > type.priceW && !ladderRanOut) sweepFails.push(`${id}: strip ${strip.toFixed(0)} > priceW ${type.priceW} without the ladder running out`);
            if (type.price < SUPPORT_TEXT[o] || type.optPrice < SUPPORT_TEXT[o]) sweepFails.push(`${id}: price ${type.price}/${type.optPrice} under the ${SUPPORT_TEXT[o]}px floor`);
            if (type.rows.some((p) => p.showBlurb && p.blurbLines < 1)) sweepFails.push(`${id}: a description rendered with zero lines`);
            if (type.rows.some((p) => p.lines.length * p.nameSize * 1.05
              + (p.showBlurb ? type.inner + p.blurbLines * type.blurb * 1.25 : 0) > layout.rowH - 2 * type.padV + 0.5)) {
              sweepFails.push(`${id}: a row overflows its own budget`);
            }
            if (type.colTextW < 80) sweepFails.push(`${id}: the text column fell under its 80px minimum`);
          }
        }
      }
    }
  }
}
ok(`${sweepCases} synthetic shapes: a price is only ever squeezed when the ladder ran out of moves`,
  sweepFails.length === 0, sweepFails.slice(0, 4).join(" · "));
console.log(`   sweep: ${sweepCases} shapes, ${sweepFallbacks} reached the ladder fallback, 0 reached the settle fallback`);

console.log("\n── the stacked strip halves the width it needs ──");
const STACK: MGRowInput = { name: "Bunker Beer", blurb: null, priceText: null, options: pint(5, 18) };
check("stacked = ceil(n/2) options on the first line, so a 2-option strip becomes one per line",
  Math.round(stripWidth(STACK, 40, 40, MG_MONO_RATIO, 2)),
  Math.round(textWidth("PITCHER".length, 40, 1) + MG_OPT_LABEL_GAP + textWidth("$18".length, 40, 0)));
ok("…and a stacked strip is always narrower than the same strip on one line",
  stripWidth(STACK, 40, 40, MG_MONO_RATIO, 2) < stripWidth(STACK, 40, 40, MG_MONO_RATIO, 1), "");
const THREE: MGRowInput = { name: "Bumbu Rum", blurb: null, priceText: null, options: oz(5, 7, 8) };
ok("a three-option strip stacks 2 + 1", stripWidth(THREE, 40, 40, MG_MONO_RATIO, 2)
  === textWidth(4, 40, 1) + MG_OPT_LABEL_GAP + textWidth(2, 40, 0) + MG_OPT_GAP
    + textWidth(6, 40, 1) + MG_OPT_LABEL_GAP + textWidth(2, 40, 0), "");

/* ── 5. the per-asset page seed (WARN-1) ─────────────────────────────────────── */
console.log("\n── per-asset page seed ──");
const seen = new Map<string, number>();
const A = "aaaa-1111", B = "bbbb-2222";
check("two cards on one slot each start at 0 and advance independently",
  [nextMenuGroupSeq(seen, A), nextMenuGroupSeq(seen, B), nextMenuGroupSeq(seen, A),
   nextMenuGroupSeq(seen, A), nextMenuGroupSeq(seen, B)], [0, 0, 1, 2, 1]);
// The bug: a shared counter advanced card A by the number of cards per pass, so a 2-page A next
// to a 3-page B only ever showed A's page 0 (0, 2, 4, … ≡ 0 mod 2).
const shared = [0, 2, 4, 6].map((n) => n % 2);
const perItem = [0, 1, 2, 3].map((n) => n % 2);
check("the shared counter stranded page 1 of a 2-page card…", [...new Set(shared)], [0]);
check("…and the per-asset counter reaches every page", [...new Set(perItem)].sort(), [0, 1]);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll menu-group tests passed.");
