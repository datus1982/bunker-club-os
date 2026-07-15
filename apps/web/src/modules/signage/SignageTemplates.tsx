import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Orientation, SignageItem, ToastCacheRow } from "./useSignage";
import { EventWindowCard, EventMessageCard, EventTeaseCard } from "./EventStages";
import { balanceHeadline } from "./eventStage";
import { parseInline, RichText, alignOf } from "./richText";
import { useDrinksBoard, useSalesCache, useSalesHistory, useMenuGroups, overallTopSellers, groupGuidByName, groupTopSellers, OVERALL_GROUP, itemNameFont, type DrinkItem, type HistorySum } from "@/modules/leaderboard/useDrinks";
import { QRCodeSVG } from "qrcode.react";
import { useInstagramFeed } from "./useInstagram";

/**
 * Signage template components (docs/09). Each renders one item inside the slot's
 * content zone at the fixed canvas. Two size profiles (portrait / landscape) keep
 * the same design language legible in both aspects. Photo treatments: VIEWPORT
 * (full colour in an OPTICAL FEED window) / PHOSPHOR (ink-tinted) via `fields.photo_treatment`.
 *
 * Live-sourced values (Toast name/price/photo when `source_toast_guid` is set)
 * render in GREEN ink even in amber mode — docs/09 color-state: green = live feed.
 */

type Sz = {
  eyebrow: number; stamp: number; big: number; mid: number; body: number;
  price: number; priceSmall: number; photoH: number; pad: number; gap: number;
};

const SIZES: Record<Orientation, Sz> = {
  portrait: { eyebrow: 28, stamp: 26, big: 150, mid: 84, body: 44, price: 210, priceSmall: 78, photoH: 620, pad: 64, gap: 28 },
  landscape: { eyebrow: 24, stamp: 24, big: 116, mid: 68, body: 38, price: 168, priceSmall: 62, photoH: 440, pad: 56, gap: 22 },
};

/**
 * Headline auto-shrink (docs/signage-redesign view 2 "20-foot test": titles ~9%/line).
 * Sizes off the longest \n-line so a short hero fills the screen and a long one still fits.
 */
function headlineFontByLen(maxLine: number, o: Orientation): number {
  const p = maxLine <= 6 ? 200 : maxLine <= 9 ? 168 : maxLine <= 12 ? 140 : maxLine <= 16 ? 116 : maxLine <= 22 ? 92 : 76;
  return o === "portrait" ? p : Math.round(p * 0.72);
}
function headlineFont(text: string, o: Orientation): number {
  return headlineFontByLen(Math.max(1, ...text.split("\n").map((l) => l.trim().length)), o);
}
/** Font-aware balance (owner note 2026-07-14, shared rule with EventStages): extra
 *  headline lines must render BIGGER to win — no more one-word-per-line stacks. */
function balanceHero(text: string, o: Orientation): string {
  return balanceHeadline(text, 3, (len) => headlineFontByLen(len, o));
}

/* ── DRINK PROMO sizing (view 1, amended 2026-07-14) — vertical stack: name slightly
   smaller, price directly under it slightly smaller, tagline below both (owner note).
   Takes the longest LINE length (callers balance multi-word names first). */
function drinkNameFont(maxLineLen: number, o: Orientation): number {
  const n = maxLineLen;
  const p = n <= 7 ? 188 : n <= 11 ? 158 : n <= 15 ? 132 : n <= 20 ? 106 : n <= 26 ? 86 : 72;
  return o === "portrait" ? p : Math.round(p * 0.86);
}
function drinkPriceFont(price: number, o: Orientation): number {
  const len = formatPrice(price).length;
  const p = len <= 2 ? 255 : len <= 4 ? 198 : 158;
  return o === "portrait" ? p : Math.round(p * 0.84);
}
/* Script flourish sizing (owner note 2026-07-14: "the tag line is wrapping too quickly").
   Length-aware step-down so a long tagline SHRINKS to stay on one line instead of wrapping;
   short taglines keep the big cursive. Paired with a wider maxWidth (88–90%). The cursive
   face + −4° rotation makes width hard to predict, so the pinned category (below) absorbs any
   residual wrap without the whole stack jittering. */
function flourishFont(text: string, o: Orientation): number {
  const n = text.trim().length;
  const p = n <= 14 ? 96 : n <= 22 ? 82 : n <= 32 ? 68 : n <= 44 ? 56 : 48;
  return o === "portrait" ? p : Math.round(p * 0.9);
}

