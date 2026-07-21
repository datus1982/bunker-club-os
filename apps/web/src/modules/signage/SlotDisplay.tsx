import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { DisplayCanvas } from "@/shared/DisplayCanvas";
import { supabase } from "@/shared/supabaseClient";
import { LeaderboardBoard } from "@/modules/trivia/Leaderboard";
import { GameDisplayBoard } from "@/modules/trivia/GameDisplay";
import {
  useSlot, useLiveEvents, resolveRotation, resolveSlotMode, activeMoment, teaseMoment,
  useNowPlayingSources, nowPlayingSourceSlug, isNowPlayingFresh,
  type SignageItem, type Slot, type SlotMode, type Takeover, type ToastCacheRow, type LiveEvent, type Orientation,
} from "./useSignage";
import { useTicker, type TickerLine } from "./useTicker";
import { TemplateView } from "./SignageTemplates";
import { EventStageView, EventTeaseCard } from "./EventStages";
import { PlaylistProgram } from "./PlaylistProgram";
import { CaptureProgram } from "./CaptureProgram";
import { MultiviewProgram } from "./MultiviewProgram";
import { resolveMediaBase } from "./mediaProgram";
import { resolveEffectiveProgram, nextTransition, type ScheduleRow } from "./scheduleResolve";
import { SUPPORT_TEXT } from "./supportText";
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
  const { venue, slot, items, takeover, liveGame, toast, schedule, closeoutHour } = useSlot(slug);
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
        schedule={schedule.data ?? []}
        rolloverHour={closeoutHour.data ?? 4}
      />
    </DisplayCanvas>
  );
}

type Mode = SlotMode;

