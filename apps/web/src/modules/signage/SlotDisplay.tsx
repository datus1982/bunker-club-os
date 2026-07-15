import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { DisplayCanvas } from "@/shared/DisplayCanvas";
import { supabase } from "@/shared/supabaseClient";
import { LeaderboardBoard } from "@/modules/trivia/Leaderboard";
import { GameDisplayBoard } from "@/modules/trivia/GameDisplay";
import {
  useSlot, useLiveEvents, resolveRotation, resolveSlotMode, activeMoment, teaseMoment,
  type SignageItem, type Slot, type SlotMode, type Takeover, type ToastCacheRow, type LiveEvent,
} from "./useSignage";
import { useTicker, type TickerLine } from "./useTicker";
import { TemplateView } from "./SignageTemplates";
import { EventStageView, EventTeaseCard } from "./EventStages";
import "./signage.css";

type ToastMap = Map<string, ToastCacheRow>;

/**
 * PUBLIC signage slot page — /signage/s/:slug (docs/09 "Screens & scheduling").
 *
 * A physical screen is pointed here once, permanently, in kiosk mode. The page
 * resolves its own mode by priority:
 *   1. TAKEOVER   — an active screen_takeovers row overrides everything.
 *   2. LIVE GAME  — any venue game active/paused → the trivia board (portrait →
 *                   leaderboard, landscape → game display); one-shot boot + green re-theme.
 *   3. ROTATION   — active signage_items in their windows, + ★ SCREENS auto-materialized,
 *                   minus 86'd items; amber ambient ink with green live-feed accents.
 * Renders through DisplayCanvas (fixed canvas, `?calibrate`, nightly reload).
 *
 * `?preview=1` (staff "Preview slot") forces ROTATION — it ignores takeover + live
 * game so the authored rotation can be inspected regardless of live venue state.
 * // DECISION: added because a stale/live game would otherwise pin every screen to
 * // game mode, making rotation impossible to preview; it is read-only and public-safe.
 */
export function SlotDisplay() {
  const { slug = "" } = useParams();
  const { venue, slot, items, takeover, liveGame, toast } = useSlot(slug);
  useHeartbeat(slug);

  if (slot.isPending || venue.isPending) {
    return <MessageCanvas title="SYNCING" subtitle="◊ SHELTER AUTHORITY UPLINK" />;
  }
  if (!slot.data) {
    return <MessageCanvas title="NO SUCH SLOT" subtitle={`SLUG "${slug}" NOT PROVISIONED`} />;
  }

  const s = slot.data;
  return (
    <DisplayCanvas orientation={s.orientation} overscanInsetPct={s.overscan_inset_pct} scaleAdjust={s.scale_adjust}>
      <SlotScreen
        slot={s}
        venueName={venue.data?.name ?? "BUNKER CLUB"}
        timezone={venue.data?.timezone ?? "America/Chicago"}
        items={items.data ?? []}
        takeover={takeover.data ?? null}
        liveGameId={liveGame.data?.id ?? null}
        toast={toast.data ?? new Map()}
      />
    </DisplayCanvas>
  );
}

type Mode = SlotMode;