function s(fields: Record<string, unknown>, key: string): string | undefined {
  const v = fields[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function n(fields: Record<string, unknown>, key: string): number | undefined {
  const v = fields[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

/* ── Photo viewport ─────────────────────────────────────────────────────────── */
function Photo({
  src, treatment, height, feed = "OPTICAL FEED — LIVE",
}: { src: string | undefined; treatment: string; height: number; feed?: string }) {
  if (!src) return null;
  const cls = treatment === "phosphor" ? "sig-viewport sig-phosphor" : "sig-viewport";
  return (
    <div className={cls} style={{ height, width: "100%", flexShrink: 0 }}>
      <span className="sig-feedcap" style={{ fontSize: 20 }}>{feed}</span>
      <img src={src} alt="" />
    </div>
  );
}

function Eyebrow({ text, size }: { text: string; size: number }) {
  return <div style={{ fontSize: size, letterSpacing: 6, opacity: 0.7 }}>{text}</div>;
}

function Stamp({ text, size }: { text: string; size: number }) {
  return (
    <div style={{
      position: "absolute", top: 24, right: 24, border: "3px solid var(--terminal-green)",
      fontSize: size, letterSpacing: 3, padding: "6px 14px", transform: "rotate(6deg)", opacity: 0.85,
    }}>{text}</div>
  );
}

/* ── DRINK SPECIAL (docs/signage-redesign view 1 / 4) ───────────────────────────
 * Anatomy: ingredients strip pinned top · SQUARE Toast photo (matches Toast's crop) ·
 * giant auto-shrink name · HUGE green live price co-equal with the name · optional
 * cream script flourish (only from fields — never invented) · category tag + venue mark.
 * Portrait = stacked; landscape = square photo left / text right. Live-sourced name/price
 * render green (docs/09 color-state). 86'd / off-POS items never reach here (resolveRotation
 * auto-hides the whole item), so the price-hide gate is upstream — behavior unchanged.
 */
export function DrinkSpecial({ item, toast, orientation }: TemplateProps) {
  const guid = s(item.fields, "source_toast_guid");
  const src = guid ? toast.get(guid) : undefined;

  // Manual field overrides win; otherwise fall back to the Toast mirror. A value that
  // resolves FROM Toast (no manual override) is "live" → green.
  const manualName = s(item.fields, "name");
  const name = (manualName ?? src?.name ?? "SPECIAL").toUpperCase();
  const nameLive = !manualName && !!src?.name;

  const manualPrice = n(item.fields, "price");
  const price = manualPrice ?? src?.price ?? undefined;
  const priceLive = manualPrice === undefined && src?.price != null;

  const photo = s(item.fields, "image_url") ?? src?.image ?? undefined;
  // Ingredients / blurb strip: manual override, else the description-safe public blurb.
  const ingredients = s(item.fields, "ingredients") ?? s(item.fields, "tagline") ?? s(item.fields, "blurb") ?? src?.public_blurb ?? undefined;
  // Script flourish is authored-only (skip when absent — never invent copy).
  const flourish = s(item.fields, "flourish");
  // Category tag: authored, else the Toast menu group (e.g. "Signature Cocktails").
  const category = s(item.fields, "category") ?? src?.menu_group ?? undefined;

  const port = orientation === "portrait";
  // Name layout (owner note 2026-07-14: a 2-line name pushed the stack off-screen):
  // pick single-line vs balanced by EFFECTIVE size — multi-line layouts pay a
  // line-count discount (×0.7 / ×0.55) so the whole stack stays on the canvas, and
  // whichever variant yields the LARGER per-line font wins (ties → fewer lines).
  // "BLACK LIST": 1 line @158 beats 2 lines @188×0.7=132 → stays one line.
  // "MANHATTAN PROJECT": 2 lines @168×0.7=118 beats 1 line @106 → still stacks.
  const lineMult = (lines: number) => (lines <= 1 ? 1 : lines === 2 ? 0.7 : 0.55);
  const effective = (text: string) => {
    const lines = text.split("\n");
    const raw = drinkNameFont(Math.max(...lines.map((l) => l.length)), orientation);
    return Math.round(raw * lineMult(lines.length));
  };
  // Authored \n breaks are respected verbatim (balanceHeadline already does); the
  // single-line candidate only competes for unauthored names.
  const balanced = balanceHeadline(name);
  const balName = name.includes("\n")
    ? balanced
    : effective(name) >= effective(balanced) ? name : balanced;
  const nameLines = balName.split("\n").length;
  const nameSize = effective(balName);
  const priceSize = drinkPriceFont(price ?? 0, orientation);

  // NB: the live-green class goes on the SAME element that carries the font-size — the
  // global `.terminal-theme span{font-size:1.5rem}` rule clamps any nested wrapper that
  // lacks its own size, so an inner <Live> span would shrink the name/price to 24px.
  const nameEl = (
    <div className={nameLive ? "sig-live" : undefined} style={{ fontSize: nameSize, fontWeight: 700, lineHeight: 0.9, letterSpacing: 1, textShadow: "0 0 16px var(--terminal-glow)", textAlign: port ? "center" : "left" }}>
      {balName.split("\n").map((l, i) => <span key={i} style={{ display: "block", fontSize: "inherit" }}>{l}</span>)}
    </div>
  );

  const priceEl = price != null && (
    <div className={priceLive ? "sig-live" : undefined} style={{ fontSize: priceSize, fontWeight: 700, lineHeight: 0.78, textShadow: "0 0 26px var(--terminal-glow)" }}>
      <small style={{ fontSize: priceSize * 0.5, verticalAlign: "top" }}>$</small>{formatPrice(price)}
    </div>
  );

  const flourishEl = flourish && (
    <div className="sig-cream sig-flourish" style={{ fontSize: flourishFont(flourish, orientation), maxWidth: port ? "90%" : "88%", textAlign: port ? "center" : "left", textShadow: "0 0 12px var(--terminal-glow)" }}>
      {flourish}
    </div>
  );

  const square = <DrinkSquare src={photo} orientation={orientation} />;

  const ingredientsEl = ingredients && (
    <div className="sig-ingr" style={{ fontSize: port ? 30 : 28, ...(port ? {} : { textAlign: "left", borderBottom: "none", paddingBottom: 10, letterSpacing: 4 }) }}>
      {ingredients}
    </div>
  );

  // Owner note 2026-07-14: the venue mark bottom-right was redundant (the screen chrome
  // already carries the roundel + venue name) — the CATEGORY owns the bottom line now,
  // larger and centered. (This also retires the old mockup "OKLAHOMA CITY" sub-line
  // DECISION that rode on the removed venue mark.)
  // Owner note (demo beats 1): the category must sit at a STABLE distance from the canvas
  // bottom on every drink slide. Previously it lived INSIDE the centering stack with
  // marginTop:auto, so a taller stack (2-line name, a wrapped flourish) overflowed and the
  // category floated up — visibly varying between drinks. It is now a bottom-anchored SIBLING
  // of the stack (outside the flex:1 middle), so its position is fixed regardless of stack height.
  // Owner beat 2026-07-14: nudge the category ~40px LOWER (portrait 171→~130 canvas-px from the
  // canvas bottom, landscape proportional ~115). The row stays a bottom-anchored SIBLING of the
  // stack (the demo-beats stability property holds — its position doesn't move with stack
  // height); a negative marginBottom just lets it ride down INTO the content zone's own bottom
  // padding without touching that padding globally (other templates keep it).
  const catrow = category && (
    <div style={{ flexShrink: 0, paddingTop: 10, marginBottom: port ? -40 : -34, width: "100%", textAlign: "center" }}>
      <span style={{ fontSize: port ? 48 : 42, letterSpacing: 6, opacity: 0.75, textShadow: "0 0 8px var(--terminal-glow)" }}>
        ◆ {category.toUpperCase()} ◆
      </span>
    </div>
  );

  if (port) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 18 }}>
        {ingredientsEl}
        {/* The drink stack fills the space between the ingredients strip and the pinned
            category; minHeight:0 lets it absorb overflow without moving the category. */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          {/* Owner design-beat: images ~30% larger (720 → 940) — but a stacked 2+ line
              name needs the vertical room back, so the photo yields a step (940 → 820)
              to keep the whole stack on the canvas (owner note 2026-07-14). */}
          <div style={{ width: nameLines > 1 ? "min(820px, 100%)" : "min(940px, 100%)", flexShrink: 0 }}>{square}</div>
          {/* Owner note 2026-07-14: vertical stack — name, price directly under, tagline below both. */}
          <div style={{ marginTop: 4 }}>{nameEl}</div>
          {priceEl}
          {flourishEl}
        </div>
        {catrow}
      </div>
    );
  }

  // Landscape: square photo left, text column right (view 4).
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "row", gap: 44, alignItems: "stretch" }}>
      <div style={{ flexShrink: 0, height: "100%", display: "flex" }}>
        <div style={{ height: "100%" }}>{square}</div>
      </div>
      {/* Right column: the text stack CENTERS in the middle, the category is pinned to the
          column's bottom (aligned with the square's bottom via the stretched row). */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 18 }}>
          {ingredientsEl}
          {nameEl}
          {priceEl}
          {flourishEl}
        </div>
        {catrow}
      </div>
    </div>
  );
}

/** Square 1:1 photo (Toast crop) or the labelled placeholder box (view 1). Portrait sizes
 *  by width; landscape fills the row height. Feed cap is green — a live optical feed. */
