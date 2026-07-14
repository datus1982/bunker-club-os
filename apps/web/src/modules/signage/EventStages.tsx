import { useEffect, useState, type ReactNode } from "react";
import type { Orientation, SignageItem, ToastCacheRow } from "./useSignage";
import {
  secondsToFire, formatTMinus, balanceHeadline, ALERT_PULSE_MS, type LiveEvent, type EventStage,
} from "./eventStage";
import { parseInline, alignOf, alignStyle } from "./richText";
import { SquarePhoto } from "./signagePhoto";

/**
 * Event-stage renderers for the Phase 7 events DISPLAY engine (docs/13). Visual language
 * matched to docs/event-choreography-mockup.html:
 *   • ALERT     — full-screen, skin-framed T-MINUS countdown (hazard border for
 *                 infestation), inverse-video pulse in the final 10s (FINITE class).
 *   • MOMENT    — payoff beat (liftoff / outbreak), runs once, ≤15s.
 *   • EVENT     — CTA card: linked item name + LIVE green price + LIVE counter
 *                 (fields.live_count) — counter block renders ONLY when live_count exists.
 *   • ALL-CLEAR — resolution card with final tally.
 * Plus the rotation-level cards (window / message / tease) that ride the normal rotation.
 *
 * All copy comes from `fields` with per-skin defaults. NO third-party franchise wording.
 * No infinite animations (the countdown ticks via state; the pulse is a bounded class).
 */

/* ── skins ──────────────────────────────────────────────────────────────────── */
interface Skin {
  hazard: boolean;
  alertHeadline: string;   // \n splits lines
  alertDirective: string;
  momentIcon: string;
  momentHeadline: string;
  momentSub: string;
  windowLabel: string;     // "LAUNCH WINDOW OPEN"
  counterLabel: string;    // "FUEL CONSUMED"
  counterUnit: string;
  tallyVerb: string;       // "FUELED" → "47 DWELLERS FUELED"
  allClearHeadline: string;
  allClearBody: string;
  teaseEyebrow: string;
  teaseBody: string;
}

const SKINS: Record<string, Skin> = {
  launch: {
    hazard: false,
    alertHeadline: "LAUNCH\nIMMINENT",
    alertDirective: "FUEL UP BEFORE THE WINDOW OPENS.",
    momentIcon: "🚀",
    momentHeadline: "WE HAVE\nLIFTOFF",
    momentSub: "TRAJECTORY NOMINAL",
    windowLabel: "LAUNCH WINDOW OPEN",
    counterLabel: "FUEL CONSUMED",
    counterUnit: "UNITS · LIVE FROM MISSION CONTROL (TOAST)",
    tallyVerb: "FUELED",
    allClearHeadline: "MISSION COMPLETE",
    allClearBody: "THE FACILITY SURVIVES.\nNORMAL OPERATIONS RESUME.",
    teaseEyebrow: "⚠ SYSTEM NOTICE — PRIORITY LOW",
    teaseBody: "ANOMALOUS ACTIVITY DETECTED ON THE LAUNCH PAD. PRE-FLIGHT CHECKS UNDERWAY. DWELLERS ARE ADVISED TO REMAIN CALM AND ADEQUATELY HYDRATED.",
  },
  infestation: {
    hazard: true,
    alertHeadline: "INFESTATION\nDETECTED",
    alertDirective: "INOCULATION DIRECTIVE: ONE DOSE PER DWELLER.",
    momentIcon: "🪳",
    momentHeadline: "OUTBREAK\nIN PROGRESS",
    momentSub: "CONTAINMENT WINDOW OPEN",
    windowLabel: "INOCULATION WINDOW OPEN",
    counterLabel: "DWELLERS INOCULATED",
    counterUnit: "DOSES · LIVE FROM CONTAINMENT (TOAST)",
    tallyVerb: "INOCULATED",
    allClearHeadline: "OUTBREAK CONTAINED",
    allClearBody: "CONTAINMENT CONFIRMED.\nTHE FACILITY SURVIVES.",
    teaseEyebrow: "⚠ BIOLOGICAL NOTICE — PRIORITY LOW",
    teaseBody: "BIOLOGICAL READINGS ELEVATED IN SUBLEVEL 2. CONTAINMENT PROTOCOLS ARE BEING REVIEWED. THIS IS NOT A DRILL. PROBABLY.",
  },
  generic: {
    hazard: false,
    alertHeadline: "STAND BY",
    alertDirective: "",
    momentIcon: "◈",
    momentHeadline: "NOW LIVE",
    momentSub: "",
    windowLabel: "WINDOW OPEN",
    counterLabel: "COUNT",
    counterUnit: "UNITS · LIVE (TOAST)",
    tallyVerb: "SERVED",
    allClearHeadline: "COMPLETE",
    allClearBody: "NORMAL OPERATIONS RESUME.",
    teaseEyebrow: "SYSTEM NOTICE — PRIORITY LOW",
    teaseBody: "SOMETHING IS COMING.",
  },
};

