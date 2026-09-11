import { useMemo, useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  usePlaylistDetail,
  updateMediaTitle, setPlaylistPresentation, setPlaylistShuffle, setPlaylistSubtitles, setPlaylistInCarousel,
  createCustomPlaylist, renamePlaylist, deletePlaylist,
  addPlaylistItem, removePlaylistItem, swapPlaylistItems, statusChip, setSlotProgram,
  type MediaFile, type PlaylistWithStats, type PlaylistItemDetail,
} from "./useMediaAdmin";
import type { AdminSlot } from "./useSignageAdmin";
import { formatDuration, ALL_MEDIA_PLAYLIST_ID } from "./mediaProgram";
import { MONO, ghost } from "./signageAdminShared";
import { SlideOver } from "./SlideOver";

/**
 * The two halves of the MEDIA surface, as mountable panels (UX overhaul Beat 4).
 *
 * PURE MOVE out of MediaSection.tsx. The hub still composes them inside its two
 * CollapsibleSections (classic renders exactly what it always did — RULE #1); the new
 * v2 MEDIA pages mount the same panels full-page. Neither panel fetches: the host owns
 * the queries and hands the already-loaded data down, so mounting both on one page (the
 * hub) still issues the query set once.
 *
 * The editor slide-over is rendered by the HOST, not by a panel — the hub opens it over
 * the whole page, and /media/playlists opens it over its own.
 *
 * Beat 5 adds `variant`. It defaults to "classic" everywhere, so the hub renders exactly
 * what it rendered before (RULE #1 — proven by byte-identical `#library`/`#playlists`
 * markup); only the v2 MEDIA pages pass "v2", and the ONLY thing it changes is the size of
 * a tap target that became a page's primary control once the library got its own page
 * (#104 NOTE-3). No behaviour, no copy, no data path differs between the two.
 */

/** Which shell is mounting the panel. "classic" === the hub === today's markup. */
export type MediaPanelVariant = "classic" | "v2";

/** Library grid — every synced media_files row (thumb, inline-edit title, status, PLAY ON). */
export function MediaLibraryPanel({ files, loading, screens, hasSchedule, variant = "classic" }: {
  files: MediaFile[];
  loading: boolean;
  /** Landscape screens a film can be sent to (PLAY ON); empty hides that row. */
  screens: AdminSlot[];
  hasSchedule: (slotId: string) => boolean;
  /** "v2" gives each card the 44px rename affordance; the hub omits it and stays as-is. */
  variant?: MediaPanelVariant;
}) {
  if (loading) return <div style={{ fontSize: 18, opacity: 0.7 }}>LOADING MEDIA…</div>;
  if (files.length === 0) {
    return (
      <div className="terminal-border" style={{ padding: "16px 16px", opacity: 0.8, fontSize: 16, lineHeight: 1.5 }}>
        No media synced yet. Drop video files into the watched folder on the media PC
        (<code>~/BunkerMedia</code> by default) — the shell probes each file and reports it here.
        Subfolders become auto-playlists.
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,200px),1fr))", gap: 12 }}>
      {files.map((f) => <MediaFileCard key={f.id} file={f} screens={screens} hasSchedule={hasSchedule} variant={variant} />)}
    </div>
  );
}

/** Playlist rows — folder auto-playlists + custom ones, with their four toggles. */
export function MediaPlaylistsPanel({ playlists, loading, onEdit }: {
  playlists: PlaylistWithStats[];
  loading: boolean;
  onEdit: (p: PlaylistWithStats) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {loading ? (
        <div style={{ fontSize: 18, opacity: 0.7 }}>LOADING PLAYLISTS…</div>
      ) : playlists.length === 0 ? (
        <div className="terminal-border" style={{ padding: "14px 16px", opacity: 0.8, fontSize: 16 }}>
          No playlists yet. A subfolder of the media folder becomes an auto-playlist, or + NEW PLAYLIST to build a custom one.
        </div>
      ) : (
        playlists.map((p) => <PlaylistRow key={p.playlist.id} p={p} onEdit={() => onEdit(p)} />)
      )}
    </div>
  );
}