function SlotScreen({
  slot, venueName, timezone, items, takeover, liveGameId, toast, schedule, rolloverHour,
}: {
  slot: Slot;
  venueName: string;
  timezone: string;
  items: SignageItem[];
  takeover: Takeover | null;
  liveGameId: string | null;
  toast: ToastMap;
  schedule: ScheduleRow[];
  rolloverHour: number;
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

  // NOW PLAYING gate (0054): the source screens any now_playing card reads, and which of them have
  // a FRESH film right now. resolveRotation auto-hides a now_playing card whose source is not live
  // (movie ended / trivia took the landscape). The template renders its own copy of this data; the
  // shared query key dedupes the request when there is a single source (the common case).
  const npSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.template === "now_playing") set.add(nowPlayingSourceSlug(it));
    return [...set];
  }, [items]);
  const nowPlayingSources = useNowPlayingSources(npSlugs);
  const liveNowPlayingSlugs = useMemo(() => {
    const s = new Set<string>();
    nowPlayingSources.data?.forEach((v, slug) => { if (isNowPlayingFresh(v.at, now)) s.add(slug); });
    return s;
  }, [nowPlayingSources.data, now]);

  // M3 (D3/D4): precise re-render at the next schedule boundary / hold expiry, so a daypart flip
  // or an override yielding is crisp (not up to 30s late). The 30s tick above is the safety net.
  useEffect(() => {
    const trans = nextTransition(
      { program: slot.program, program_hold: slot.program_hold, program_set_at: slot.program_set_at },
      schedule, new Date(nowTick), timezone, rolloverHour,
    );
    if (!trans) return;
    const ms = trans.getTime() - Date.now();
    if (ms <= 0) { setNowTick(Date.now()); return; }
    // Cap to a setTimeout-safe delay; the 30s tick re-arms this well before any cap matters.
    const id = window.setTimeout(() => setNowTick(Date.now()), Math.min(ms + 500, 2_000_000_000));
    return () => window.clearTimeout(id);
  }, [nowTick, schedule, timezone, rolloverHour, slot.program, slot.program_hold, slot.program_set_at]);

  const rotation = useMemo(
    () => resolveRotation(items, toast, now, liveEvents, liveNowPlayingSlugs),
    [items, toast, now, liveEvents, liveNowPlayingSlugs],
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

  // PiP ad feed for the trivia HIDE-SCORES hold (owner beat 2026-07-16): a mini copy of the
  // NORMAL rotation surface (chrome + rotation + ticker) at the real portrait canvas size, so
  // the leaderboard board can inset it while the host holds and ads keep running. It is only
  // MOUNTED when portrait game mode is live AND board_stage === 'scoring' (LeaderboardBoard
  // decides), so the Rotation timers below don't run outside the hold. Built portrait-only —
  // landscape game mode uses GameDisplayBoard, which has no board stages. It reuses the exact
  // `rotation`/`tease`/`ticker` the normal screen would show, so every gate (POS/86, windows,
  // dwell) already applies.
  const pipSurface =
    slot.orientation === "portrait" ? (
      <RotationSurface slot={slot} venueName={venueName} timezone={timezone} rotation={rotation} toast={toast} tease={tease} ticker={ticker} />
    ) : null;

  // PROGRAM tier (docs/15): the EFFECTIVE program renders INSIDE rotation mode (the bottom of the
  // ladder) — so takeover/moment/game already preempt it (mode !== 'rotation' unmounts it, and the
  // <video>/capture stops with it). The effective program is the M3 resolution (D3/D4): an unexpired
  // manual override (pin/boundary/event hold) wins, else the active scheduled daypart, else rotation.
  // In ?preview mode there is no schedule/override reasoning — show the raw authored rotation.
  const effProgram = useMemo(
    () => preview ? null : resolveEffectiveProgram(
      { program: slot.program, program_hold: slot.program_hold, program_set_at: slot.program_set_at },
      schedule, now, timezone, rolloverHour,
    ),
    [preview, slot.program, slot.program_hold, slot.program_set_at, schedule, now, timezone, rolloverHour],
  );
  const programPlaylistId =
    mode === "rotation" && effProgram?.kind === "playlist" ? effProgram.playlist_id : null;
  // CAPTURE program (M2): the live UVC input renders in the same rotation-bottom slot as playlist.
  const programCapture =
    mode === "rotation" && effProgram?.kind === "capture" ? effProgram : null;
  // MULTIVIEW program (M3): landscape only (the 1312+608 geometry assumes the 1920×1080 canvas);
  // a portrait slot never carries multiview, but gate defensively so it falls back to rotation.
  const programMultiview =
    mode === "rotation" && slot.orientation === "landscape" && effProgram?.kind === "multiview" ? effProgram : null;
  const mediaBase = useMemo(() => resolveMediaBase(params), [params]);

  return (
    <div className={`signage-slot signage-${ink}`} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", color: "var(--terminal-green)", background: "#000" }}>
      {/* Game mode replaces the surface with the reused trivia board (no chrome). */}
      {mode === "game" ? (
        <div style={{ position: "absolute", inset: 0 }}>
          {slot.orientation === "portrait" ? (
            <LeaderboardBoard overrideGameId={liveGameId} holdInset={pipSurface} />
          ) : (
            <GameDisplayBoard overrideGameId={liveGameId} />
          )}
          {showBoot && <BootOverlay />}
        </div>
      ) : programPlaylistId ? (
        // Playlist program: framed keeps the chrome, fullbleed hides it (PlaylistProgram decides
        // from the playlist's presentation toggle). The <video> unmounts the moment mode flips.
        // renderHeader flows the playing film's NOW SHOWING title into the header's center.
        <PlaylistProgram
          slot={slot}
          playlistId={programPlaylistId}
          base={mediaBase}
          renderHeader={(nowShowing) => <ChromeHeader slot={slot} venueName={venueName} timezone={timezone} nowShowing={nowShowing} slim />}
          footer={<ChromeFooter ticker={ticker} live={false} orientation={slot.orientation} slim />}
        />
      ) : programCapture ? (
        // Capture program (M2): fullbleed by default (no chrome), framed override keeps it. The
        // MediaStream tracks stop on unmount the moment a takeover/moment/game flips mode off.
        <CaptureProgram
          slot={slot}
          deviceMatch={programCapture.device_match}
          presentation={programCapture.presentation}
          header={<ChromeHeader slot={slot} venueName={venueName} timezone={timezone} slim />}
          footer={<ChromeFooter ticker={ticker} live={false} orientation={slot.orientation} slim />}
        />
      ) : programMultiview ? (
        // MULTIVIEW (M3): 16:9 main (playlist|capture) + a portrait PANEL running rotation. Always
        // framed (D7). Preempted whole (D9) — this branch only renders while mode==='rotation'.
        <MultiviewProgram
          main={programMultiview.main}
          panelSlotId={programMultiview.panel_slot_id}
          hostSlug={slot.slug}
          base={mediaBase}
          renderHeader={(nowShowing) => <ChromeHeader slot={slot} venueName={venueName} timezone={timezone} nowShowing={nowShowing} />}
          footer={<ChromeFooter ticker={ticker} live={false} orientation={slot.orientation} />}
          venueName={venueName}
          timezone={timezone}
          toast={toast}
          liveEvents={liveEvents}
          ticker={ticker}
          now={now}
        />
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

      {mode === "takeover" && activeTakeover && <TakeoverOverlay takeover={activeTakeover} orientation={slot.orientation} />}

      {/* Static scanline + vignette (docs/09) come from the shared `.terminal-theme`
          overlays that DisplayCanvas already renders over the whole surface — no extra
          panel-level pass (stacking two dims the ink to brown). */}
    </div>
  );
}

/* ── Rotation surface (normal screen: chrome + rotation + ticker) ─────────────── */
/**
 * The NORMAL non-game rotation surface as a self-contained node — chrome header, the
 * live rotation content zone, and the ticker footer, filling its parent. Mirrors the layout
 * of SlotScreen's own rotation branch, packaged so it can be handed to the trivia leaderboard
 * board as the HIDE-SCORES PiP inset (BEAT 2, owner 2026-07-16): the board scales this down
 * into an ad panel while the host holds, so promos keep cycling. Because it reuses the exact
 * resolved `rotation`/`tease`/`ticker`, every gate (POS/86, time windows, dwell) already
 * applies. Always amber ink (rotation ink), independent of the green game board it embeds
 * beside. (The live rotation branch stays inline in SlotScreen since it also handles the
 * MOMENT-stage surface, which this rotation-only node deliberately does not.)
 */
export function RotationSurface({
  slot, venueName, timezone, rotation, toast, tease, ticker,
}: {
  slot: Slot;
  venueName: string;
  timezone: string;
  rotation: SignageItem[];
  toast: ToastMap;
  tease: LiveEvent | null;
  ticker: TickerLine[];
}) {
  return (
    <div className="signage-slot signage-amber" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", color: "var(--terminal-green)", background: "#000" }}>
      <ChromeHeader slot={slot} venueName={venueName} timezone={timezone} />
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <Rotation slot={slot} rotation={rotation} toast={toast} teaseEvent={tease} venueName={venueName} />
      </div>
      <ChromeFooter ticker={ticker} live={false} orientation={slot.orientation} />
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
function ChromeHeader({ slot, venueName, timezone, nowShowing, slim }: { slot: Slot; venueName: string; timezone: string; nowShowing?: ReactNode; slim?: boolean }) {
  const clock = useClock(timezone);
  // Owner design-beat: render the location separator ONLY when a label exists (it is now
  // nulled venue-wide, which otherwise left a dangling "— ·").
  const label = (slot.location_label ?? "").trim().toUpperCase();
  const terminalLine = `TERMINAL ${String(slot.terminal_number ?? 0).padStart(2, "0")}${label ? ` — ${label}` : ""} · ${clock}`;
  // Beat 5 (owner 2026-07-20): framed MEDIA playback uses a SLIM header — cut the vertical padding
  // hard and shrink the roundel/wordmark/right block so the NOW SHOWING title carries the bar and
  // the video gets the space. This variant is used ONLY by framed playlist/capture (NOT rotation
  // slides, whose chrome is ratified, and NOT multiview, whose 171px band is ratified D1).
  return (
    // Owner design-beats: header BAR height is right, but the content grows into the
    // negative space (2026-07-14: "reduce some of the negative space and bump the text
    // and logo sizes") — padding 13 → 8px vertical while roundel 52 → 64, wordmark
    // 56 → 68, right block 24 → 30 w/ tighter leading: net bar height ~unchanged.
    // Chrome rule stays dim green (--sig-rule); body ink stays amber.
    // `nowShowing` (owner beat 2026-07-20) rides the header's unused CENTER width for a framed
    // playlist / multiview main — a flex middle child, so the left/right blocks keep their size
    // (flexShrink:0) and the film title takes the slack (never a second bar).
    <header style={{ flexShrink: 0, borderBottom: "2px solid var(--sig-rule)", padding: slim ? "3px 24px" : "8px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: slim ? 16 : 24 }}>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: slim ? 12 : 22 }}>
        {/* Official white 1-color roundel — used byte-identical, NEVER recolored (brand rule).
            An external SVG in an <img> is isolated from the terminal-theme cascade, so it
            stays white-on-dark (correct on the amber CRT). Sized to the wordmark cap height. */}
        <img src="/brand/roundel-white.svg" alt="" style={{ height: slim ? 30 : 64, width: "auto", display: "block", flexShrink: 0 }} />
        <div style={{ fontSize: slim ? 28 : 68, fontWeight: 700, letterSpacing: 2, textShadow: "0 0 10px var(--terminal-glow)" }}>{venueName.toUpperCase()}</div>
      </div>
      {nowShowing}
      {slim ? (
        <div style={{ flexShrink: 0, fontSize: 22, opacity: 0.7, textAlign: "right", whiteSpace: "nowrap" }}>{terminalLine}</div>
      ) : (
        <div style={{ flexShrink: 0, fontSize: 30, opacity: 0.75, textAlign: "right", lineHeight: 1.35 }}>
          BUNKER UNIFIED OS v2.1<br />
          {terminalLine}
        </div>
      )}
    </header>
  );
}

// Owner design-beat 2026-07-14 ("the scroll text could be larger, fill the space more"): the
// reprint line is sized up to genuinely fill the footer bar and read at 20 feet. The bar
// height is governed by BASE (a transform-scale never shrinks the layout box), so both
// orientations keep a consistent taller bar; the markers ride the same base for proportion.
const TICKER_BASE: Record<"portrait" | "landscape", number> = { portrait: 46, landscape: 42 };
// Beat 5: slim framed-media footer — the ticker stays (framed keeps its ticker, ratified) but at a
// reduced height. Sized DOWN TO but never below the shared SUPPORT_TEXT floor (portrait 40 /
// landscape 32) — "a smudge" smaller, floor-respecting.
// NOTE-4: derive BOTH entries from the shared SUPPORT_TEXT floor so a future floor change can't
// silently strand landscape at a stale literal. Slim ticker sits at (or a smudge above) the floor.
const TICKER_BASE_SLIM: Record<"portrait" | "landscape", number> = {
  portrait: SUPPORT_TEXT.portrait,
  landscape: Math.max(SUPPORT_TEXT.landscape, 34),
};

function ChromeFooter({ ticker, live, orientation, slim }: { ticker: TickerLine[]; live: boolean; orientation: "portrait" | "landscape"; slim?: boolean }) {
  const [ti, setTi] = useState(0);
  useEffect(() => {
    if (ticker.length <= 1) return;
    const id = window.setInterval(() => setTi((i) => (i + 1) % ticker.length), 9000);
    return () => window.clearInterval(id);
  }, [ticker.length]);
  const line = ticker[ti % Math.max(1, ticker.length)] ?? { text: "", live: false };
  const base = (slim ? TICKER_BASE_SLIM : TICKER_BASE)[orientation];

  return (
    // Owner design-beat: chrome rule shifted to dim green (--sig-rule); ticker sized up.
    // Beat 5: slim variant cuts the padding hard for framed media (keeps the ticker, smaller bar).
    <footer style={{ flexShrink: 0, borderTop: "2px solid var(--sig-rule)", padding: slim ? "5px 24px" : "16px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: slim ? 16 : 24, fontSize: base }}>
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
function TakeoverOverlay({ takeover, orientation }: { takeover: Takeover; orientation: Orientation }) {
  return (
    <div className="sig-enter" style={{ position: "absolute", inset: 0, zIndex: 50, background: "#04070a", border: "6px double var(--terminal-green)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 48, gap: 28, boxShadow: "inset 0 0 120px var(--terminal-glow)" }}>
      {/* Priority-broadcast eyebrow rides the shared SUPPORT_TEXT floor (2026-07-15 label-floor
          pass) so it matches the AlertStage's identical "ALL TERMINALS — PRIORITY BROADCAST" cap. */}
      <div style={{ fontSize: SUPPORT_TEXT[orientation], letterSpacing: 8, opacity: 0.8 }}>■ PRIORITY BROADCAST — ALL TERMINALS ■</div>
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
