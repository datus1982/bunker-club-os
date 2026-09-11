import { useMemo, useState } from "react";
import { useMediaFiles, useMediaPlaylists, useAllScheduleRows, type PlaylistWithStats } from "./useMediaAdmin";
import { useAdminSlots } from "./useSignageAdmin";
import { isMediaCapableSlot } from "./signageHubShared";
import { CollapsibleSection, ghost } from "./signageAdminShared";
import { MediaLibraryPanel, MediaPlaylistsPanel, PlaylistEditor } from "./MediaPanels";

/**
 * Hub MEDIA LIBRARY section (docs/15 M1) — sits between ASSET LIBRARY and RUNNING & UPCOMING.
 *
 *   • Library grid: every synced media_files row (thumb, title w/ inline edit, duration,
 *     PRESENT/MISSING/UNSUPPORTED chip). Ingestion is folder-drop on the media PC — no upload
 *     path here (the empty state says so).
 *   • Playlists: folder auto-playlists (sync-owned name+membership) + hub-built custom playlists,
 *     each with a FRAMED↔FULL FRAME + SHUFFLE toggle (both always editable) and clip count/runtime.
 *   • Custom playlist create/edit slide-over: name, add-from-library, ▲/▼ reorder, remove.
 *
 * Mobile-first like the rest of the hub. Self-contained overlay state (the editor slide-over lives
 * here, not in SignageHub's union) so the section drops into the hub with one <MediaSection/> line.
 *
 * Beat 4 moved the two bodies into MediaPanels.tsx so the new MEDIA ▸ LIBRARY and MEDIA ▸
 * PLAYLISTS pages mount the SAME panels. This section composes them exactly as before —
 * same two CollapsibleSections, same keys/anchors/summaries/default-open state. CLASSIC
 * RENDERS WHAT IT ALWAYS DID; v2 drops this section for the top-level pages instead.
 */
export function MediaSection() {
  const filesQ = useMediaFiles();
  const playlistsQ = useMediaPlaylists();
  const files = useMemo(() => filesQ.data ?? [], [filesQ.data]);
  const playlists = useMemo(() => playlistsQ.data ?? [], [playlistsQ.data]);

  // PLAY ON (owner beat: "start a specific film") — the media-capable screens a library card can
  // send a film to. Same gate as the PROGRAM control: landscape, real screens (a multiview PANEL is
  // not a TV). Both queries are the hub's existing shared query keys, so this adds no new fetches
  // when the section renders inside SignageHub.
  const slotsQ = useAdminSlots();
  const schedulesQ = useAllScheduleRows();
  const screens = useMemo(() => (slotsQ.data ?? []).filter(isMediaCapableSlot), [slotsQ.data]);
  // A slot with dayparts gets a plain 'boundary' flip (yields at the next daypart) exactly like a
  // hub PROGRAM flip; a slot with no schedule gets the permanent 'pin'. (A Q-SYS press defaults to
  // the stickier SPECIAL EVENT hold — that asymmetry is deliberate and predates this beat.)
  const hasSchedule = (slotId: string) => ((schedulesQ.data?.get(slotId)?.length ?? 0) > 0);

  // editing = an existing playlist; "new" = the create flow; null = closed.
  const [editing, setEditing] = useState<PlaylistWithStats | "new" | null>(null);

  // Compact header summaries from data already loaded (no new queries — owner beat 2026-07-20).
  const needThumbs = useMemo(() => files.filter((f) => !f.thumb).length, [files]);
  const mediaSummary = filesQ.isLoading
    ? "…"
    : `${files.length} file${files.length === 1 ? "" : "s"}${needThumbs > 0 ? ` · ${needThumbs} need thumb${needThumbs === 1 ? "" : "s"}` : ""}`;
  const playlistSummary = playlistsQ.isLoading ? "…" : `${playlists.length}`;

  return (
    <div style={{ marginTop: 32 }}>
      {/* ── MEDIA LIBRARY (collapsible; DEFAULT COLLAPSED — the 361-file grid is the overwhelming one) ── */}
      <CollapsibleSection sectionKey="media" anchorId="library" title="MEDIA LIBRARY" summary={mediaSummary} defaultOpen={false}>
        <MediaLibraryPanel files={files} loading={filesQ.isLoading} screens={screens} hasSchedule={hasSchedule} />
      </CollapsibleSection>

      {/* ── PLAYLISTS (collapsible; default expanded) ─────────────────── */}
      <CollapsibleSection
        style={{ marginTop: 22 }}
        sectionKey="playlists"
        anchorId="playlists"
        title="PLAYLISTS"
        summary={playlistSummary}
        defaultOpen={true}
        headerRight={<button type="button" onClick={() => setEditing("new")} style={{ ...ghost, fontWeight: 700 }}>+ NEW PLAYLIST</button>}
      >
        <MediaPlaylistsPanel playlists={playlists} loading={playlistsQ.isLoading} onEdit={setEditing} />
      </CollapsibleSection>

      {editing && (
        <PlaylistEditor
          initial={editing === "new" ? null : editing}
          files={files}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