function DrinkSquare({ src, orientation }: { src: string | undefined; orientation: Orientation }) {
  const sizing: CSSProperties = orientation === "portrait" ? { width: "100%" } : { height: "100%", width: "auto" };
  if (!src) {
    return (
      <div className="sig-sq sig-sq-ph" style={sizing}>
        <div>
          <div style={{ fontSize: orientation === "portrait" ? 52 : 44, fontWeight: 700, letterSpacing: 2, opacity: 0.5 }}>TOAST PHOTO</div>
          <div style={{ fontSize: 24, letterSpacing: 4, opacity: 0.45, marginTop: 6 }}>SQUARE · 1:1</div>
        </div>
      </div>
    );
  }
  return (
    <div className="sig-viewport sig-sq" style={sizing}>
      <span className="sig-feedcap sig-live" style={{ fontSize: 22 }}>◉ OPTICAL FEED — LIVE</span>
      <img src={src} alt="" />
    </div>
  );
}

/* ── EVENT ──────────────────────────────────────────────────────────────────── */
export function EventItem({ item, orientation }: TemplateProps) {
  const z = SIZES[orientation];
  const title = balanceHero(s(item.fields, "title") ?? "UPCOMING EVENT", orientation);
  const blurb = s(item.fields, "blurb");
  const photo = s(item.fields, "image_url");
  const treatment = s(item.fields, "photo_treatment") ?? "viewport";
  const when = eventDate(s(item.fields, "date"), s(item.fields, "time"));

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative", gap: z.gap }}>
      <Stamp text="MANDATORY FUN" size={z.stamp} />
      <Eyebrow text="UPCOMING PROTOCOL" size={z.eyebrow} />
      <div style={{ fontSize: headlineFont(title, orientation), fontWeight: 700, lineHeight: 0.92, textTransform: "uppercase", textShadow: "0 0 16px var(--terminal-glow)", textAlign: alignOf(item.fields, "left") }}>
        {title.split("\n").map((l, i) => <span key={i} style={{ display: "block", fontSize: "inherit" }}>{parseInline(l)}</span>)}
      </div>
      <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
        {when.day && (
          <div style={{ border: "2px solid var(--terminal-green)", padding: "14px 22px", textAlign: "center", flexShrink: 0 }}>
            <div style={{ fontSize: z.eyebrow, letterSpacing: 3, opacity: 0.7 }}>{when.dow}</div>
            <div style={{ fontSize: z.mid * 1.2, fontWeight: 700, lineHeight: 1 }}>{when.day}</div>
          </div>
        )}
        <div style={{ textAlign: alignOf(item.fields, "left") }}>
          {when.time && <div style={{ fontSize: z.mid, fontWeight: 700, lineHeight: 1.05 }}>{when.time}</div>}
          {blurb && <div style={{ fontSize: z.body, opacity: 0.85, lineHeight: 1.45, marginTop: 8 }}><RichText text={blurb} /></div>}
        </div>
      </div>
      {/* Owner design-beat: event photo ~30% larger (0.7 → 0.9). */}
      {photo && <Photo src={photo} treatment={treatment} height={z.photoH * 0.9} feed="ARCHIVE FEED" />}
    </div>
  );
}

/* ── ANNOUNCEMENT (typewriter once, then idle) ──────────────────────────────── */
export function Announcement({ item, orientation }: TemplateProps) {
  const z = SIZES[orientation];
  const msg = s(item.fields, "text") ?? s(item.fields, "message") ?? "SYSTEM ONLINE.";
  const typed = useTypewriter(msg);
  const priority = (s(item.fields, "priority") ?? "LOW").toUpperCase();
  const photo = s(item.fields, "image_url");
  const treatment = s(item.fields, "photo_treatment") ?? "viewport";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: z.gap }}>
      <Eyebrow text={`SYSTEM BULLETIN — PRIORITY ${priority}`} size={z.eyebrow} />
      <div className="sig-cursor" style={{ fontSize: Math.min(z.mid + 14, headlineFont(msg, orientation)), fontWeight: 700, lineHeight: 1.25, whiteSpace: "pre-wrap", textShadow: "0 0 14px var(--terminal-glow)", textAlign: alignOf(item.fields, "left") }}>
        {parseInline(typed)}
      </div>
      {/* Owner design-beat: announcement photo ~30% larger (0.55 → 0.72). */}
      {photo && <Photo src={photo} treatment={treatment} height={z.photoH * 0.72} feed="ARCHIVE FEED" />}
    </div>
  );
}

/* ── IMAGE ONLY (letterboxed) ───────────────────────────────────────────────── */
export function ImageOnly({ item, orientation }: TemplateProps) {
  const z = SIZES[orientation];
  const photo = s(item.fields, "image_url");
  const treatment = s(item.fields, "photo_treatment") ?? "viewport";
  const caption = s(item.fields, "caption");
  // Owner design-beat "images bigger": the viewport is already flex:1 + object-fit:contain,
  // so it fills all leftover space — give it MORE by tightening the surrounding chrome
  // (smaller eyebrow, half the gap) so the letterboxed image region grows.
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: Math.round(z.gap * 0.5) }}>
      <Eyebrow text="ARCHIVE FEED" size={Math.round(z.eyebrow * 0.85)} />
      <div className={treatment === "phosphor" ? "sig-viewport sig-phosphor" : "sig-viewport"} style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="sig-feedcap" style={{ fontSize: 20 }}>OPTICAL FEED 02 — ARCHIVE</span>
        {photo && <img src={photo} alt="" style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", objectFit: "contain" }} />}
      </div>
      {caption && <div style={{ fontSize: z.body, opacity: 0.8, lineHeight: 1.4 }}>{caption}</div>}
    </div>
  );
}

/* ── CELEBRATION (DWELLER RECOGNITION PROTOCOL) ─────────────────────────────── */
const CELEBRATIONS: Record<string, { icon: string; occasion: string; line: string }> = {
  birthday: { icon: "✸", occasion: "BIRTHDAY DETONATION", line: "ANOTHER TRIP AROUND THE REACTOR" },
  bachelor: { icon: "☢", occasion: "BACHELOR PROTOCOL", line: "LAST NIGHT AS A FREE AGENT" },
  bachelorette: { icon: "☢", occasion: "BACHELORETTE PROTOCOL", line: "LAST NIGHT AS A FREE AGENT" },
  anniversary: { icon: "❖", occasion: "ANNIVERSARY MILESTONE", line: "STILL FALLOUT-PROOF TOGETHER" },
  congrats: { icon: "★", occasion: "COMMENDATION", line: "THE SHELTER SALUTES YOU" },
};