function skinOf(name: string): Skin {
  return SKINS[name] ?? SKINS.generic;
}

/* ── sizes (docs/signage-redesign view 2 — "20-foot test": titles/times/counters hero-sized,
 *   chrome demoted to secondary) ───────────────────────────────────────────────── */
type Sz = { eyebrow: number; big: number; time: number; tminus: number; counter: number; price: number; body: number; icon: number; pad: number; gap: number };
const SIZES: Record<Orientation, Sz> = {
  portrait: { eyebrow: 32, big: 150, time: 280, tminus: 340, counter: 230, price: 150, body: 46, icon: 190, pad: 60, gap: 24 },
  landscape: { eyebrow: 27, big: 116, time: 210, tminus: 250, counter: 180, price: 120, body: 40, icon: 150, pad: 52, gap: 20 },
};

/**
 * Headline auto-shrink (mirrors SignageTemplates.headlineFont; kept local to avoid a
 * module cycle — SignageTemplates imports the event cards from here). Sizes off the
 * longest \n-line so short heroes fill the screen and long ones still fit.
 */
function headlineFont(text: string, o: Orientation): number {
  const maxLine = Math.max(1, ...text.split("\n").map((l) => l.trim().length));
  const p = maxLine <= 6 ? 200 : maxLine <= 9 ? 168 : maxLine <= 12 ? 140 : maxLine <= 16 ? 116 : maxLine <= 22 ? 92 : 76;
  return o === "portrait" ? p : Math.round(p * 0.72);
}

