import type { useDisplayState, DisplayState, DisplayStage, Round } from "./useScoring";
import { btnGhost, btnActive } from "./ui";

/**
 * Manual LANDSCAPE display-stage control (migration 0060 — owner Scoring rebuild
 * 2026-07-22). The sibling of BoardStageControl: where BOARD drives the PORTRAIT
 * leaderboard (board_stage), DISPLAY drives the LANDSCAPE audience board (display_stage,
 * rendered by trivia/GameDisplay). The two are INDEPENDENT and fully manual — this
 * control writes ONLY display_stage; it never touches board_stage or game status.
 *
 *   JOIN QR  → 'qr'      the SCAN-TO-JOIN board
 *   Q&A      → 'qa'      the question/answer projector (is_display_active semantics —
 *                        the QuestionPanel SHOW QUESTION still gates the question)
 *   VIDEO    → 'video'   plays the next-incomplete round's video, DECOUPLED from
 *                        current_round_id so question nav can't interrupt it
 *   UP NEXT  → 'upnext'  the "UP NEXT — ROUND X · <category>" card
 *   THANKS   → 'thanks'  the "THANK YOU FOR PLAYING" card
 *
 * VIDEO is disabled when the next round has no video_url (mirrors the old VideoControls
 * disabled state) so the host can't select a stage that would show STAND BY.
 */
export function DisplayStageControl({
  state,
  write,
  videoRound,
}: {
  state: DisplayState | null;
  write: ReturnType<typeof useDisplayState>["write"];
  /** The next-incomplete round — the round whose video the VIDEO stage plays. */
  videoRound: Round | null;
}) {
  const stage: DisplayStage = state?.display_stage ?? "qa";
  const hasVideo = !!videoRound?.video_url;

  const set = (next: DisplayStage) => write.mutate({ display_stage: next });

  const options: { key: DisplayStage; label: string; disabled?: boolean }[] = [
    { key: "qr", label: "JOIN QR" },
    { key: "qa", label: "Q&A" },
    { key: "video", label: "VIDEO", disabled: !hasVideo && stage !== "video" },
    { key: "upnext", label: "UP NEXT" },
    { key: "thanks", label: "THANKS" },
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 20, opacity: 0.7 }}>DISPLAY:</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label="Landscape display stage">
        {options.map((o) => {
          const active = stage === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => set(o.key)}
              disabled={o.disabled}
              aria-pressed={active}
              title={o.key === "video" && !hasVideo ? "This round has no video" : undefined}
              style={{ ...(active ? btnActive : btnGhost), opacity: o.disabled ? 0.4 : 1 }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
