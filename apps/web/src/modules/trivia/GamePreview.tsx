import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FixedCanvas } from "@/shared/FixedCanvas";
import { LeaderboardBoard } from "./Leaderboard";
import { GameDisplayBoard } from "./GameDisplay";
import { TriviaHoldingBoard } from "./TriviaHoldingBoard";
import { useCurrentGame } from "./useLeaderboard";
import "../../theme/terminal-theme.css";

/**
 * Dual-display SCREEN PREVIEW — /game/preview (public, no auth; trivia-sandbox).
 *
 * A self-contained window Ronnie can pop open from the Scoring console (or from home)
 * to watch EXACTLY what the two bar screens would show as he scores — the 16:9
 * landscape game display beside the 9:16 portrait leaderboard, both live-updating via
 * the boards' own realtime subscriptions.
 *
 * It reuses the SAME extracted board components signage game mode renders
 * (GameDisplayBoard / LeaderboardBoard) — so this is a faithful "what would come out"
 * mirror, not a second implementation. Each board lays out in its fixed logical canvas
 * and is scaled to fit its pane with FixedCanvas (the side-effect-free scaler that is
 * safe to use twice on one page — DisplayCanvas owns the whole viewport and cannot).
 *
 * This page IGNORES the `trivia_screens_armed` gate on purpose: it always shows what the
 * screens WOULD show for the current game — the pre-game HOLDING board while the game is
 * not yet started, and the live boards once it is active/paused — so the host can preview
 * BOTH states. It resolves the current game (or a specific `?game=<id>`) with the same
 * public reads the kiosk boards use, so it works in a bare popup with no session.
 */
export function GamePreview() {
  const [params] = useSearchParams();
  const overrideGameId = params.get("game");

  // Resolve the game the same way the boards do (includes `setup`), so the preview mirrors the
  // screens: a not-yet-started (setup) game → the pre-game HOLDING board; active/paused → the LIVE
  // boards; a completed game → the boards' own final view (the boards handle it). Holding is the
  // `setup` state ONLY — the exact state SlotDisplay renders the holding board for.
  const game = useCurrentGame(overrideGameId).data ?? null;
  const showHolding = game?.status === "setup";
  const gameId = game?.id ?? null;

  return (
    <div
      className="terminal-theme"
      style={{
        position: "fixed", inset: 0, background: "#000", color: "var(--terminal-green)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        fontFamily: "'VT323','Share Tech Mono',monospace",
      }}
    >
      {/* Preview chrome — makes it unmistakable this is NOT a kiosk URL. */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "8px 18px", borderBottom: "2px solid var(--sig-rule, #1c3a24)" }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>◉ SCREEN PREVIEW</div>
        <div style={{ fontSize: 16, opacity: 0.6, letterSpacing: 1 }}>
          WHAT THE BAR SCREENS WOULD SHOW · NOT A KIOSK URL — DO NOT POINT A TV HERE
        </div>
      </div>

      {/* Two panes side by side. Each pane measures itself and scales its board to fit. Holding
          board before the game starts; the live boards once active/paused (mirrors the screens). */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <PreviewPane label={`LANDSCAPE · ${showHolding ? "HOLDING" : "GAME DISPLAY"} (16:9)`} width={1920} height={1080}>
          {showHolding
            ? <TriviaHoldingBoard gameId={gameId} orientation="landscape" />
            : <GameDisplayBoard overrideGameId={overrideGameId} />}
        </PreviewPane>
        <div style={{ width: 2, background: "var(--sig-rule, #1c3a24)", flexShrink: 0 }} />
        <PreviewPane label={`PORTRAIT · ${showHolding ? "HOLDING" : "LEADERBOARD"} (9:16)`} width={1080} height={1920}>
          {showHolding
            ? <TriviaHoldingBoard gameId={gameId} orientation="portrait" />
            : <LeaderboardBoard overrideGameId={overrideGameId} />}
        </PreviewPane>
      </div>
    </div>
  );
}

/**
 * One preview pane: a labeled region that measures its inner box and renders the board
 * inside an aspect-correct FixedCanvas scaled to fit (letterboxed remainder = black).
 */
function PreviewPane({ label, width, height, children }: { label: string; width: number; height: number; children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flexShrink: 0, fontSize: 15, opacity: 0.55, letterSpacing: 2, padding: "6px 12px", textAlign: "center" }}>{label}</div>
      <div ref={boxRef} style={{ flex: 1, minHeight: 0, position: "relative", background: "#000" }}>
        {size.w > 0 && size.h > 0 && (
          <FixedCanvas width={width} height={height} boxWidth={size.w} boxHeight={size.h}>
            {children}
          </FixedCanvas>
        )}
      </div>
    </div>
  );
}
