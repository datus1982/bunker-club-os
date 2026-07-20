import { useMemo, useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  useMediaFiles, useMediaPlaylists, usePlaylistDetail,
  updateMediaTitle, setPlaylistPresentation, setPlaylistShuffle, setPlaylistSubtitles,
  createCustomPlaylist, renamePlaylist, deletePlaylist,
  addPlaylistItem, removePlaylistItem, swapPlaylistItems, statusChip,
  type MediaFile, type PlaylistWithStats, type PlaylistItemDetail,
} from "./useMediaAdmin";
import { formatDuration } from "./mediaProgram";
import { MONO, CollapsibleSection, ghost } from "./signageAdminShared";
import { SlideOver } from "./SlideOver";

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
 */
export function MediaSection() {
  const filesQ = useMediaFiles();
  const playlistsQ = useMediaPlaylists();
  const files = useMemo(() => filesQ.data ?? [], [filesQ.data]);
  const playlists = useMemo(() => playlistsQ.data ?? [], [playlistsQ.data]);

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
      <CollapsibleSection sectionKey="media" title="MEDIA LIBRARY" summary={mediaSummary} defaultOpen={false}>
        {filesQ.isLoading ? (
          <div style={{ fontSize: 18, opacity: 0.7 }}>LOADING MEDIA…</div>
        ) : files.length === 0 ? (
          <div className="terminal-border" style={{ padding: "16px 16px", opacity: 0.8, fontSize: 16, lineHeight: 1.5 }}>
            No media synced yet. Drop video files into the watched folder on the media PC
            (<code>~/BunkerMedia</code> by default) — the shell probes each file and reports it here.
            Subfolders become auto-playlists.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,200px),1fr))", gap: 12 }}>
            {files.map((f) => <MediaFileCard key={f.id} file={f} />)}
          </div>
        )}
      </CollapsibleSection>

      {/* ── PLAYLISTS (collapsible; default expanded) ─────────────────── */}
      <CollapsibleSection
        style={{ marginTop: 22 }}
        sectionKey="playlists"
        title="PLAYLISTS"
        summary={playlistSummary}
        defaultOpen={true}
        headerRight={<button type="button" onClick={() => setEditing("new")} style={{ ...ghost, fontWeight: 700 }}>+ NEW PLAYLIST</button>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {playlistsQ.isLoading ? (
            <div style={{ fontSize: 18, opacity: 0.7 }}>LOADING PLAYLISTS…</div>
          ) : playlists.length === 0 ? (
            <div className="terminal-border" style={{ padding: "14px 16px", opacity: 0.8, fontSize: 16 }}>
              No playlists yet. A subfolder of the media folder becomes an auto-playlist, or + NEW PLAYLIST to build a custom one.
            </div>
          ) : (
            playlists.map((p) => <PlaylistRow key={p.playlist.id} p={p} onEdit={() => setEditing(p)} />)
          )}
        </div>
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

/* ── a library file card (thumb + inline-editable title + duration + status) ── */
function MediaFileCard({ file }: { file: MediaFile }) {
  const chip = statusChip(file.status);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draft, setDraft] = useState(file.title ?? "");
  const save = useMutation({
    mutationFn: (t: string) => updateMediaTitle(file.id, t),
    onSettled: () => setEditingTitle(false),
  });
  const display = (file.title ?? "").trim() || file.filename;

  return (
    <div className="terminal-border" style={{ display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
      <div style={{ position: "relative", height: 110, borderBottom: "1px solid rgba(0,255,65,0.2)", display: "flex", alignItems: "center", justifyContent: "center", background: "#030803" }}>
        {file.thumb ? (
          <img src={file.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: file.status === "present" ? 1 : 0.45 }} />
        ) : (
          <span style={{ fontSize: 34, opacity: 0.7 }}>▶</span>
        )}
        <span className={chip.cls} style={{ position: "absolute", top: 6, left: 6, fontSize: 10, letterSpacing: 1, padding: "2px 5px", background: "#020602", border: "1px solid currentColor" }}>{chip.label}</span>
        <span style={{ position: "absolute", bottom: 6, right: 6, fontSize: 12, letterSpacing: 1, padding: "1px 5px", background: "#020602", border: "1px solid rgba(0,255,65,0.4)" }}>{formatDuration(file.duration_seconds)}</span>
      </div>
      <div style={{ padding: "8px 10px", minWidth: 0 }}>
        {editingTitle ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => save.mutate(draft)}
            onKeyDown={(e) => { if (e.key === "Enter") save.mutate(draft); if (e.key === "Escape") setEditingTitle(false); }}
            style={{ width: "100%", background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "6px 8px", fontSize: 16, fontFamily: MONO }}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setDraft(file.title ?? ""); setEditingTitle(true); }}
            title="Click to rename"
            style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", color: "var(--terminal-green)", fontFamily: MONO, fontSize: 18, cursor: "pointer", padding: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >{display}</button>
        )}
        <div style={{ fontSize: 12, opacity: 0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 3 }} title={file.filename}>{file.filename}</div>
      </div>
    </div>
  );
}