/* ── field helpers ──────────────────────────────────────────────────────────── */
function fstr(fields: Record<string, unknown>, key: string): string | undefined {
  const v = fields[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function fnum(fields: Record<string, unknown>, key: string): number | undefined {
  const v = fields[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}
function formatPrice(p: number): string {
  return Number.isInteger(p) ? String(p) : p.toFixed(2);
}
function Lines({ text }: { text: string }): ReactNode {
  // fontSize:inherit is load-bearing: the global `.terminal-theme span{font-size:1.5rem}`
  // rule otherwise clamps these line spans to 24px (a direct rule beats the parent div's
  // inherited size), collapsing every multi-line headline/directive to body text.
  // parseInline turns `**bold**` into <strong> (Phase 8 basic formatting).
  return text.split("\n").map((l, i) => (
    <span key={i} style={{ display: "block", fontSize: "inherit" }}>{parseInline(l)}</span>
  ));
}

/* Square edge (fixed-canvas px) for a custom event-card image, per orientation. */
const EVT_IMG: Record<Orientation, number> = { portrait: 560, landscape: 380 };

/* ── local 1s clock for countdowns (state-driven, no network, no CSS loop) ────── */
function useSecondTick(): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setN(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return n;
}

/* ═══════════════ full-screen takeover-level stages ═══════════════════════════ */

/** Dispatcher for the surface-holding MOMENT stages (mode === "event"). */
export function EventStageView({
  event, stage, orientation, toast,
}: {
  event: LiveEvent;
  stage: "alert" | "moment" | "event" | "allclear";
  orientation: Orientation;
  toast: Map<string, ToastCacheRow>;
}) {
  switch (stage) {
    case "alert": return <AlertStage event={event} orientation={orientation} />;
    case "moment": return <MomentStage event={event} orientation={orientation} />;
    case "event": return <EventWindowStage event={event} orientation={orientation} toast={toast} />;
    case "allclear": return <AllClearStage event={event} orientation={orientation} />;
    default: return null;
  }
}

/* ── ALERT ──────────────────────────────────────────────────────────────────── */
function AlertStage({ event, orientation }: { event: LiveEvent; orientation: Orientation }) {
  const z = SIZES[orientation];
  const sk = skinOf(event.skin);
  const now = useSecondTick();
  const remaining = secondsToFire(event, now);
  const headline = fstr(event.fields, "alert_headline") ?? sk.alertHeadline;
  const directive = fstr(event.fields, "directive") ?? sk.alertDirective;
  const cta = fstr(event.fields, "cta");
  // Inverse-video pulse in the final 10s — a bounded (10-iteration) class, not infinite.
  const pulse = remaining > 0 && remaining <= ALERT_PULSE_MS / 1000;
  const hero = balanceHeadline(headline);

  return (
    <div
      className={`evt-stage${pulse ? " evt-alert-pulse" : ""}`}
      style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: z.pad, gap: z.gap }}
    >
      {sk.hazard && <div className="evt-hazard-frame" />}
      <div style={{ fontSize: z.eyebrow, letterSpacing: 6, opacity: 0.8 }}>■ ALL TERMINALS — PRIORITY BROADCAST ■</div>
      <div style={{ fontSize: headlineFont(hero, orientation), fontWeight: 700, lineHeight: 0.9, textTransform: "uppercase", textShadow: "0 0 22px var(--terminal-glow)" }}>
        <Lines text={hero} />
      </div>
      <div style={{ fontSize: z.tminus, fontWeight: 700, lineHeight: 0.9, fontVariantNumeric: "tabular-nums", textShadow: "0 0 30px var(--terminal-glow)" }}>
        {formatTMinus(remaining)}
      </div>
      {directive && <div style={{ fontSize: z.body, opacity: 0.9, lineHeight: 1.35, maxWidth: "86%" }}><Lines text={directive} /></div>}
      {cta && <div style={{ fontSize: z.body * 1.1, fontWeight: 700, letterSpacing: 2 }}>{cta}</div>}
    </div>
  );
}

/* ── MOMENT (payoff, once) ──────────────────────────────────────────────────── */
function MomentStage({ event, orientation }: { event: LiveEvent; orientation: Orientation }) {
  const z = SIZES[orientation];
  const sk = skinOf(event.skin);
  const now = useSecondTick();
  const elapsed = event.fire_at ? Math.max(0, Math.floor((now - new Date(event.fire_at).getTime()) / 1000)) : 0;
  const headline = balanceHeadline(fstr(event.fields, "moment_headline") ?? sk.momentHeadline);
  const icon = fstr(event.fields, "moment_icon") ?? sk.momentIcon;
  const sub = fstr(event.fields, "moment_sub") ?? sk.momentSub;

  return (
    <div className="evt-stage" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: z.pad, gap: z.gap }}>
      <div className="evt-liftoff" style={{ fontSize: z.icon, lineHeight: 1 }}>{icon}</div>
      <div style={{ fontSize: headlineFont(headline, orientation), fontWeight: 700, lineHeight: 0.9, textTransform: "uppercase", textShadow: "0 0 26px var(--terminal-glow)" }}>
        <Lines text={headline} />
      </div>
      <div style={{ fontSize: z.body, opacity: 0.85 }}>
        T+{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}{sub ? ` · ${sub}` : ""}
      </div>
    </div>
  );
}