/* ── a library file card (thumb + inline-editable title + duration + status + PLAY ON) ── */
function MediaFileCard({ file, screens, hasSchedule, variant }: {
  file: MediaFile;
  /** Landscape screens this film can be sent to (empty ⇒ the PLAY ON row is hidden). */
  screens: AdminSlot[];
  hasSchedule: (slotId: string) => boolean;
  variant: MediaPanelVariant;
}) {
  const chip = statusChip(file.status);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draft, setDraft] = useState(file.title ?? "");
  const [picking, setPicking] = useState(false);
  const save = useMutation({
    mutationFn: (t: string) => updateMediaTitle(file.id, t),
    onSettled: () => setEditingTitle(false),
  });
  // An unchanged draft is NOT a write: blur-saves from a tap-then-tap-away would otherwise fire a
  // no-op UPDATE that invalidates every open hub/library via realtime (reviewer NOTE-1, #107).
  const commit = (t: string) => {
    if (t.trim() === (file.title ?? "").trim()) { setEditingTitle(false); return; }
    save.mutate(t);
  };
  const display = (file.title ?? "").trim() || file.filename;

  // PLAY ON — write a playlist program that OPENS ON THIS FILE. It targets the virtual ALL MEDIA
  // playlist, so the film always resolves (every present file is a member) and the screen keeps
  // playing the rest of the library afterwards.
  // DECISION: always ALL MEDIA rather than "whichever playlist is running / contains it". Picking a
  // containing playlist would need this card to re-run the schedule resolver per screen and to know
  // playlist membership per file — real machinery for an ambiguous win — and it can silently strand
  // a film in a 3-clip loop. The button copy states the behaviour so nothing is hidden. The Q-SYS /
  // iPad path (the primary consumer) can name any playlist + file explicitly via media-control.
  const play = useMutation({
    mutationFn: (slot: AdminSlot) =>
      setSlotProgram(
        slot.id,
        { kind: "playlist", playlist_id: ALL_MEDIA_PLAYLIST_ID, start_file_id: file.id },
        hasSchedule(slot.id) ? "boundary" : "pin",
      ),
    onSuccess: () => setPicking(false),
  });
  const canPlay = file.status === "present" && screens.length > 0;

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
            onBlur={() => commit(draft)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(draft); if (e.key === "Escape") setEditingTitle(false); }}
            // v2: the input is the thumb's caret target too — 44px like the row that opened it (NOTE-2).
            style={{ width: "100%", background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "6px 8px", fontSize: 16, fontFamily: MONO, ...(variant === "v2" ? { minHeight: 44 } : null) }}
          />
        ) : variant === "v2" ? (
          // DECISION (Beat 5, closes #104 NOTE-3): in v2 the title row IS the rename control —
          // a 44px bordered row with a visible ✎ — because promoting the library to its own page
          // made a bare ~30px text line the page's primary action, 504 times over. Same handler,
          // same draft state, same `updateMediaTitle` mutation, same Enter/Escape/blur editor:
          // only the affordance grew. Classic keeps the bare line below, byte-identical.
          <button
            type="button"
            onClick={() => { setDraft(file.title ?? ""); setEditingTitle(true); }}
            title="Click to rename"
            style={renameBtn}
          >
            <span aria-hidden="true" style={{ fontSize: 17, opacity: 0.55, flex: "0 0 auto" }}>✎</span>
            {/* The label needs its own block for the ellipsis: `text-overflow` is ignored on a
                flex CONTAINER (the StatusChip lesson). 20px matches what classic actually
                renders — `.staff-ui button` pins button text at 20px !important. */}
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 20 }}>{display}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setDraft(file.title ?? ""); setEditingTitle(true); }}
            title="Click to rename"
            style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", color: "var(--terminal-green)", fontFamily: MONO, fontSize: 18, cursor: "pointer", padding: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >{display}</button>
        )}
        <div style={{ fontSize: 12, opacity: 0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 3 }} title={file.filename}>{file.filename}</div>

        {/* PLAY ON — send this film to a screen right now (owner beat). Present files only: a
            missing/unsupported file has nothing to play. */}
        {canPlay && (
          <div style={{ marginTop: 8 }}>
            {!picking ? (
              <button
                type="button"
                onClick={() => setPicking(true)}
                title="Play this film now on a screen, then continue through the rest of the library"
                style={playBtn}
              >▶ PLAY ON…</button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11, letterSpacing: 1, opacity: 0.6, lineHeight: 1.4 }}>
                  STARTS THIS FILM, THEN THE REST OF THE LIBRARY
                </div>
                {screens.map((s) => (
                  <button key={s.id} type="button" disabled={play.isPending} onClick={() => play.mutate(s)} style={playBtn}>
                    ▶ {s.name.toUpperCase()}
                  </button>
                ))}
                <button type="button" onClick={() => setPicking(false)} style={{ ...playBtn, opacity: 0.6 }}>CANCEL</button>
                {play.isError && <div className="u-amber" style={{ fontSize: 11 }}>COULD NOT SET PROGRAM</div>}
              </div>
            )}
          </div>
        )}
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
  const caro = useMutation({ mutationFn: () => setPlaylistInCarousel(playlist.id, !playlist.in_carousel) });
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
      <button type="button" onClick={() => caro.mutate()} disabled={caro.isPending} title="Include this playlist in the CAROUSEL program's rotation (manual selection and schedules are unaffected)" className={playlist.in_carousel ? "u-fill u-ink" : ""} style={{ ...toggleBtn, ...(playlist.in_carousel ? { fontWeight: 700, background: "var(--terminal-green)", color: "#000" } : null) }}>
        {playlist.in_carousel ? "CAROUSEL ✓" : "CAROUSEL ✕"}
      </button>
      <button type="button" onClick={onEdit} style={toggleBtn}>{isFolder ? "VIEW" : "EDIT"}</button>
    </div>
  );
}