export function Celebration({ item, orientation }: TemplateProps) {
  const z = SIZES[orientation];
  const skin = (s(item.fields, "skin") ?? "congrats").toLowerCase();
  const c = CELEBRATIONS[skin] ?? CELEBRATIONS.congrats;
  const honoree = s(item.fields, "honoree") ?? s(item.fields, "name") ?? "DWELLER";
  const occasionLine = s(item.fields, "occasion") ?? c.line;
  const message = s(item.fields, "message");
  const photo = s(item.fields, "image_url");

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: z.gap }}>
      <Eyebrow text="DWELLER RECOGNITION PROTOCOL" size={z.eyebrow} />
      <div style={{ fontSize: z.mid, letterSpacing: 3 }}>{c.icon} {c.occasion} {c.icon}</div>
      {photo && (
        /* Owner design-beat: DWELLER ID square ~30% larger (0.9 → 1.17). */
        <div className="sig-viewport" style={{ width: z.photoH * 1.17, height: z.photoH * 1.17, borderRadius: 0 }}>
          <span className="sig-feedcap" style={{ fontSize: 18 }}>DWELLER ID</span>
          <img src={photo} alt="" />
        </div>
      )}
      <div style={{ fontSize: headlineFont(balanceHero(honoree, orientation), orientation), fontWeight: 700, lineHeight: 0.92, textTransform: "uppercase", textShadow: "0 0 20px var(--terminal-glow)" }}>
        {balanceHero(honoree, orientation).split("\n").map((l, i) => <span key={i} style={{ display: "block", fontSize: "inherit" }}>{l}</span>)}
      </div>
      <div style={{ fontSize: z.mid * 0.7, opacity: 0.85 }}>{occasionLine}</div>
      {message && <div style={{ fontSize: z.body, opacity: 0.8, maxWidth: "80%", lineHeight: 1.4, textAlign: alignOf(item.fields) }}><RichText text={message} /></div>}
    </div>
  );
}

/* ── TOP SELLERS (live sales leaderboard as ONE rotation slide) ─────────────── */
/**
 * The top sellers rendered as a single rotation slide (Phase 8 ROTATION UNIFICATION —
 * docs/signage-redesign-mockup.html views 3/4). Live realtime reader of sales_cache via the
 * SHARED leaderboard hook — the same source, POS gate, and name auto-shrink the /drinks board
 * uses. Distance-first: each row is rank · name · count · a proportional bar (bar #1 = 100%,
 * the rest relative to the bucket's leader). No sub-30s polling (realtime only).
 *
 * Demo-beats-1 owner notes:
 *  • TOP TEN — renders up to 10 rows. toast-sync now caches MAIN_MENU_ALL at top-10 (the
 *    smart-slides branch made that sync change), so the OVERALL bucket shows a full 10;
 *    per-group buckets stay top-5. The row metrics shrink (tsSizes) past 6 rows to fit.
 *  • ROTATE the bucket — the slide walks [overall, then each menu group present in the cache].
 *    Owner beat 2026-07-14 ("40s dwell set to rotate every 10 but it stays on the same
 *    listing"): it now CYCLES intra-dwell — one bucket every `fields.cycle_seconds` (default
 *    10, min 5) via a finite re-armed one-shot timeout (the Instagram-card A1 pattern: no
 *    interval, no infinite animation, cleared on unmount). The START bucket is a
 *    session-monotonic counter (topSellersSeq) so consecutive passes begin on DIFFERENT lists
 *    — the old floor(now/period)%n time-bucket could alias to the same list every pass (the
 *    literal bug the owner saw). `fields.rotate_groups` default true; false = overall only.
 *  • MORE GREEN — drink names + counts render in live green (sig-live: docs/09 green = live
 *    feed); ranks, bars, the group title and the SOLD label stay ambient amber. Not a wall.
 */
type TSz = { header: number; sub: number; rank: number; count: number; countLabel: number; barH: number; rowGap: number; nameScale: number };
const TS_SIZES: Record<Orientation, TSz> = {
  portrait: { header: 92, sub: 30, rank: 60, count: 66, countLabel: 26, barH: 28, rowGap: 22, nameScale: 1 },
  landscape: { header: 70, sub: 24, rank: 46, count: 52, countLabel: 22, barH: 20, rowGap: 14, nameScale: 0.74 },
};
/** Shrink the row metrics when a bucket runs long (7–10 rows) so a full top-10 stays on the
 *  fixed canvas. ≤6 rows keep the base (today's 5-deep buckets look unchanged). */
function tsSizes(o: Orientation, count: number): TSz {
  const z = TS_SIZES[o];
  if (count <= 6) return z;
  return {
    ...z,
    rank: Math.round(z.rank * 0.72),
    count: Math.round(z.count * 0.72),
    countLabel: Math.round(z.countLabel * 0.85),
    barH: Math.round(z.barH * 0.6),
    rowGap: Math.round(z.rowGap * 0.55),
    nameScale: z.nameScale * (o === "portrait" ? 0.7 : 0.82),
  };
}

interface TopBucket { key: string; title: string; items: DrinkItem[] }

/** Session-monotonic seed shared by every TopSellers mount: each mount takes the next value as
 *  its STARTING bucket, so consecutive passes begin on DIFFERENT lists. Replaces the old
 *  floor(now/period)%n time-bucket, which could alias to the same list every pass when the
 *  rotation cycle length lined up with the bucket period (owner: "stays on the same listing").
 *  Resets on the nightly page reload — fine, it's session-scoped. */
let topSellersSeq = 0;

export function TopSellers({ item, orientation }: TemplateProps) {
  const { groups, sales, loading } = useDrinksBoard();
  // Default true — rotate through overall + each group; false pins to overall only (old behavior).
  const rotateGroups = item.fields?.rotate_groups !== false;
  // Intra-dwell cycle cadence (owner beat: a 40s dwell "set to rotate every 10" must WALK
  // overall → group → group while displayed). Clamped [5,120] to match the editor (F7).
  const cycleSeconds = clampInt(n(item.fields, "cycle_seconds") ?? 10, 5, 120);

  const buckets = useMemo<TopBucket[]>(() => {
    const list: TopBucket[] = [];
    const overall = overallTopSellers(sales, 10);
    if (overall.length) list.push({ key: "__overall", title: "TOP SELLERS TONIGHT", items: overall });
    if (rotateGroups) {
      for (const g of groups) {
        if (g.toast_menu_guid === OVERALL_GROUP) continue; // the OVERALL group IS the overall bucket
        const rows = sales[g.toast_menu_guid];
        if (rows && rows.length) {
          list.push({ key: g.toast_menu_guid, title: g.name.toUpperCase(), items: [...rows].sort((a, b) => a.rank - b.rank).slice(0, 10) });
        }
      }
    }
    return list;
  }, [sales, groups, rotateGroups]);

  // Seed at a session-monotonic index (no cross-pass aliasing), then walk one bucket every
  // cycleSeconds via a FINITE re-armed one-shot timeout (A1 pattern — no interval, no infinite
  // animation, cleared on unmount). In a multi-item rotation a short dwell unmounts the slide
  // before the first tick fires → one list per pass (graceful degrade); in a single-item slot
  // this timer is what walks the lists continuously.
  const [start] = useState(() => topSellersSeq++);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (buckets.length <= 1) return;
    const id = window.setTimeout(() => setStep((s) => s + 1), cycleSeconds * 1000);
    return () => window.clearTimeout(id);
  }, [step, buckets.length, cycleSeconds]);
  const bucketIndex = buckets.length ? (start + step) % buckets.length : 0;
  const active = buckets[bucketIndex];

  const z = tsSizes(orientation, active?.items.length ?? 0);
  const title = active?.title ?? "TOP SELLERS TONIGHT";

  // Header title is ambient amber chrome; the "◉ LIVE FROM THE POS" indicator is green (live).
  const header = (
    <div style={{ flexShrink: 0, textAlign: "center", paddingBottom: 18, borderBottom: "1px solid var(--sig-rule)", marginBottom: orientation === "portrait" ? 28 : 14 }}>
      <div style={{ fontSize: TS_SIZES[orientation].header, fontWeight: 700, letterSpacing: 3, lineHeight: 0.98, textTransform: "uppercase", textShadow: "0 0 16px var(--terminal-glow)" }}>
        {title}
      </div>
      <div className="sig-live" style={{ fontSize: TS_SIZES[orientation].sub, letterSpacing: 4, marginTop: 10, opacity: 0.95 }}>◉ LIVE FROM THE POS</div>
    </div>
  );

  if (loading && !active) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {header}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: z.count, opacity: 0.6 }}>SYNCING SALES…</div>
      </div>
    );
  }
  if (!active) {
    // Owner design-beat: a proper in-world IDLE state for a fresh business day (closeout is
    // now 4 AM, so the morning wipes sales_cache until the first order rings in). Never a
    // blank slide or stale bars — this holds the surface, dim + centered + distance-readable.
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {header}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: orientation === "portrait" ? 28 : 20 }}>
          <div style={{ fontSize: orientation === "portrait" ? 96 : 76, fontWeight: 700, letterSpacing: 3, lineHeight: 0.98, opacity: 0.75, textShadow: "0 0 16px var(--terminal-glow)" }}>
            FIRST POUR PENDING
          </div>
          <div style={{ fontSize: orientation === "portrait" ? 40 : 32, letterSpacing: 5, opacity: 0.5 }}>
            ◊ SALES TELEMETRY ARMED
          </div>
        </div>
      </div>
    );
  }

  const shown = active.items;
  const maxCount = Math.max(...shown.map((it) => it.sales_count), 1);
  const rows = shown.map((it) => (
    <TopSellerRow key={`${it.rank}-${it.item_name}`} item={it} z={z} pct={(it.sales_count / maxCount) * 100} />
  ));

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {header}
      {orientation === "portrait" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: z.rowGap }}>
          {rows}
        </div>
      ) : (
        // DECISION: landscape is two columns, column-major (gridAutoFlow:column) so the left
        // column reads ranks top-to-bottom and the right continues — matching mockup view 4's
        // reading order. Row count follows the bucket depth so 10 rows fill 5×2.
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: `repeat(${Math.max(1, Math.ceil(shown.length / 2))}, auto)`, gridAutoFlow: "column", alignContent: "center", columnGap: 56, rowGap: z.rowGap }}>
          {rows}
        </div>
      )}
    </div>
  );
}