/* ── a playlist row (badges + presentation/shuffle toggles + edit) ──────────── */
function PlaylistRow({ p, onEdit }: { p: PlaylistWithStats; onEdit: () => void }) {
  const { playlist } = p;
  const isFolder = playlist.source === "folder";
  const pres = useMutation({ mutationFn: () => setPlaylistPresentation(playlist.id, playlist.presentation === "fullbleed" ? "framed" : "fullbleed") });
  const shuf = useMutation({ mutationFn: () => setPlaylistShuffle(playlist.id, !playlist.shuffle) });
  const subs = useMutation({ mutationFn: () => setPlaylistSubtitles(playlist.id, !playlist.subtitles) });
  const missing = p.itemCount - p.presentCount;

  return (
    <div className="terminal-border" style={{ padding: "10px 13px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <button type="button" onClick={onEdit} style={{ flex: "1 1 220px", minWidth: 0, textAlign: "left", background: "transparent", border: "none", color: "inherit", fontFamily: MONO, cursor: "pointer", padding: 0 }}>
        <div style={{ fontSize: 21, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{playlist.name}</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>
          {p.presentCount} clip{p.presentCount === 1 ? "" : "s"} · {formatDuration(p.runtimeSeconds)}
          {missing > 0 ? ` · ${missing} missing` : ""}
        </div>
      </button>
      <span style={{ fontSize: 11, letterSpacing: 2, padding: "2px 6px", border: "1px solid currentColor", opacity: isFolder ? 0.7 : 1 }} className={isFolder ? "" : "u-amber"}>
        {isFolder ? "FOLDER" : "CUSTOM"}
      </span>
      <button type="button" onClick={() => pres.mutate()} disabled={pres.isPending} title="How the video is framed on screen" className={playlist.presentation === "fullbleed" ? "u-amber" : ""} style={toggleBtn}>
        {playlist.presentation === "fullbleed" ? "▣ FULL FRAME" : "▢ FRAMED"}
      </button>
      <button type="button" onClick={() => shuf.mutate()} disabled={shuf.isPending} className={playlist.shuffle ? "u-fill u-ink" : ""} style={{ ...toggleBtn, ...(playlist.shuffle ? { fontWeight: 700, background: "var(--terminal-green)", color: "#000" } : null) }}>
        {playlist.shuffle ? "⤨ SHUFFLE ON" : "→ IN ORDER"}
      </button>
      <button type="button" onClick={() => subs.mutate()} disabled={subs.isPending} title="Show subtitles when a clip has a sidecar .srt" className={playlist.subtitles ? "u-fill u-ink" : ""} style={{ ...toggleBtn, ...(playlist.subtitles ? { fontWeight: 700, background: "var(--terminal-green)", color: "#000" } : null) }}>
        {playlist.subtitles ? "＂ SUBS ON" : "✕ SUBS OFF"}
      </button>
      <button type="button" onClick={onEdit} style={toggleBtn}>{isFolder ? "VIEW" : "EDIT"}</button>
    </div>
  );
}

/* ── create / edit slide-over ────────────────────────────────────────────── */
function PlaylistEditor({ initial, files, onClose }: { initial: PlaylistWithStats | null; files: MediaFile[]; onClose: () => void }) {
  const isFolder = initial?.playlist.source === "folder";
  const readOnly = isFolder; // folder name + membership are sync-owned
  const [name, setName] = useState(initial?.playlist.name ?? "");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const playlistId = initial?.playlist.id ?? createdId;

  const detailQ = usePlaylistDetail(playlistId);
  const items = detailQ.data ?? [];

  const create = useMutation({
    mutationFn: () => createCustomPlaylist(name),
    onSuccess: (id) => setCreatedId(id),
  });
  const rename = useMutation({ mutationFn: () => renamePlaylist(playlistId as string, name) });
  const del = useMutation({ mutationFn: () => deletePlaylist(playlistId as string), onSuccess: onClose });

  const nextPos = items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0;
  const add = useMutation({ mutationFn: (fileId: string) => addPlaylistItem(playlistId as string, fileId, nextPos) });
  const remove = useMutation({ mutationFn: (fileId: string) => removePlaylistItem(playlistId as string, fileId) });
  const swap = useMutation({
    mutationFn: ({ a, b }: { a: PlaylistItemDetail; b: PlaylistItemDetail }) =>
      swapPlaylistItems(playlistId as string, { file_id: a.file.id, position: a.position }, { file_id: b.file.id, position: b.position }),
  });

  const inPlaylist = useMemo(() => new Set(items.map((i) => i.file.id)), [items]);

  const title = isFolder ? "VIEW FOLDER PLAYLIST" : initial ? "EDIT PLAYLIST" : "NEW PLAYLIST";

  return (
    <SlideOver eyebrow="MEDIA ▸ PLAYLIST" title={title} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* name */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 14, letterSpacing: 2, opacity: 0.55 }}>NAME{isFolder ? " (folder — read-only)" : ""}</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
              placeholder="playlist name"
              style={{ flex: "1 1 200px", minWidth: 0, background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "10px 12px", fontSize: 18, fontFamily: MONO, opacity: readOnly ? 0.6 : 1 }}
            />
            {!isFolder && !playlistId && (
              <button type="button" onClick={() => create.mutate()} disabled={create.isPending || !name.trim()} style={{ ...ghost, fontWeight: 700 }}>CREATE</button>
            )}
            {!isFolder && playlistId && (
              <button type="button" onClick={() => rename.mutate()} disabled={rename.isPending} style={ghost}>SAVE NAME</button>
            )}
          </div>
        </div>

        {!playlistId ? (
          <div style={{ opacity: 0.6, fontSize: 15 }}>Name the playlist and CREATE it, then add clips.</div>
        ) : (
          <>
            {/* current items */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 14, letterSpacing: 2, opacity: 0.55 }}>CLIPS ({items.length})</span>
              {detailQ.isLoading ? (
                <div style={{ opacity: 0.6, fontSize: 15 }}>LOADING…</div>
              ) : items.length === 0 ? (
                <div style={{ opacity: 0.6, fontSize: 15 }}>Empty. Add clips from the library below.</div>
              ) : (
                items.map((it, i) => {
                  const chip = statusChip(it.file.status);
                  return (
                    <div key={it.file.id} className="terminal-border" style={{ padding: "7px 9px", display: "flex", alignItems: "center", gap: 10 }}>
                      {it.file.thumb
                        ? <img src={it.file.thumb} alt="" style={{ width: 44, height: 30, objectFit: "cover", border: "1px solid var(--terminal-green)", flexShrink: 0, opacity: it.file.status === "present" ? 1 : 0.45 }} />
                        : <span style={{ width: 44, height: 30, border: "1px solid var(--terminal-green)", flexShrink: 0, display: "inline-block" }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(it.file.title ?? "").trim() || it.file.filename}</div>
                        <div style={{ fontSize: 12, opacity: 0.55 }}>{formatDuration(it.file.duration_seconds)}{it.file.status !== "present" ? ` · ${chip.label}` : ""}</div>
                      </div>
                      {!readOnly && (
                        <>
                          <button type="button" disabled={i === 0 || swap.isPending} onClick={() => swap.mutate({ a: it, b: items[i - 1] })} aria-label="Move up" style={miniIcon}>▲</button>
                          <button type="button" disabled={i === items.length - 1 || swap.isPending} onClick={() => swap.mutate({ a: it, b: items[i + 1] })} aria-label="Move down" style={miniIcon}>▼</button>
                          <button type="button" onClick={() => remove.mutate(it.file.id)} className="u-amber" aria-label="Remove" style={miniIcon}>✕</button>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* add-from-library (custom only) */}
            {!readOnly && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, letterSpacing: 2, opacity: 0.55 }}>ADD FROM LIBRARY</span>
                <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                  {files.length === 0 && <div style={{ opacity: 0.6, fontSize: 15 }}>No media synced yet.</div>}
                  {files.map((f) => {
                    const already = inPlaylist.has(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        disabled={already || add.isPending}
                        onClick={() => add.mutate(f.id)}
                        style={{ display: "flex", gap: 10, alignItems: "center", background: "transparent", color: "var(--terminal-green)", border: "1px solid rgba(0,255,65,0.25)", padding: "6px 8px", cursor: already ? "default" : "pointer", fontFamily: MONO, minHeight: 44, opacity: already ? 0.4 : 1 }}
                      >
                        {f.thumb
                          ? <img src={f.thumb} alt="" style={{ width: 40, height: 28, objectFit: "cover", border: "1px solid var(--terminal-green)", flexShrink: 0 }} />
                          : <span style={{ width: 40, height: 28, border: "1px solid var(--terminal-green)", flexShrink: 0, display: "inline-block" }} />}
                        <span style={{ flex: 1, minWidth: 0, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 16 }}>{(f.title ?? "").trim() || f.filename}</span>
                        <span style={{ fontSize: 12, opacity: 0.55 }}>{already ? "ADDED" : "+ ADD"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!isFolder && (
              <div style={{ marginTop: 4 }}>
                <button type="button" onClick={() => { if (confirm("Delete this playlist? Clips stay in the library; any screen pointed at it falls back to an empty program until re-pointed.")) del.mutate(); }} className="u-red" style={{ ...ghost, color: "var(--terminal-red,#ff5555)", borderColor: "var(--terminal-red,#ff5555)" }}>DELETE PLAYLIST</button>
              </div>
            )}
          </>
        )}
      </div>
    </SlideOver>
  );
}

const toggleBtn: CSSProperties = {
  fontFamily: MONO, fontSize: 13, letterSpacing: 1, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "transparent", padding: "7px 10px",
  minHeight: 44, cursor: "pointer", whiteSpace: "nowrap",
};
const miniIcon: CSSProperties = {
  fontFamily: MONO, fontSize: 14, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "transparent",
  minWidth: 40, minHeight: 40, cursor: "pointer", flexShrink: 0,
};
