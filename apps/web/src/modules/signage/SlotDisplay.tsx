import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { DisplayCanvas } from "@/shared/DisplayCanvas";
import { supabase } from "@/shared/supabaseClient";
import { LeaderboardBoard } from "@/modules/trivia/Leaderboard";
import { GameDisplayBoard } from "@/modules/trivia/GameDisplay";
import { useSlot, resolveRotation, type SignageItem, type Slot, type Takeover, type ToastCacheRow } from "./useSignage";
import { useTicker, type TickerLine } from "./useTicker";
import { TemplateView } from "./SignageTemplates";
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

type Mode = "takeover" | "game" | "rotation";

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

  // Re-evaluate item time-windows on a slow tick (perf: 30s, well above sub-30s floor).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const rotation = useMemo(
    () => resolveRotation(items, toast, new Date(nowTick)),
    [items, toast, nowTick],
  );

  const activeTakeover = preview ? null : takeover;
  const gameOn = preview ? false : !!liveGameId;
  const mode: Mode = activeTakeover ? "takeover" : gameOn ? "game" : "rotation";

  // Ink: game → green; takeover inherits the ink underneath (green if a game is live,
  // else amber); rotation → amber ambient. (docs/09 color-state)
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

  const ticker = useTicker();

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
            <Rotation slot={slot} rotation={rotation} toast={toast} />
          </div>
          <ChromeFooter ticker={ticker} live={mode !== "rotation"} />
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
function Rotation({ slot, rotation, toast }: { slot: Slot; rotation: SignageItem[]; toast: ToastMap }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index >= rotation.length && rotation.length > 0) setIndex(0);
  }, [rotation.length, index]);

  // Advance per the current item's duration (finite timeout, re-armed each item).
  const current = rotation[index];
  useEffect(() => {
    if (rotation.length <= 1) return;
    const secs = Math.max(4, current?.duration_seconds ?? 12);
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % rotation.length), secs * 1000);
    return () => window.clearTimeout(id);
  }, [index, rotation.length, current?.duration_seconds]);

  const padByOrientation = slot.orientation === "portrait" ? "56px 48px" : "44px 56px";

  if (rotation.length === 0) {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 24 }}>
        <div style={{ fontSize: slot.orientation === "portrait" ? 96 : 84, fontWeight: 700, letterSpacing: 4 }}>STANDBY</div>
        <div style={{ fontSize: 40, opacity: 0.6 }}>◊ NO ACTIVE BROADCASTS — SHELTER NOMINAL</div>
      </div>
    );
  }

  return (
    <div key={current?.id ?? index} className="sig-enter" style={{ position: "absolute", inset: 0, padding: padByOrientation, display: "flex", flexDirection: "column" }}>
      {current && <TemplateView item={current} toast={toast} orientation={slot.orientation} />}
    </div>
  );
}

/* ── Chrome ─────────────────────────────────────────────────────────────────── */
function ChromeHeader({ slot, venueName, timezone }: { slot: Slot; venueName: string; timezone: string }) {
  const clock = useClock(timezone);
  return (
    <header style={{ flexShrink: 0, borderBottom: "2px solid var(--terminal-green)", padding: "22px 40px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: 2, textShadow: "0 0 10px var(--terminal-glow)" }}>{venueName.toUpperCase()}</div>
      <div style={{ fontSize: 24, opacity: 0.75, textAlign: "right", lineHeight: 1.5 }}>
        BUNKER UNIFIED OS v2.1<br />
        TERMINAL {String(slot.terminal_number ?? 0).padStart(2, "0")} — {(slot.location_label ?? "").toUpperCase()} · {clock}
      </div>
    </header>
  );
}

function ChromeFooter({ ticker, live }: { ticker: TickerLine[]; live: boolean }) {
  const [ti, setTi] = useState(0);
  useEffect(() => {
    if (ticker.length <= 1) return;
    const id = window.setInterval(() => setTi((i) => (i + 1) % ticker.length), 9000);
    return () => window.clearInterval(id);
  }, [ticker.length]);
  const line = ticker[ti % Math.max(1, ticker.length)] ?? { text: "", live: false };

  return (
    <footer style={{ flexShrink: 0, borderTop: "2px solid var(--terminal-green)", padding: "16px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, fontSize: 26 }}>
      <span style={{ flexShrink: 0 }}>{live ? "■ LIVE" : "■ ONLINE"}</span>
      {/* Reprint (key-remount) — no scroll animation (docs/09 perf + authenticity). */}
      <span key={ti} className={`sig-enter${line.live ? " sig-live" : ""}`} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {line.text}
      </span>
    </footer>
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