/* ── create / edit slide-over (hosted by the hub section or the /media/playlists page) ────────────────────────────────────────────── */
export function PlaylistEditor({ initial, files, onClose, variant = "classic" }: { initial: PlaylistWithStats | null; files: MediaFile[]; onClose: () => void; variant?: MediaPanelVariant }) {
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

  // The reorder/remove icons sat at 40px — under the 44px floor (#104 NOTE-3). v2 lifts them;
  // classic keeps 40 so the hub's editor is unchanged.
  const icon = variant === "v2" ? { ...miniIcon, minWidth: 44, minHeight: 44 } : miniIcon;

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
                          <button type="button" disabled={i === 0 || swap.isPending} onClick={() => swap.mutate({ a: it, b: items[i - 1] })} aria-label="Move up" style={icon}>▲</button>
                          <button type="button" disabled={i === items.length - 1 || swap.isPending} onClick={() => swap.mutate({ a: it, b: items[i + 1] })} aria-label="Move down" style={icon}>▼</button>
                          <button type="button" onClick={() => remove.mutate(it.file.id)} className="u-amber" aria-label="Remove" style={icon}>✕</button>
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
/** PLAY ON row button — 44px tap target (the mobile-first hub rule), full card width. */
const playBtn: CSSProperties = {
  fontFamily: MONO, fontSize: 13, letterSpacing: 1, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "transparent", padding: "6px 8px",
  minHeight: 44, width: "100%", cursor: "pointer", textAlign: "left",
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};
/** v2 rename row — a real 44px tap target, full card width (classic keeps the bare line).
 *  No `fontSize` here on purpose: `.staff-ui button` pins button text at 20px !important, so
 *  a value here would be a lie; the two inner spans carry their own inline sizes. */
const renameBtn: CSSProperties = {
  width: "100%", minHeight: 44, display: "flex", alignItems: "center", gap: 7,
  textAlign: "left", background: "transparent", border: "1px solid rgba(0,255,65,0.25)",
  color: "var(--terminal-green)", fontFamily: MONO, cursor: "pointer", padding: "0 8px",
  boxSizing: "border-box",
};
const miniIcon: CSSProperties = {
  fontFamily: MONO, fontSize: 14, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "transparent",
  minWidth: 40, minHeight: 40, cursor: "pointer", flexShrink: 0,
};
