import type { useDisplayState, DisplayState, DisplayStage, Round } from "./useScoring";
import { btnGhost, btnActive } from "./ui";

/**
 * Manual LANDSCAPE display-stage control (migration 0060 — owner Scoring rebuild
 * 2026-07-22, rewired 2026-07-22). The sibling of BoardStageControl: where BOARD drives the
 * PORTRAIT leaderboard (board_stage), DISPLAY drives the LANDSCAPE audience board
 * (display_stage, rendered by trivia/GameDisplay). The two are INDEPENDENT and fully manual.
 *
 *   JOIN QR  → 'qr'      the SCAN-TO-JOIN board
 *   Q&A      → 'qa'      the question/answer projector (is_display_active semantics —
 *                        the QuestionPanel SHOW QUESTION still gates the question)
 *   VIDEO    → 'video'   plays the LOADED round's (current_round_id) video, SEALED once
 *                        started; a second press (while active) is the EXPLICIT STOP →
 *                        UP NEXT. current_round_id is written so the landscape seals the
 *                        loaded round even if the host never touched the projector.
 *   UP NEXT  → 'upnext'  the "UP NEXT — ROUND X · <category>" card for the loaded round
 *   THANKS   → 'thanks'  the "THANK YOU FOR PLAYING" card
 *
 * VIDEO is disabled when the LOADED round has no video_url (unless it's already the active
 * stage, so the host can still press it to STOP).
 */
export function DisplayStageControl({
  state,
  write,
  loadedRound,
}: {
  state: DisplayState | null;
  write: ReturnType<typeof useDisplayState>["write"];
  /** The manually-loaded round (Scoring's selected round) — the VIDEO/UP NEXT source. */
  loadedRound: Round | null;
}) {
  const stage: DisplayStage = state?.display_stage ?? "qa";
  const loadedHasVideo = !!loadedRound?.video_url;
  // The round id to pin as the landscape's loaded round when starting Video / Up Next.
  const loadedId = loadedRound?.id ?? state?.current_round_id ?? null;

  const go = (next: DisplayStage) => {
    if (next === "video") {
      // Toggle: active VIDEO → EXPLICIT STOP → UP NEXT; else start the loaded round's video
      // (pin current_round_id so the landscape seals THIS round).
      if (stage === "video") write.mutate({ display_stage: "upnext" });
      else write.mutate({ display_stage: "video", current_round_id: loadedId });
    } else if (next === "upnext") {
      write.mutate({ display_stage: "upnext", current_round_id: loadedId });
    } else {
      write.mutate({ display_stage: next });
    }
  };

  const options: { key: DisplayStage; label: string; disabled?: boolean }[] = [
    { key: "qr", label: "JOIN QR" },
    { key: "qa", label: "Q&A" },
    { key: "video", label: "VIDEO", disabled: !loadedHasVideo && stage !== "video" },
    { key: "upnext", label: "UP NEXT" },
    { key: "thanks", label: "THANKS" },
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 20, opacity: 0.7 }}>DISPLAY:</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label="Landscape display stage">
        {options.map((o) => {
          const active = stage === o.key;
          const title =
            o.key === "video"
              ? active
                ? "Stop the video → UP NEXT"
                : !loadedHasVideo
                  ? "The loaded round has no video"
                  : "Play the loaded round's video"
              : undefined;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => go(o.key)}
              disabled={o.disabled}
              aria-pressed={active}
              title={title}
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