function TopSellerRow({ item, z, pct }: { item: DrinkItem; z: TSz; pct: number }) {
  const lead = item.rank === 1;
  const nameSize = Math.round(itemNameFont(item.item_name) * z.nameScale);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
        {/* rank: ambient amber chrome */}
        <span style={{ fontSize: z.rank, fontWeight: 700, lineHeight: 1, width: z.rank + 8, flexShrink: 0, opacity: lead ? 1 : 0.5, textAlign: "right" }}>{item.rank}</span>
        {/* name: LIVE green (docs/09) — sig-live on the same span that carries the size so the
            global span-clamp can't shrink it. */}
        <span className="sig-live" style={{ fontSize: nameSize, fontWeight: 700, lineHeight: 1.02, letterSpacing: 1, textTransform: "uppercase", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "clip", textShadow: lead ? "0 0 12px var(--terminal-glow)" : undefined, opacity: lead ? 1 : 0.95 }}>{item.item_name}</span>
        {/* count: the live sales figure is green; the SOLD label stays amber (inner span keeps
            its own size via inherit so the clamp can't touch it). */}
        <span style={{ fontSize: z.count, fontWeight: 700, lineHeight: 1, whiteSpace: "nowrap", flexShrink: 0, opacity: lead ? 1 : 0.92 }}>
          <span className="sig-live" style={{ fontSize: "inherit" }}>{item.sales_count}</span>
          <span style={{ fontSize: z.countLabel, opacity: 0.6, marginLeft: 8, letterSpacing: 1 }}>SOLD</span>
        </span>
      </div>
      <div style={{ height: z.barH, border: "1px solid var(--terminal-green)", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, right: "auto", width: `${Math.max(2, pct)}%`, background: "var(--terminal-green)", boxShadow: "0 0 10px var(--terminal-glow)", opacity: lead ? 1 : 0.82 }} />
      </div>
    </div>
  );
}

/* ── INSTAGRAM (recent @venue posts/stories as ONE rotation slide) ───────────── */
/**
 * Renders ONE Instagram post at a time (0042 DECISION: no internal sub-rotation, no infinite
 * animation). Which post is a time bucket — floor(now / dwell) — SEEDED at mount from
 * Date.now() (WARN-2: never swaps mid-dwell under a guest) and advanced by ONE finite,
 * re-armed setTimeout per dwell (A1). So it steps one post per dwell whether the card is a
 * slot's only item (Rotation never remounts it — the internal timer walks the feed) or one of
 * several (each remount reseeds to seed+1, the same value the timer would produce, so they
 * agree — no double-advance, no flash). Because the pick is time-derived, a preview at roughly
 * the same minute lands on roughly the same post, not a guaranteed exact match. Active stories
 * ride at the head of the feed (they jump the queue) and carry a STORY — TODAY ONLY badge.
 *
 * Distance-first (memory [[signage-design-principles]]): square mirrored photo in the OPTICAL
 * FEED viewport · caption in body type (trailing #hashtag/@mention blocks stripped, ~140-char
 * hard truncate, 3-line clamp) · @handle + relative time in live green · a QR to the post's
 * permalink with "SCAN TO OPEN THE POST" microcopy. NO Instagram glyph/wordmark (brand-safety:
 * no third-party marks on our surfaces — the @handle is content, the pointer).
 */
/** Session-monotonic seed for the IG card (same rationale as topSellersSeq): consecutive
 *  passes start on DIFFERENT posts, never aliasing to the same post every pass. The per-dwell
 *  internal walk is unchanged. */
let instagramSeq = 0;

