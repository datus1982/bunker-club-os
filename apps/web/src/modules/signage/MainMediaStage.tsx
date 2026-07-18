import { PlaylistVideo } from "./PlaylistProgram";
import { CaptureVideo } from "./CaptureProgram";
import { usePlaylistProgram, type MultiviewMain } from "./mediaProgram";

/**
 * The 16:9 MAIN region content of a multiview (docs/15 M3 D8) — a playlist loop OR a live capture,
 * REUSING the M1/M2 renderers verbatim. It renders ONLY the inner <video>/stream machinery
 * (playback loop, MEDIA HOST OFFLINE / FEED INTERRUPTED / NO SIGNAL cards, muted-boot audio probe,
 * Q-SYS transport) — no chrome wrapper; the multiview supplies its own header + ticker + panel.
 *
 * Presentation is IGNORED here (D8): the geometry owns the 1312×738 stage, so the source is always
 * CONTAINED (fullbleed=false → object-fit: contain) — a true-16:9 source fills exactly, an
 * odd-ratio clip letterboxes inside the stage, never cropped. orientation is 'landscape' (the
 * stage is 16:9), which sizes the status-card typography.
 */
export function MainMediaStage({ main, slug, base }: { main: MultiviewMain; slug: string; base: string }) {
  if (main.kind === "capture") {
    return <CaptureVideo deviceMatch={main.device_match} fullbleed={false} orientation="landscape" />;
  }
  return <PlaylistMainStage playlistId={main.playlist_id} slug={slug} base={base} />;
}

function PlaylistMainStage({ playlistId, slug, base }: { playlistId: string; slug: string; base: string }) {
  const { data, isPending, isError } = usePlaylistProgram(playlistId);
  return (
    <PlaylistVideo
      key={playlistId}
      slug={slug}
      files={data?.files ?? []}
      base={base}
      shuffle={!!data?.playlist?.shuffle}
      fullbleed={false}
      orientation="landscape"
      loading={isPending}
      loadError={isError}
    />
  );
}
