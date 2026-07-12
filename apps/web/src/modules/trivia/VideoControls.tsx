import type { useDisplayState, Round, DisplayState } from "./useScoring";
import { btnGhost, btnActive } from "./ui";

/**
 * Inter-round video toggle (docs/04 ARCH-2 — extracted from Scoring's video controls).
 * The audience GameDisplay reads the round's own rounds.video_url, so this only flips
 * game_display_state.show_video and points current_round_id at the round to play.
 * show_video is deliberately never touched by round-progression writes, so a video keeps
 * playing across a round change until the host hides it here (legacy invariant).
 */
export function VideoControls({
  currentRound,
  state,
  toggleVideo,
}: {
  currentRound: Round | null;
  state: DisplayState | null;
  toggleVideo: ReturnType<typeof useDisplayState>["toggleVideo"];
}) {
  const showing = state?.show_video ?? false;
  const hasVideo = !!currentRound?.video_url;

  return (
    <button
      type="button"
      disabled={!showing && !hasVideo}
      onClick={() => toggleVideo.mutate({ show: !showing, roundId: currentRound?.id ?? null })}
      style={{ ...(showing ? btnActive : btnGhost), opacity: !showing && !hasVideo ? 0.4 : 1 }}
      title={hasVideo ? currentRound?.video_url ?? "" : "This round has no video"}
    >
      {showing ? "■ HIDE VIDEO" : "▶ SHOW VIDEO"}
    </button>
  );
}