function SlotScreen({
  slot, venueName, timezone, items, takeover, liveGameId, toast,
}: {
  slot: Slot;
  venueName: string;
  timezone: string;
  items: SignageItem[];
  takeover: Takeover | null;
  liveGameId: string | null;
  toast: ToastMap;
}) {
  const [params] = useSearchParams();
  const preview = params.has("preview");

  const events = useLiveEvents();
  const liveEvents = events.data ?? [];

  // Re-evaluate item time-windows AND event stages on a slow tick (perf: 30s, well above
  // the sub-30s floor). Stage BOUNDARIES that need second-precision (the ALERT countdown,
  // the MOMENT payoff) are handled by the stage components' own 1s local clock.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(nowTick), [nowTick]);

  const rotation = useMemo(
    () => resolveRotation(items, toast, now, liveEvents),
    [items, toast, now, liveEvents],
  );

  // MOMENT in a takeover-level stage (alert/moment/event/allclear) + the tease lead-in.
  const moment = useMemo(() => activeMoment(liveEvents, now), [liveEvents, now]);
  const tease = useMemo(() => teaseMoment(liveEvents, now), [liveEvents, now]);

  const activeTakeover = preview ? null : takeover;
  const gameOn = preview ? false : !!liveGameId;
  // Preview is rotation-only: zero the takeover-level moment (like takeover/game). Window
  // and message cards + the tease interstitial still show — they are rotation-level.
  const activeMomentOpt = preview || !moment ? null : { stage: moment.stage, interruptGame: moment.event.interrupt_game };
  const mode: Mode = resolveSlotMode({ takeover: !!activeTakeover, liveGame: gameOn, moment: activeMomentOpt });

  // Ink: game → green; takeover inherits the ink underneath (green if a game is live,
  // else amber); event stages + rotation → amber ambient with green live accents. (docs/09)
  const ink: "green" | "amber" = mode === "game" ? "green" : mode === "takeover" && !!liveGameId ? "green" : "amber";

  // One-shot GAME MODE boot transition when entering game mode (docs/09).
  const prevMode = useRef<Mode>(mode);
  const [showBoot, setShowBoot] = useState(false);
  useEffect(() => {
    if (mode === "game" && prevMode.current !== "game") {
      setShowBoot(true);
      const id = window.setTimeout(() => setShowBoot(false), 1500);
      prevMode.current = mode;
      return () => window.clearTimeout(id);
    }
    prevMode.current = mode;
  }, [mode]);

  const ticker = useTicker({ events: liveEvents, timezone });

  return (
    <div className={`signage-slot signage-${ink}`} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", color: "var(--terminal-green)", background: "#000" }}>
      {/* Game mode replaces the surface with the reused trivia board (no chrome). */}
      {mode === "game" ? (
        <div style={{ position: "absolute", inset: 0 }}>
          {slot.orientation === "portrait" ? (
            <LeaderboardBoard overrideGameId={liveGameId} />
          ) : (
            <GameDisplayBoard overrideGameId={liveGameId} />
          )}
          {showBoot && <BootOverlay />}
        </div>
      ) : (
        <>
          <ChromeHeader slot={slot} venueName={venueName} timezone={timezone} />
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            {mode === "event" && moment ? (
              // MOMENT holds the surface (skin-framed stage), chrome + ticker retained.
              <div className="sig-enter" style={{ position: "absolute", inset: 0, padding: slot.orientation === "portrait" ? "24px 40px 40px" : "18px 48px 32px" }}>
                <EventStageView event={moment.event} stage={moment.stage} orientation={slot.orientation} toast={toast} />
              </div>
            ) : (
              <Rotation slot={slot} rotation={rotation} toast={toast} teaseEvent={tease} venueName={venueName} />
            )}
          </div>
          <ChromeFooter ticker={ticker} live={mode !== "rotation"} orientation={slot.orientation} />
        </>
      )}

      {mode === "takeover" && activeTakeover && <TakeoverOverlay takeover={activeTakeover} />}

      {/* Static scanline + vignette (docs/09) come from the shared `.terminal-theme`
          overlays that DisplayCanvas already renders over the whole surface — no extra
          panel-level pass (stacking two dims the ink to brown). */}
    </div>
  );
}

