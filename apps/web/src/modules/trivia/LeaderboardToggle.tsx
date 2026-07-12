import type { useDisplayState, DisplayState } from "./useScoring";
import { btnGhost, btnActive } from "./ui";

/**
 * Audience leaderboard controls (docs/04 ARCH-2 — the legacy "Show/Hide Scores" +
 * game-over surface). Legacy encoded scores-hidden in rounds.scoring_in_progress, a
 * column our schema (docs/02) doesn't have; the ported Leaderboard always shows live
 * standings. What remains audience-facing here is the GAME OVER / FINAL SCORES reveal
 * (game_display_state.show_game_over, which both displays render) plus a quick launcher
 * for the leaderboard screen.
 */
export function LeaderboardToggle({
  gameId,
  state,
  write,
}: {
  gameId: string;
  state: DisplayState | null;
  write: ReturnType<typeof useDisplayState>["write"];
}) {
  const gameOver = state?.show_game_over ?? false;

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <button type="button" onClick={() => window.open(`/leaderboard?game=${gameId}`, "_blank")} style={btnGhost}>
        ⧉ OPEN LEADERBOARD
      </button>
      <button
        type="button"
        onClick={() => write.mutate(gameOver ? { show_game_over: false } : { show_game_over: true, is_display_active: false })}
        style={gameOver ? btnActive : btnGhost}
      >
        {gameOver ? "■ RESUME (HIDE GAME OVER)" : "★ REVEAL FINAL SCORES"}
      </button>
    </div>
  );
}
