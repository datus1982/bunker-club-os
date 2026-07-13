import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Orientation, SignageItem, ToastCacheRow } from "./useSignage";
import { EventWindowCard, EventMessageCard, EventTeaseCard } from "./EventStages";

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
  portrait: { eyebrow: 30, stamp: 34, big: 130, mid: 72, body: 40, price: 200, priceSmall: 72, photoH: 620, pad: 64, gap: 28 },
  landscape: { eyebrow: 26, stamp: 30, big: 104, mid: 60, body: 36, price: 160, priceSmall: 58, photoH: 440, pad: 56, gap: 22 },
};

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

/** GREEN wrapper for a live-sourced value inside amber mode (docs/09). */
function Live({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span className="sig-live" style={style}>{children}</span>;
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

/* ── DRINK SPECIAL ──────────────────────────────────────────────────────────── */
export function DrinkSpecial({ item, toast, orientation }: TemplateProps) {
  const z = SIZES[orientation];
  const guid = s(item.fields, "source_toast_guid");
  const src = guid ? toast.get(guid) : undefined;

  // Manual field overrides win; otherwise fall back to the Toast mirror. A value that
  // resolves FROM Toast (no manual override) is "live" → green.
  const manualName = s(item.fields, "name");
  const name = manualName ?? src?.name ?? "SPECIAL";
  const nameLive = !manualName && !!src?.name;

  const manualPrice = n(item.fields, "price");
  const price = manualPrice ?? src?.price ?? undefined;
  const priceLive = manualPrice === undefined && src?.price != null;

  const photo = s(item.fields, "image_url") ?? src?.image ?? undefined;
  const treatment = s(item.fields, "photo_treatment") ?? "viewport";
  // Blurb: manual override, else the description-safe public blurb (text before `---`).
  const blurb = s(item.fields, "tagline") ?? s(item.fields, "blurb") ?? src?.public_blurb ?? undefined;

  const nameEl = <span style={{ fontSize: z.big, fontWeight: 700, lineHeight: 0.95, textTransform: "uppercase", textShadow: "0 0 14px var(--terminal-glow)" }}>{name}</span>;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative", gap: z.gap }}>
      <Stamp text="CIVIL DEFENSE APPROVED" size={z.stamp} />
      <Eyebrow text="TONIGHT'S SPECIAL — CONSUMABLE" size={z.eyebrow} />
      <div>{nameLive ? <Live>{nameEl}</Live> : nameEl}</div>
      <Photo src={photo} treatment={treatment} height={z.photoH} feed="OPTICAL FEED 01 — LIVE" />
      <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
        <div style={{ fontSize: z.body, opacity: 0.85, lineHeight: 1.4, maxWidth: "62%" }}>{blurb}</div>
        {price != null && (
          <div style={{ fontSize: z.price, fontWeight: 700, lineHeight: 1, textShadow: "0 0 18px var(--terminal-glow)" }}>
            {priceLive ? (
              <Live><small style={{ fontSize: z.priceSmall, verticalAlign: "top" }}>$</small>{formatPrice(price)}</Live>
            ) : (
              <><small style={{ fontSize: z.priceSmall, verticalAlign: "top" }}>$</small>{formatPrice(price)}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── EVENT ──────────────────────────────────────────────────────────────────── */
export function EventItem({ item, orientation }: TemplateProps) {
  const z = SIZES[orientation];
  const title = s(item.fields, "title") ?? "UPCOMING EVENT";
  const blurb = s(item.fields, "blurb");
  const photo = s(item.fields, "image_url");
  const treatment = s(item.fields, "photo_treatment") ?? "viewport";
  const when = eventDate(s(item.fields, "date"), s(item.fields, "time"));

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative", gap: z.gap }}>
      <Stamp text="MANDATORY FUN" size={z.stamp} />
      <Eyebrow text="UPCOMING PROTOCOL" size={z.eyebrow} />
      <div style={{ fontSize: z.big, fontWeight: 700, lineHeight: 0.95, textTransform: "uppercase", textShadow: "0 0 14px var(--terminal-glow)" }}>{title}</div>
      <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
        {when.day && (
          <div style={{ border: "2px solid var(--terminal-green)", padding: "14px 22px", textAlign: "center", flexShrink: 0 }}>
            <div style={{ fontSize: z.eyebrow, letterSpacing: 3, opacity: 0.7 }}>{when.dow}</div>
            <div style={{ fontSize: z.mid * 1.2, fontWeight: 700, lineHeight: 1 }}>{when.day}</div>
          </div>
        )}
        <div>
          {when.time && <div style={{ fontSize: z.mid, fontWeight: 700, lineHeight: 1.05 }}>{when.time}</div>}
          {blurb && <div style={{ fontSize: z.body, opacity: 0.85, lineHeight: 1.45, marginTop: 8 }}>{blurb}</div>}
        </div>
      </div>
      {photo && <Photo src={photo} treatment={treatment} height={z.photoH * 0.7} feed="ARCHIVE FEED" />}
    </div>
  );
}

/* ── ANNOUNCEMENT (typewriter once, then idle) ──────────────────────────────── */
export function Announcement({ item, orientation }: TemplateProps) {
  const z = SIZES[orientation];
  const msg = s(item.fields, "text") ?? s(item.fields, "message") ?? "SYSTEM ONLINE.";
  const typed = useTypewriter(msg);
  const priority = (s(item.fields, "priority") ?? "LOW").toUpperCase();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: z.gap }}>
      <Eyebrow text={`SYSTEM BULLETIN — PRIORITY ${priority}`} size={z.eyebrow} />
      <div className="sig-cursor" style={{ fontSize: z.mid, fontWeight: 700, lineHeight: 1.3, whiteSpace: "pre-wrap", textShadow: "0 0 12px var(--terminal-glow)" }}>
        {typed}
      </div>
    </div>
  );
}

/* ── IMAGE ONLY (letterboxed) ───────────────────────────────────────────────── */
export function ImageOnly({ item, orientation }: TemplateProps) {
  const z = SIZES[orientation];
  const photo = s(item.fields, "image_url");
  const treatment = s(item.fields, "photo_treatment") ?? "viewport";
  const caption = s(item.fields, "caption");
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: z.gap }}>
      <Eyebrow text="ARCHIVE FEED" size={z.eyebrow} />
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
        <div className="sig-viewport" style={{ width: z.photoH * 0.9, height: z.photoH * 0.9, borderRadius: 0 }}>
          <span className="sig-feedcap" style={{ fontSize: 18 }}>DWELLER ID</span>
          <img src={photo} alt="" />
        </div>
      )}
      <div style={{ fontSize: z.big, fontWeight: 700, lineHeight: 0.95, textTransform: "uppercase", textShadow: "0 0 18px var(--terminal-glow)" }}>{honoree}</div>
      <div style={{ fontSize: z.mid * 0.7, opacity: 0.85 }}>{occasionLine}</div>
      {message && <div style={{ fontSize: z.body, opacity: 0.8, maxWidth: "80%", lineHeight: 1.4 }}>{message}</div>}
    </div>
  );
}

/* ── dispatcher ─────────────────────────────────────────────────────────────── */
export interface TemplateProps {
  item: SignageItem;
  toast: Map<string, ToastCacheRow>;
  orientation: Orientation;
}

export function TemplateView(props: TemplateProps) {
  switch (props.item.template) {
    case "drink_special": return <DrinkSpecial {...props} />;
    case "event": return <EventItem {...props} />;
    case "announcement": return <Announcement {...props} />;
    case "image_only": return <ImageOnly {...props} />;
    case "celebration": return <Celebration {...props} />;
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