/* ── Rotation ───────────────────────────────────────────────────────────────── */
function Rotation({ slot, rotation, toast, teaseEvent, venueName }: { slot: Slot; rotation: SignageItem[]; toast: ToastMap; teaseEvent: LiveEvent | null; venueName: string }) {
  const [index, setIndex] = useState(0);
  // `turn` counts every slot advance. A MOMENT TEASE interstitial takes the every-4th turn
  // (turn % 4 === 3 ≈ once per ~4 min), pausing the content index so nothing is skipped.
  const [turn, setTurn] = useState(0);
  const teaseTurn = !!teaseEvent && turn % 4 === 3;

  const len = rotation.length;
  useEffect(() => {
    if (index >= len && len > 0) setIndex(0);
  }, [len, index]);

  // Advance on a finite timeout re-armed each turn. Keep ticking if there is >1 rotation
  // item OR a tease to interleave; a tease turn is a fixed 12s (mockup), else item duration.
  const current = teaseTurn ? null : rotation[index];
  useEffect(() => {
    const canAdvance = len > 1 || (!!teaseEvent && len >= 1);
    if (!canAdvance) return;
    const secs = teaseTurn ? 12 : Math.max(4, current?.duration_seconds ?? 12);
    const id = window.setTimeout(() => {
      setTurn((t) => t + 1);
      // Only advance content past a content turn — a tease turn borrows the slot in place.
      if (!teaseTurn && len > 0) setIndex((i) => (i + 1) % len);
    }, secs * 1000);
    return () => window.clearTimeout(id);
  }, [turn, teaseTurn, len, teaseEvent, current?.duration_seconds]);

  // Owner design-beat 2026-07-15 ("a rather large buffer between the divider and the first
  // content"): halve the TOP padding of the content zone so every rotation template gains
  // usable canvas right under the chrome divider. Bottom padding is kept full — the
  // drink_special category row rides down INTO it via a negative marginBottom, so shrinking
  // it there would clip the category. Written as explicit top/right/bottom/left (was the
  // "56px 48px" / "44px 56px" shorthand) to move only the top edge.
  const padByOrientation = slot.orientation === "portrait" ? "26px 48px 56px" : "20px 56px 44px";

  // Empty rotation: STANDBY — unless a tease is due this turn (it can ride an empty board).
  if (len === 0 && !teaseTurn) {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 24 }}>
        <div style={{ fontSize: slot.orientation === "portrait" ? 96 : 84, fontWeight: 700, letterSpacing: 4 }}>STANDBY</div>
        <div style={{ fontSize: 40, opacity: 0.6 }}>◊ NO ACTIVE BROADCASTS — SHELTER NOMINAL</div>
      </div>
    );
  }

  const contentKey = teaseTurn ? `tease:${teaseEvent!.id}:${turn}` : current?.id ?? index;

  return (
    <div key={contentKey} className="sig-enter" style={{ position: "absolute", inset: 0, padding: padByOrientation, display: "flex", flexDirection: "column" }}>
      {teaseTurn && teaseEvent
        ? <EventTeaseCard event={teaseEvent} orientation={slot.orientation} />
        : current && <TemplateView item={current} toast={toast} orientation={slot.orientation} venueName={venueName} />}
    </div>
  );
}