/* ── EVENT window (CTA + live counter) ──────────────────────────────────────── */
function EventWindowStage({ event, orientation, toast }: { event: LiveEvent; orientation: Orientation; toast: Map<string, ToastCacheRow> }) {
  const z = SIZES[orientation];
  const sk = skinOf(event.skin);
  const now = useSecondTick();

  const src = event.toast_guid ? toast.get(event.toast_guid) : undefined;
  const name = balanceHeadline(fstr(event.fields, "title") ?? src?.name ?? event.name);
  const nameLive = !fstr(event.fields, "title") && !!src?.name;
  const price = fnum(event.fields, "price") ?? src?.price ?? undefined;

  // POS-visibility gate (0034 owner principle: never advertise anything not active on the
  // POS view). If the linked drink is 86'd or off-POS, suppress the price ($X) — the moment's
  // arc still completes (name/directive/counter stay), we just stop quoting a price you can't
  // buy. Fail-open like everywhere else: only an EXPLICIT out_of_stock/pos_visible=false hides.
  const posHidden = !!src && (src.out_of_stock || src.pos_visible === false);

  // Remaining in the event window (to fire_at + window_minutes).
  const windowEnd = event.fire_at ? new Date(event.fire_at).getTime() + event.window_minutes * 60_000 : now;
  const remain = Math.max(0, Math.ceil((windowEnd - now) / 1000));
  const remainClock = `${String(Math.floor(remain / 60)).padStart(2, "0")}:${String(remain % 60).padStart(2, "0")}`;

  // Counter renders ONLY when fields.live_count exists (docs/13 — never implies tracking).
  const count = fnum(event.fields, "live_count");
  const counterLabel = fstr(event.fields, "counter_label") ?? sk.counterLabel;

  // Custom image wins over the linked drink photo (Phase 8 owner ask); shown in the square.
  const customImg = fstr(event.fields, "image_url");
  const align = alignOf(event.fields);

  return (
    <div className="evt-stage" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: z.pad, gap: z.gap, ...alignStyle(align) }}>
      <div style={{ fontSize: z.eyebrow, letterSpacing: 4, opacity: 0.8 }}>{sk.windowLabel} — {remainClock} REMAINING</div>
      {customImg && <SquarePhoto src={customImg} size={EVT_IMG[orientation]} feed="OPTICAL FEED" />}
      <div style={{ fontSize: headlineFont(name, orientation), fontWeight: 700, lineHeight: 0.9, textTransform: "uppercase", textShadow: "0 0 20px var(--terminal-glow)" }}>
        {nameLive ? <span className="sig-live" style={{ fontSize: "inherit" }}><Lines text={name} /></span> : <Lines text={name} />}
      </div>
      {price != null && !posHidden && (
        <div className="sig-live" style={{ fontSize: z.price, fontWeight: 700, lineHeight: 1, textShadow: "0 0 16px var(--terminal-glow)" }}>
          <small style={{ fontSize: z.price * 0.5, verticalAlign: "top" }}>$</small>{formatPrice(price)}
        </div>
      )}
      {count != null && (
        <>
          <div style={{ borderTop: "1px solid var(--terminal-glow)", width: "60%", margin: `${z.gap}px 0` }} />
          <div style={{ fontSize: z.eyebrow, letterSpacing: 4, opacity: 0.8 }}>{counterLabel}</div>
          <div key={count} className="sig-live sig-enter" style={{ fontSize: z.counter, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums", textShadow: "0 0 26px var(--terminal-glow)" }}>
            {count}
          </div>
          <div style={{ fontSize: z.body * 0.7, opacity: 0.7, letterSpacing: 2 }}>{sk.counterUnit}</div>
        </>
      )}
    </div>
  );
}