export function InstagramCard({ item, orientation }: TemplateProps) {
  const postCount = clampInt(n(item.fields, "post_count") ?? 5, 1, 10);
  const includeStories = item.fields?.include_stories !== false; // default true
  const dwell = Math.max(4, item.duration_seconds || 12);
  const { items, loading } = useInstagramFeed(postCount, includeStories);

  // Which post shows is a bucket SEEDED at mount from a session-monotonic counter (no mid-dwell
  // swap under a guest; no cross-pass aliasing — the old floor(now/dwell) seed could repeat a
  // post every pass), then advanced ONLY by a finite one-shot timer re-armed each dwell (A1 —
  // no interval, no infinite animation). This fixes the dedicated-social-screen case: when the
  // IG card is a slot's ONLY item, Rotation never remounts it, so this internal tick walks the
  // feed. In a MULTI-item rotation the card unmounts at dwell end and remounts with the next
  // counter value (= seed+1) — the SAME value this timer would have produced, so remount and
  // timer agree: no double-advance, no flash (cleanup clears the pending timer on unmount).
  const [bucket, setBucket] = useState(() => instagramSeq++);
  useEffect(() => {
    const id = window.setTimeout(() => setBucket((b) => b + 1), dwell * 1000);
    return () => window.clearTimeout(id);
  }, [bucket, dwell]);

  const port = orientation === "portrait";
  const z = SIZES[orientation];

  const header = (
    <div style={{ flexShrink: 0 }}>
      <Eyebrow text="SOCIAL FEED — TRANSMISSION LOG" size={z.eyebrow} />
    </div>
  );

  if (loading && items.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: z.gap }}>
        {header}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: z.mid, opacity: 0.6 }}>TUNING THE FEED…</div>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: z.gap }}>
        {header}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 18 }}>
          <div style={{ fontSize: port ? 84 : 68, fontWeight: 700, letterSpacing: 3, opacity: 0.75, textShadow: "0 0 16px var(--terminal-glow)" }}>NO SIGNAL YET</div>
          <div className="sig-live" style={{ fontSize: port ? 40 : 32, letterSpacing: 4, opacity: 0.85 }}>◊ AWAITING NEXT POST</div>
        </div>
      </div>
    );
  }

  // The bucket holds for this dwell and steps forward one post per dwell (single-item slots)
  // or per remount (multi-item rotations) — see the seed/timer note above.
  const idx = bucket % items.length;
  const post = items[idx];
  const caption = cleanCaption(post.caption ?? "");
  // A2: the handle comes from the post data (the account's own username), never a hardcoded
  // venue handle. Neutral, non-branded fallback when a row somehow lacks a username.
  const handle = post.username ? `@${post.username}` : "SOCIAL FEED";
  const rel = relativeTime(post.posted_at).toUpperCase();

  const square = (
    // sig-contain (owner note 2026-07-14): IG posts are 4:5 / 1.91:1 — letterbox inside the
    // square frame, never crop heads/text (unlike drink_special, which keeps Toast's own square crop).
    <div className="sig-viewport sig-sq sig-contain" style={port ? { width: "100%" } : { height: "100%", width: "auto" }}>
      <span className="sig-feedcap sig-live" style={{ fontSize: 22 }}>◉ OPTICAL FEED — LIVE</span>
      {post.image
        ? <img src={post.image} alt="" />
        : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: port ? 44 : 36, opacity: 0.45, letterSpacing: 3 }}>NO IMAGE</div>}
    </div>
  );

  const qr = (
    <div style={{ display: "flex", alignItems: "center", gap: port ? 20 : 16, flexShrink: 0 }}>
      <div style={{ background: "#000", padding: 8, border: "2px solid var(--terminal-green)", lineHeight: 0, flexShrink: 0 }}>
        <QRCodeSVG value={post.permalink} size={port ? 150 : 128} bgColor="#000000" fgColor="#00ff41" level="M" />
      </div>
      <div style={{ fontSize: port ? 26 : 22, letterSpacing: 3, opacity: 0.8, lineHeight: 1.25 }}>
        SCAN TO<br />OPEN THE<br />POST
      </div>
    </div>
  );

  const captionBlock = (
    <div style={{ display: "flex", flexDirection: "column", gap: port ? 14 : 10, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <span className="sig-live" style={{ fontSize: port ? 48 : 40, fontWeight: 700, letterSpacing: 1, textShadow: "0 0 12px var(--terminal-glow)" }}>{handle}</span>
        {post.is_story
          ? <span style={{ fontSize: port ? 22 : 20, letterSpacing: 2, border: "2px solid var(--terminal-green)", padding: "3px 10px", opacity: 0.9 }}>STORY — TODAY ONLY</span>
          : <span className="sig-live" style={{ fontSize: port ? 26 : 22, letterSpacing: 2, opacity: 0.85 }}>{rel}</span>}
      </div>
      {caption && (
        <div style={{
          fontSize: port ? z.body : Math.round(z.body * 0.95), lineHeight: 1.4, opacity: 0.9,
          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {caption}
        </div>
      )}
    </div>
  );

  if (port) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: z.gap }}>
        {header}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ width: "min(880px, 100%)", flexShrink: 0, margin: "0 auto" }}>{square}</div>
          {captionBlock}
          <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-start" }}>{qr}</div>
        </div>
      </div>
    );
  }

  // Landscape: square photo left, caption + QR stacked right.
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: z.gap }}>
      {header}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row", gap: 44, alignItems: "stretch" }}>
        <div style={{ flexShrink: 0, height: "100%", display: "flex" }}>
          <div style={{ height: "100%" }}>{square}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 28 }}>
          {captionBlock}
          {qr}
        </div>
      </div>
    </div>
  );
}

/* ── SMART TOAST (data-driven live slide from sales_history — 0043) ──────────── */
/**
 * Two owner-asked modes, both distance-first and one-slide-per-pass (no sub-rotation, finite
 * animations, 60s poll max — same discipline as top_sellers / instagram):
 *
 *  • UNDERDOGS — the bottom `count` POS-visible items of a menu group by units sold over the
 *    last `days` (default 3 / Signature Cocktails / 7 days). ZERO-sellers included (the roster
 *    is the live POS menu from the toast cache, LEFT-joined to history sums — an item that
 *    sold nothing still appears, the ultimate underdog). 86'd / off-POS items are excluded
 *    (owner principle: never advertise what isn't on the POS view). In-world "give them some
 *    love" framing. One slide shows all `count` rows.
 *
 *  • CHAMPION — the single top item over the last `days` (default 30) big, with tonight's live
 *    "RIGHT NOW TOP 3" beneath (from sales_cache MAIN_MENU_ALL, already POS-gated). If history
 *    depth < `days` (early weeks) the slide states the TRUE window it used ("LAST 9 DAYS"),
 *    never claiming a month it doesn't have (useSalesHistory.trueDays).
 *
 * Live sales figures render GREEN (docs/09 color-state: green = live feed); chrome stays amber.
 */