/* ── Chrome ─────────────────────────────────────────────────────────────────── */
function ChromeHeader({ slot, venueName, timezone }: { slot: Slot; venueName: string; timezone: string }) {
  const clock = useClock(timezone);
  // Owner design-beat: render the location separator ONLY when a label exists (it is now
  // nulled venue-wide, which otherwise left a dangling "— ·").
  const label = (slot.location_label ?? "").trim().toUpperCase();
  const terminalLine = `TERMINAL ${String(slot.terminal_number ?? 0).padStart(2, "0")}${label ? ` — ${label}` : ""} · ${clock}`;
  return (
    // Owner design-beats: header BAR height is right, but the content grows into the
    // negative space (2026-07-14: "reduce some of the negative space and bump the text
    // and logo sizes") — padding 13 → 8px vertical while roundel 52 → 64, wordmark
    // 56 → 68, right block 24 → 30 w/ tighter leading: net bar height ~unchanged.
    // Chrome rule stays dim green (--sig-rule); body ink stays amber.
    <header style={{ flexShrink: 0, borderBottom: "2px solid var(--sig-rule)", padding: "8px 40px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        {/* Official white 1-color roundel — used byte-identical, NEVER recolored (brand rule).
            An external SVG in an <img> is isolated from the terminal-theme cascade, so it
            stays white-on-dark (correct on the amber CRT). Sized to the wordmark cap height. */}
        <img src="/brand/roundel-white.svg" alt="" style={{ height: 64, width: "auto", display: "block", flexShrink: 0 }} />
        <div style={{ fontSize: 68, fontWeight: 700, letterSpacing: 2, textShadow: "0 0 10px var(--terminal-glow)" }}>{venueName.toUpperCase()}</div>
      </div>
      <div style={{ fontSize: 30, opacity: 0.75, textAlign: "right", lineHeight: 1.35 }}>
        BUNKER UNIFIED OS v2.1<br />
        {terminalLine}
      </div>
    </header>
  );
}

// Owner design-beat 2026-07-14 ("the scroll text could be larger, fill the space more"): the
// reprint line is sized up to genuinely fill the footer bar and read at 20 feet. The bar
// height is governed by BASE (a transform-scale never shrinks the layout box), so both
// orientations keep a consistent taller bar; the markers ride the same base for proportion.
const TICKER_BASE: Record<"portrait" | "landscape", number> = { portrait: 46, landscape: 42 };

function ChromeFooter({ ticker, live, orientation }: { ticker: TickerLine[]; live: boolean; orientation: "portrait" | "landscape" }) {
  const [ti, setTi] = useState(0);
  useEffect(() => {
    if (ticker.length <= 1) return;
    const id = window.setInterval(() => setTi((i) => (i + 1) % ticker.length), 9000);
    return () => window.clearInterval(id);
  }, [ticker.length]);
  const line = ticker[ti % Math.max(1, ticker.length)] ?? { text: "", live: false };
  const base = TICKER_BASE[orientation];

  return (
    // Owner design-beat: chrome rule shifted to dim green (--sig-rule); ticker sized up.
    <footer style={{ flexShrink: 0, borderTop: "2px solid var(--sig-rule)", padding: "16px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, fontSize: base }}>
      {/* Dual-phosphor: the ON AIR / LIVE status light is a live-state indicator, so it
          reads green like the mockup's `.cbot .now` — a single restrained green accent. */}
      {/* fontSize is explicit on these spans: the global `.terminal-theme span` 1.5rem rule
          beats the footer's inherited size, which left the status chip small when the
          reprint line grew (owner note 2026-07-14). */}
      <span className="sig-live" style={{ flexShrink: 0, fontSize: base }}>{live ? "■ ON AIR" : "■ ONLINE"}</span>
      {/* Green ◆ chrome marker (owner: "the ticker's ◆ markers can go green too"). */}
      <span className="sig-live" style={{ flexShrink: 0, opacity: 0.85, fontSize: base }}>◆</span>
      {/* Reprint (key-remount) — no scroll animation (docs/09 perf + authenticity). Shrink-to-fit
          guard: the line renders at BASE and, only if it would overflow, scales down uniformly
          so the longest real line (or an extreme manual line) stays ONE line and never clips. */}
      <TickerReprint key={ti} line={line} base={base} />
    </footer>
  );
}

/** One reprinted ticker line, sized to fill the bar and measured-scaled to never wrap/clip.
 *  CSS transforms do NOT change offsetWidth (a pre-transform layout metric), so the natural
 *  width at BASE is read directly and the scale set in one pass — no reset-flicker. The
 *  fixed canvas means clientWidth is stable (DisplayCanvas scales the whole surface), so no
 *  resize listener is needed. */
function TickerReprint({ line, base }: { line: TickerLine; base: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const box = boxRef.current, span = spanRef.current;
    if (!box || !span) return;
    const avail = box.clientWidth;
    const need = span.offsetWidth; // natural width at BASE (transform-independent)
    setScale(avail > 0 && need > avail ? avail / need : 1);
  }, [line.text, base]);
  return (
    <div ref={boxRef} style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
      <span
        ref={spanRef}
        className={`sig-enter${line.live ? " sig-live" : ""}`}
        style={{ display: "inline-block", whiteSpace: "nowrap", fontSize: base, transform: `scale(${scale})`, transformOrigin: "left center" }}
      >
        {line.text}
      </span>
    </div>
  );
}

/* ── Takeover overlay ───────────────────────────────────────────────────────── */
// DECISION: docs/09 color-state says takeovers are "inverse-video in the current ink";
// the frame mockup renders them as a dark panel with a 6px double-ink border + ink
// glow (its actual design language). Followed the MOCKUP (dark panel + double border),
// which reads unambiguously as priority; literal ink-filled inverse was the alternative.
function TakeoverOverlay({ takeover }: { takeover: Takeover }) {
  return (
    <div className="sig-enter" style={{ position: "absolute", inset: 0, zIndex: 50, background: "#04070a", border: "6px double var(--terminal-green)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 48, gap: 28, boxShadow: "inset 0 0 120px var(--terminal-glow)" }}>
      <div style={{ fontSize: 30, letterSpacing: 8, opacity: 0.8 }}>■ PRIORITY BROADCAST — ALL TERMINALS ■</div>
      <div style={{ fontSize: 140, fontWeight: 700, lineHeight: 0.95, textTransform: "uppercase", textShadow: "0 0 24px var(--terminal-glow)" }}>{takeover.message}</div>
      {takeover.sub_message && <div style={{ fontSize: 40, opacity: 0.85, lineHeight: 1.4, maxWidth: "80%" }}>{takeover.sub_message}</div>}
    </div>
  );
}

/* ── Game-mode boot transition ──────────────────────────────────────────────── */
function BootOverlay() {
  return (
    <div className="sig-enter" style={{ position: "absolute", inset: 0, zIndex: 60, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
      <div className="sig-boot" style={{ fontSize: 120, fontWeight: 700, letterSpacing: 6, color: "#00ff41", textShadow: "0 0 24px rgba(0,255,65,.6)" }}>GAME MODE ENGAGED</div>
      <div style={{ fontSize: 36, opacity: 0.7, color: "#00ff41" }}>◊ SWITCHING TO LIVE FEED…</div>
    </div>
  );
}

/* ── Bare canvas for loading / not-found ────────────────────────────────────── */
function MessageCanvas({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <DisplayCanvas orientation="portrait">
      <div className="signage-slot signage-amber" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 24, color: "var(--terminal-green)" }}>
        <div style={{ fontSize: 100, fontWeight: 700, letterSpacing: 4 }}>{title}</div>
        <div style={{ fontSize: 42, opacity: 0.7 }}>{subtitle}</div>
      </div>
    </DisplayCanvas>
  );
}

/* ── hooks ──────────────────────────────────────────────────────────────────── */
/** Screen-health ping: bump this slot's last_seen every 60s (docs/09 / docs/12). */
function useHeartbeat(slug: string) {
  useEffect(() => {
    if (!slug) return;
    // NB: the PostgREST builder is lazy — it only sends the request once `.then()` is
    // invoked, so `void supabase.rpc(...)` alone never fires. Attach a noop handler.
    const beat = () => { supabase.rpc("signage_heartbeat", { p_slug: slug }).then(undefined, () => {}); };
    beat();
    const id = window.setInterval(beat, 60_000);
    return () => window.clearInterval(id);
  }, [slug]);
}

/** Live clock in the venue timezone; ticks each second (local timer, no network). */
function useClock(timezone: string): string {
  const [t, setT] = useState("");
  useEffect(() => {
    const fmt = () =>
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date());
    setT(fmt());
    const id = window.setInterval(() => setT(fmt()), 1000);
    return () => window.clearInterval(id);
  }, [timezone]);
  return t;
}