/* ── ALL-CLEAR ──────────────────────────────────────────────────────────────── */
function AllClearStage({ event, orientation }: { event: LiveEvent; orientation: Orientation }) {
  const z = SIZES[orientation];
  const sk = skinOf(event.skin);
  const count = fnum(event.fields, "live_count");
  const tally = fstr(event.fields, "tally");
  const headline = fstr(event.fields, "all_clear_headline") ?? sk.allClearHeadline;
  const body = fstr(event.fields, "all_clear_body") ?? sk.allClearBody;

  const balTally = tally ? balanceHeadline(tally) : undefined;
  const tallyEl = balTally
    ? <Lines text={balTally} />
    : count != null
      ? <><span className="sig-live">{count}</span> DWELLERS {sk.tallyVerb}</>
      : <Lines text={balanceHeadline(headline)} />;

  return (
    <div className="evt-stage" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: z.pad, gap: z.gap }}>
      <div style={{ fontSize: z.eyebrow, letterSpacing: 4, opacity: 0.8 }}>{headline}</div>
      <div style={{ fontSize: headlineFont(balTally ?? balanceHeadline(headline), orientation) * 0.9, fontWeight: 700, lineHeight: 0.95, textTransform: "uppercase", textShadow: "0 0 22px var(--terminal-glow)" }}>{tallyEl}</div>
      <div style={{ fontSize: z.body, opacity: 0.85, lineHeight: 1.35, maxWidth: "82%" }}><Lines text={body} /></div>
    </div>
  );
}

/* ═══════════════ rotation-level cards (ride the normal rotation) ═════════════ */

/** Active WINDOW promo card (docs/13 + redesign view 2 "calm rotation card"): title
 *  auto-shrunk hero, a huge TIME hero (fields.time, e.g. "4–7 PM", when authored), one
 *  directive line, then a divide + linked drink name/price in live green. */