export function SmartToast({ item, toast, orientation }: TemplateProps) {
  const mode = (s(item.fields, "smart_mode") ?? "underdogs").toLowerCase() === "champion" ? "champion" : "underdogs";
  const days = clampInt(n(item.fields, "days") ?? (mode === "champion" ? 30 : 7), 1, 400);
  const count = clampInt(n(item.fields, "count") ?? 3, 1, 6);
  const menuGroup = s(item.fields, "menu_group");

  const { sums, trueDays, loading } = useSalesHistory(days);
  const { byGroup, isLoading: salesLoading } = useSalesCache();
  const { groups } = useMenuGroups();

  const port = orientation === "portrait";
  const z = SIZES[orientation];

  if (mode === "champion") {
    // Optional group filter (owner fast-follow): empty/unset = whole menu (the "hot-dog nod",
    // unchanged); set = candidates restricted to that Toast group. The per-group live top-3 is
    // sourced from that group's sales_cache bucket (undefined = unconfigured → no sub-list).
    return (
      <SmartChampion
        sums={sums}
        trueDays={trueDays}
        loading={loading || salesLoading}
        byGroup={byGroup}
        toast={toast}
        orientation={orientation}
        menuGroup={menuGroup}
        groupGuid={groupGuidByName(groups, menuGroup)}
      />
    );
  }

  // UNDERDOGS — roster is the live POS menu for the group; history sums are a left-join.
  const roster = [...toast.values()].filter(
    (r) => menuGroup && sameMenuGroup(r.menu_group, menuGroup) && r.pos_visible && !r.out_of_stock,
  );
  const ranked = roster
    .map((r) => ({ row: r, qty: sums.get(r.guid)?.quantity ?? 0 }))
    // Bottom sellers first; ties broken by name so the order is deterministic across renders.
    .sort((a, b) => a.qty - b.qty || (a.row.name ?? "").localeCompare(b.row.name ?? ""))
    .slice(0, count);

  const header = (
    <div style={{ flexShrink: 0 }}>
      <Eyebrow text="CIVIL DEFENSE — RATION WATCH" size={z.eyebrow} />
      <div style={{ fontSize: port ? 88 : 66, fontWeight: 700, letterSpacing: 2, lineHeight: 0.98, textTransform: "uppercase", textShadow: "0 0 16px var(--terminal-glow)", marginTop: 8 }}>
        SHOW THESE SOME LOVE
      </div>
      <div style={{ fontSize: port ? 30 : 26, letterSpacing: 4, opacity: 0.7, marginTop: 6 }}>
        ◊ {(menuGroup ?? "MENU").toUpperCase()} — SLOWEST {ranked.length} {periodLabel(days)}
      </div>
    </div>
  );

  if (loading && roster.length === 0) {
    return <SmartFrame header={header}><div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: z.mid, opacity: 0.6 }}>SYNCING SALES…</div></SmartFrame>;
  }
  if (ranked.length === 0) {
    return (
      <SmartFrame header={header}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16 }}>
          <div style={{ fontSize: port ? 76 : 60, fontWeight: 700, letterSpacing: 3, opacity: 0.75, textShadow: "0 0 16px var(--terminal-glow)" }}>NO SLOW MOVERS</div>
          <div style={{ fontSize: port ? 34 : 28, letterSpacing: 4, opacity: 0.5 }}>◊ EVERYTHING'S POURING — PICK A GROUP</div>
        </div>
      </SmartFrame>
    );
  }

  return (
    <SmartFrame header={header}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: port ? 22 : 16 }}>
        {ranked.map(({ row, qty }) => (
          <UnderdogRow key={row.guid} name={(row.name ?? "SPECIAL").toUpperCase()} photo={row.image ?? undefined} qty={qty} days={days} orientation={orientation} />
        ))}
      </div>
    </SmartFrame>
  );
}

function SmartFrame({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 18 }}>
      {header}
      {children}
    </div>
  );
}

/** Case-insensitive Toast menu-group equality — the ONE string-match both smart_toast modes
 *  (UNDERDOGS roster + CHAMPION candidate/label) share, so a group filter can't drift between
 *  them. Toast cache names are title-case ("Signature Cocktails"); the picker stores that name. */
function sameMenuGroup(rowGroup: string | null, menuGroup: string): boolean {
  return !!rowGroup && rowGroup.trim().toLowerCase() === menuGroup.trim().toLowerCase();
}

/** "THIS WEEK" for a 7-day window, else "LAST {n}D" (distance-readable). */
function periodLabel(days: number): string {
  if (days === 7) return "THIS WEEK";
  if (days === 30) return "THIS MONTH";
  return `LAST ${days}D`;
}

function UnderdogRow({ name, photo, qty, days, orientation }: { name: string; photo: string | undefined; qty: number; days: number; orientation: Orientation }) {
  const port = orientation === "portrait";
  const thumb = port ? 148 : 116;
  const nameSize = Math.round(itemNameFont(name) * (port ? 1 : 0.8));
  const soldLabel = days === 7 ? "SOLD THIS WEEK" : `SOLD · ${periodLabel(days)}`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: port ? 28 : 22 }}>
      {photo ? (
        <div className="sig-viewport sig-sq" style={{ width: thumb, height: thumb, flexShrink: 0 }}>
          <img src={photo} alt="" />
        </div>
      ) : (
        <div className="sig-sq sig-sq-ph" style={{ width: thumb, height: thumb, flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: nameSize, fontWeight: 700, lineHeight: 1.02, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "clip", textShadow: "0 0 12px var(--terminal-glow)" }}>{name}</div>
        <div style={{ fontSize: port ? 40 : 32, fontWeight: 700, marginTop: 6 }}>
          <span className="sig-live" style={{ fontSize: "inherit" }}>{qty}</span>
          <span style={{ fontSize: port ? 26 : 22, opacity: 0.6, marginLeft: 10, letterSpacing: 2 }}>{soldLabel}</span>
        </div>
      </div>
    </div>
  );
}

