import type { useDisplayState, DisplayState, BoardStage } from "./useScoring";
import { btnGhost, btnActive } from "./ui";

/**
 * Manual public-leaderboard stage control (migration 0038 — owner trivia-host
 * choreography). Replaces the old "OPEN LEADERBOARD / REVEAL FINAL SCORES" toggle:
 * the leaderboard is always sourced from a separate always-on display, so there is
 * nothing to "open" from here — what the host needs is control over WHAT the room
 * sees. Four stages, driven ONLY from this control (GameSetup seeds 'qr' at game
 * creation; after that nothing else writes board_stage):
 *
 *   JOIN QR      → 'qr'        big join QR, no scores
 *   HIDE SCORES  → 'scoring'   "scores sealed" holding screen, no scores
 *   STANDINGS    → 'standings' the live standings board
 *   FINAL REVEAL → 'final'     the FINAL SCORES / GAME OVER reveal
 *
 * The public board (trivia/Leaderboard.tsx — shared by /leaderboard AND the signage
 * portrait game-mode board) renders from board_stage in realtime, so a flip reaches
 * the TVs sub-second, like question nav.
 *
 * show_game_over is written alongside so legacy readers stay consistent: FINAL REVEAL
 * raises it (preserving the old reveal's behavior — GAME OVER + drop the question
 * display), and leaving 'final' for any other stage lowers it.
 */
export function BoardStageControl({
  state,
  write,
}: {
  state: DisplayState | null;
  write: ReturnType<typeof useDisplayState>["write"];
}) {
  // Mirror the board's own precedence: an END-GAME / final-round show_game_over lights
  // FINAL even though it left board_stage alone (only this control writes board_stage).
  const stage: BoardStage =
    state?.show_game_over || state?.board_stage === "final" ? "final" : state?.board_stage ?? "standings";

  const set = (next: BoardStage) => {
    if (next === "final") {
      // Preserve the legacy REVEAL FINAL SCORES behavior: GAME OVER + drop the question
      // display so the reveal owns the screen.
      write.mutate({ board_stage: "final", show_game_over: true, is_display_active: false });
    } else {
      // Leaving 'final' unsets show_game_over so the board actually leaves the reveal.
      write.mutate({ board_stage: next, show_game_over: false });
    }
  };

  const options: { key: BoardStage; label: string }[] = [
    { key: "qr", label: "JOIN QR" },
    { key: "scoring", label: "HIDE SCORES" },
    { key: "standings", label: "STANDINGS" },
    { key: "final", label: "FINAL REVEAL" },
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 20, opacity: 0.7 }}>BOARD:</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label="Public leaderboard stage">
        {options.map((o) => {
          const active = stage === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => set(o.key)}
              aria-pressed={active}
              style={active ? btnActive : btnGhost}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