export function EventWindowCard({ item, toast, orientation }: { item: SignageItem; toast: Map<string, ToastCacheRow>; orientation: Orientation }) {
  const z = SIZES[orientation];
  const ev = item.event;
  const src = ev?.toast_guid ? toast.get(ev.toast_guid) : undefined;
  const title = balanceHeadline(fstr(item.fields, "title") ?? ev?.name ?? "HAPPY HOUR");
  const time = fstr(item.fields, "time"); // hero time window — authored only (never invented)
  const body = fstr(item.fields, "body") ?? fstr(item.fields, "directive") ?? src?.public_blurb;
  const cta = fstr(item.fields, "cta");

  const linkedName = src?.name;
  const price = fnum(item.fields, "price") ?? src?.price ?? undefined;
  // POS gate: suppress the price ($) if the linked drink is 86'd / off-POS (0034). The
  // whole card is normally auto-hidden upstream too, but parity keeps this self-safe.
  const posHidden = !!src && (src.out_of_stock || src.pos_visible === false);

  // Custom image (Phase 8) — shown in the square, above the title. Wins over drink photo.
  const customImg = fstr(item.fields, "image_url");
  const align = alignOf(item.fields);

  const linkEl = cta
    ? <span style={{ fontSize: z.body * 1.2, fontWeight: 700, letterSpacing: 2 }}>{cta}</span>
    : linkedName ? <span className="sig-live" style={{ fontSize: Math.round(headlineFont(linkedName, orientation) * 0.5), fontWeight: 700 }}>{linkedName}</span> : null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", gap: z.gap, ...alignStyle(align) }}>
      <div style={{ fontSize: z.eyebrow, letterSpacing: 6, opacity: 0.7 }}>▸ ON NOW — PROMO WINDOW</div>
      {customImg && <SquarePhoto src={customImg} size={EVT_IMG[orientation]} feed="OPTICAL FEED" />}
      <div style={{ fontSize: headlineFont(title, orientation), fontWeight: 700, lineHeight: 0.9, textTransform: "uppercase", textShadow: "0 0 16px var(--terminal-glow)" }}><Lines text={title} /></div>
      {time && <div style={{ fontSize: z.time, fontWeight: 700, lineHeight: 0.85, textShadow: "0 0 24px var(--terminal-glow)" }}>{time}</div>}
      {body && <div style={{ fontSize: z.body, opacity: 0.9, lineHeight: 1.35, maxWidth: "84%" }}><Lines text={body} /></div>}
      {(linkEl || (price != null && !posHidden)) && (
        <>
          <div style={{ borderTop: "1px solid var(--terminal-glow)", width: "60%", margin: `${z.gap * 0.4}px 0` }} />
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 28, flexWrap: "wrap" }}>
            {linkEl}
            {price != null && !posHidden && (
              <span className="sig-live" style={{ fontSize: z.price, fontWeight: 700, lineHeight: 0.85, textShadow: "0 0 18px var(--terminal-glow)" }}>
                <small style={{ fontSize: z.price * 0.5, verticalAlign: "top" }}>$</small>{formatPrice(price)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Active MESSAGE card — generic chrome, no price block unless a drink is linked. */
export function EventMessageCard({ item, toast, orientation }: { item: SignageItem; toast: Map<string, ToastCacheRow>; orientation: Orientation }) {
  const z = SIZES[orientation];
  const ev = item.event;
  const src = ev?.toast_guid ? toast.get(ev.toast_guid) : undefined;
  const title = fstr(item.fields, "title") ?? ev?.name ?? "A MESSAGE";
  const body = fstr(item.fields, "body") ?? fstr(item.fields, "message");
  const price = fnum(item.fields, "price") ?? src?.price ?? undefined;
  const customImg = fstr(item.fields, "image_url");
  const align = alignOf(item.fields);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: z.gap, ...alignStyle(align) }}>
      <div style={{ fontSize: z.eyebrow, letterSpacing: 6, opacity: 0.7 }}>◈ SHELTER BULLETIN</div>
      {customImg && <SquarePhoto src={customImg} size={EVT_IMG[orientation]} feed="OPTICAL FEED" />}
      <div style={{ fontSize: headlineFont(title, orientation), fontWeight: 700, lineHeight: 0.92, textTransform: "uppercase", textShadow: "0 0 16px var(--terminal-glow)" }}>{parseInline(title)}</div>
      {body && <div style={{ fontSize: z.body * 1.15, opacity: 0.9, lineHeight: 1.45, maxWidth: "84%" }}><Lines text={body} /></div>}
      {price != null && src?.name && (
        <div style={{ fontSize: z.body, marginTop: z.gap }}>
          <span className="sig-live">{src.name}</span> · <span className="sig-live"><small>$</small>{formatPrice(price)}</span>
        </div>
      )}
    </div>
  );
}

/** MOMENT TEASE interstitial — amber, mockup stage 2 (12s, injected every ~4th turn). */
export function EventTeaseCard({ event, orientation }: { event: LiveEvent; orientation: Orientation }) {
  const z = SIZES[orientation];
  const sk = skinOf(event.skin);
  const eyebrow = fstr(event.fields, "tease_eyebrow") ?? sk.teaseEyebrow;
  const body = fstr(event.fields, "tease_body") ?? sk.teaseBody;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: z.gap }}>
      <div style={{ border: "1px dashed var(--terminal-green)", padding: z.pad * 0.6, display: "flex", flexDirection: "column", gap: z.gap }}>
        <div style={{ fontSize: z.eyebrow, letterSpacing: 4, opacity: 0.85 }}>{eyebrow}</div>
        <div style={{ fontSize: z.body * 1.2, lineHeight: 1.5, opacity: 0.95 }}>{body}</div>
      </div>
      <div style={{ fontSize: z.body * 0.72, opacity: 0.55, letterSpacing: 1 }}>◊ STANDING BY — {event.name.toUpperCase()}</div>
    </div>
  );
}

/* Re-export the stage type for callers. */
export type { EventStage };