function SmartChampion({
  sums, trueDays, loading, byGroup, toast, orientation, menuGroup, groupGuid,
}: {
  sums: Map<string, HistorySum>;
  trueDays: number;
  loading: boolean;
  byGroup: Record<string, DrinkItem[]>;
  toast: Map<string, ToastCacheRow>;
  orientation: Orientation;
  /** Optional Toast menu-group name; empty/unset = whole menu (the hot-dog nod). */
  menuGroup?: string;
  /** Resolved sales_cache bucket guid for menuGroup (undefined if unset/unconfigured). */
  groupGuid?: string;
}) {
  const port = orientation === "portrait";
  const z = SIZES[orientation];

  // Pick the highest-selling guid that is present in the toast cache AND POS-visible/in-stock
  // (owner principle) — walk the sorted list until one qualifies. When a group filter is set,
  // the candidate must ALSO belong to that group (same sameMenuGroup() match as UNDERDOGS, so
  // the two modes can't drift); empty group = whole menu, unchanged.
  const sorted = [...sums.values()].sort((a, b) => b.quantity - a.quantity);
  let champ: { name: string; qty: number; photo: string | undefined; category: string | undefined } | null = null;
  for (const h of sorted) {
    const row = toast.get(h.toast_guid);
    if (!row || !row.pos_visible || row.out_of_stock) continue;
    if (menuGroup && !sameMenuGroup(row.menu_group, menuGroup)) continue;
    champ = { name: (row.name ?? h.name ?? "SPECIAL").toUpperCase(), qty: h.quantity, photo: row.image ?? undefined, category: row.menu_group ?? h.menu_group ?? undefined };
    break;
  }

  // Tonight's live top 3: whole menu → sales_cache MAIN_MENU_ALL; group set → that group's
  // per-group bucket (never fall back to the whole-menu list — a group slide showing the
  // overall top-3 would mislead). An unconfigured group (no bucket) simply shows no sub-list.
  const top3 = menuGroup ? groupTopSellers(byGroup, groupGuid, 3) : overallTopSellers(byGroup, 3);

  const header = (
    <div style={{ flexShrink: 0 }}>
      <Eyebrow text="SHELTER RECORDS — TOP OF THE CHARTS" size={z.eyebrow} />
      {menuGroup && (
        // DECISION: group-set framing reads "{GROUP} CHAMPION — LAST {trueDays} DAYS" (trueDays
        // keeps the window honest on shallow history, same as the hero's SOLD line). Kept as the
        // literal group name rather than singularizing ("Signature Cocktail") — the owner's Toast
        // group names are the source of truth and read fine as a banner.
        <div style={{ fontSize: port ? 30 : 26, letterSpacing: 4, opacity: 0.7, marginTop: 6 }}>
          ◊ {menuGroup.toUpperCase()} CHAMPION — LAST {trueDays} DAY{trueDays === 1 ? "" : "S"}
        </div>
      )}
    </div>
  );

  if (loading && !champ) {
    return <SmartFrame header={header}><div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: z.mid, opacity: 0.6 }}>SYNCING SALES…</div></SmartFrame>;
  }
  if (!champ) {
    return (
      <SmartFrame header={header}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16 }}>
          <div style={{ fontSize: port ? 84 : 66, fontWeight: 700, letterSpacing: 3, opacity: 0.75, textShadow: "0 0 16px var(--terminal-glow)" }}>NO CHAMPION YET</div>
          <div className="sig-live" style={{ fontSize: port ? 36 : 30, letterSpacing: 4, opacity: 0.85 }}>◊ TALLYING THE POURS</div>
        </div>
      </SmartFrame>
    );
  }

  const balName = balanceHeadline(champ.name);
  const nameSize = headlineFont(balName, orientation);

  return (
    <SmartFrame header={header}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: port ? "column" : "row", gap: port ? 20 : 40, alignItems: port ? "stretch" : "center" }}>
        {/* Champion hero */}
        <div style={{ flex: port ? "0 0 auto" : 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: port ? "center" : "flex-start", gap: 12 }}>
          {champ.photo && (
            <div className="sig-viewport sig-sq" style={{ width: port ? "min(720px, 100%)" : undefined, height: port ? undefined : Math.round(z.photoH * 0.95), aspectRatio: port ? undefined : "1 / 1" }}>
              <span className="sig-feedcap sig-live" style={{ fontSize: 20 }}>◉ CHART LEADER</span>
              <img src={champ.photo} alt="" />
            </div>
          )}
          <div style={{ fontSize: nameSize, fontWeight: 700, lineHeight: 0.9, letterSpacing: 1, textTransform: "uppercase", textAlign: port ? "center" : "left", textShadow: "0 0 16px var(--terminal-glow)" }}>
            {balName.split("\n").map((l, i) => <span key={i} style={{ display: "block", fontSize: "inherit" }}>{l}</span>)}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, justifyContent: port ? "center" : "flex-start" }}>
            <span className="sig-live" style={{ fontSize: port ? 150 : 120, fontWeight: 700, lineHeight: 0.8, textShadow: "0 0 26px var(--terminal-glow)" }}>{champ.qty}</span>
            <span style={{ fontSize: port ? 40 : 34, letterSpacing: 2, opacity: 0.75 }}>SOLD · LAST {trueDays} DAY{trueDays === 1 ? "" : "S"}</span>
          </div>
        </div>

        {/* RIGHT NOW top 3 */}
        {top3.length > 0 && (
          <div style={{ flex: port ? "1 1 auto" : "0 0 40%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", borderTop: port ? "1px solid var(--sig-rule)" : "none", borderLeft: port ? "none" : "1px solid var(--sig-rule)", paddingTop: port ? 16 : 0, paddingLeft: port ? 0 : 36, gap: port ? 12 : 14 }}>
            <div style={{ fontSize: port ? 34 : 30, letterSpacing: 4, opacity: 0.7 }}>◉ RIGHT NOW — TONIGHT'S TOP 3</div>
            {top3.map((it) => (
              <div key={it.rank} style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                <span style={{ fontSize: port ? 44 : 38, fontWeight: 700, opacity: 0.5, width: port ? 40 : 34, flexShrink: 0 }}>{it.rank}</span>
                <span className="sig-live" style={{ flex: 1, minWidth: 0, fontSize: port ? 42 : 34, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "clip" }}>{it.item_name}</span>
                <span style={{ fontSize: port ? 34 : 28, fontWeight: 700, flexShrink: 0 }}>
                  <span className="sig-live" style={{ fontSize: "inherit" }}>{it.sales_count}</span>
                  <span style={{ fontSize: port ? 22 : 20, opacity: 0.6, marginLeft: 6 }}>SOLD</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </SmartFrame>
  );
}

/* ── dispatcher ─────────────────────────────────────────────────────────────── */
export interface TemplateProps {
  item: SignageItem;
  toast: Map<string, ToastCacheRow>;
  orientation: Orientation;
  /** Venue display name for the card's bottom brand mark (view 1). Threaded from the
   *  SlotDisplay so nothing hardcodes 'Bunker Club' (venue-scope rule). */
  venueName?: string;
}

export function TemplateView(props: TemplateProps) {
  switch (props.item.template) {
    case "drink_special": return <DrinkSpecial {...props} />;
    case "event": return <EventItem {...props} />;
    case "announcement": return <Announcement {...props} />;
    case "image_only": return <ImageOnly {...props} />;
    case "celebration": return <Celebration {...props} />;
    case "top_sellers": return <TopSellers {...props} />;
    case "instagram": return <InstagramCard {...props} />;
    case "smart_toast": return <SmartToast {...props} />;
    // Phase 7 rotation-level event cards (docs/13) — materialized from a live event.
    case "event_window": return <EventWindowCard item={props.item} toast={props.toast} orientation={props.orientation} />;
    case "event_message": return <EventMessageCard item={props.item} toast={props.toast} orientation={props.orientation} />;
    case "event_tease": return props.item.event ? <EventTeaseCard event={props.item.event} orientation={props.orientation} /> : null;
    default: return null;
  }
}

/* ── helpers ────────────────────────────────────────────────────────────────── */
function formatPrice(p: number): string {
  return Number.isInteger(p) ? String(p) : p.toFixed(2);
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/**
 * Clean an Instagram caption for a distance-first slide (0042 DECISION): strip the trailing
 * block of #hashtags / @mentions (the usual spam tail), collapse whitespace, and hard-truncate
 * to ~140 chars with an ellipsis. A caption that is ONLY hashtags collapses to empty (fine —
 * the card just shows the photo + handle).
 */
function cleanCaption(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  const tokens = s.split(" ");
  while (tokens.length && /^[#@][\w.À-￿]+$/.test(tokens[tokens.length - 1])) tokens.pop();
  s = tokens.join(" ").trim();
  if (s.length > 140) s = s.slice(0, 139).replace(/\s+\S*$/, "").trimEnd() + "…";
  return s;
}

/** Relative time, e.g. "2 hours ago" (for the Instagram card). */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/** Typewriter that reveals `msg` once (28ms/char), then idles. No loop (perf rule). */
function useTypewriter(msg: string): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setI(msg.length);
      return;
    }
    const id = window.setInterval(() => {
      setI((prev) => {
        if (prev >= msg.length) { window.clearInterval(id); return prev; }
        return prev + 1;
      });
    }, 28);
    return () => window.clearInterval(id);
  }, [msg]);
  return msg.slice(0, i);
}

function eventDate(date: string | undefined, time: string | undefined): { dow: string; day: string; time: string } {
  let dow = "", day = "";
  if (date) {
    const d = new Date(date.length <= 10 ? `${date}T12:00:00` : date);
    if (!Number.isNaN(d.getTime())) {
      dow = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
      day = String(d.getDate());
    }
  }
  return { dow, day, time: (time ?? "").toUpperCase() };
}
