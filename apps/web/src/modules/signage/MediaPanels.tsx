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
import { formatDuration, posterOrThumbUrl, ALL_MEDIA_PLAYLIST_ID } from "./mediaProgram";
import { useIsMobile } from "@/shared/useIsMobile";
import { ConfirmDialog } from "@/shared/ui";
import { MONO, ghost } from "./signageAdminShared";
import { SlideOver } from "./SlideOver";
import { TAP } from "@/shared/ui/tokens";

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
  // Only read in the v2 branch below, but hooks can't sit behind the early returns.
  const narrow = useIsMobile();
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
  // v2 (§C1): a 2:3 poster reads recognizably narrower than the 16:9 crop did, so the column
  // minimum drops 200 → 160 and the phone gap tightens 12 → 10 — recovering some of the scroll
  // length the taller card adds, WITHOUT shrinking the image (recognizability over density).
  // Classic keeps 200/12 exactly.
  const isV2 = variant === "v2";
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(auto-fill,minmax(min(100%,${isV2 ? 160 : 200}px),1fr))`,
      gap: isV2 && narrow ? 10 : 12,
    }}>
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

/** v2 status ink (A4). PRESENT earns the calmed accent — the good state is the one an
 *  operator scanning 504 cards wants to skip past; MISSING is a true failure state and
 *  therefore inside red's budget; UNSUPPORTED is ambient/pending, i.e. amber. Classic keeps
 *  `statusChip().cls` exactly as it was (blank / `u-red` / `u-amber`). */
const V2_STATUS_INK: Record<MediaFile["status"], string> = {
  present: "st-accent",
  missing: "st-danger",
  unsupported: "st-amber",
};

/**
 * Split a trailing release year off a Kodi-style title: "Dr. No (1962)" → name "Dr. No", year
 * "1962". RENDER-TIME ONLY — nothing is written, and the rename editor still edits the whole
 * stored string (`file.title`), so there is no data change and no rename-semantics change.
 *
 * Deliberately conservative: the year must be a 4-digit 19xx/20xx in parentheses at the very END
 * of the string, with a non-space character before it. A title with no such suffix (every TV
 * episode row, "Freaks and Geeks - S01E07 - …") comes back unchanged, name = the whole string.
 */
function splitTitleYear(s: string): { name: string; year: string | null } {
  const m = /^(.*\S)\s*\((19\d{2}|20\d{2})\)\s*$/.exec(s);
  return m ? { name: m[1], year: m[2] } : { name: s, year: null };
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
  const isV2 = variant === "v2";
  // The PLAY-ON row's buttons carry `playBtn`, whose inline `fontSize: 13` is DEAD on a staff page:
  // `.staff-ui button { font-size: 1.25rem !important }` beats it, so they actually render at 20px
  // and "▶ PLAY ON…" measured 150/150 against a 150px box — flush to the edge, which is what read
  // as a truncated word. `st-body` is the v2 way to win that cascade (the ConfirmDialog lesson), so
  // in v2 these render at the token Body size like every other v2 control. Not a new size: the
  // rest of the v2 page is already 15px. Classic keeps its 20px buttons untouched.
  //
  // The idle label's trailing "…" also goes, in v2 only: an ellipsis flush against the button edge
  // reads as a TRUNCATED word, which is how "▶ PLAY ON…" got reported as a clipped label. "▾" says
  // "this opens a picker" and cannot be misread that way. Classic keeps "▶ PLAY ON…".
  const playBtnCls = isV2 ? "st-body" : undefined;

  // §C1 — the card image, v2 only. Source order is the TV's own waterfall, imported:
  // poster_path → thumb_path → the ▶ placeholder. The fit rule follows the house's imagery law:
  // a real one-sheet is pre-cropped to 2:3 by TMDB so cover-fit is safe; a thumb_path fallback is
  // a raw 16:9 frame grab nobody cropped to 2:3, so it letterboxes (contain) rather than losing
  // its edges. Classic stays on `file.thumb` in a 110px landscape box, byte-identical.
  const cardImg = isV2 ? posterOrThumbUrl(file.poster_path ?? null, file.thumb_path) : file.thumb;
  const isPoster = isV2 && !!file.poster_path;
  // §C2 fold: the YEAR is the datum that distinguishes Casino Royale 1954 / 1967 / 2006, and it
  // sat at the END of the title string — exactly what a 2-line clamp drops. It now renders as its
  // own element on the meta line, so it can never fall off. Render-time split only.
  const { name: titleName, year: titleYear } = isV2 ? splitTitleYear(display) : { name: display, year: null };

  return (
    <div className="terminal-border" style={{ display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
      <div style={{
        position: "relative",
        ...(isV2 ? { width: "100%", aspectRatio: "2 / 3" } : { height: 110 }),
        borderBottom: "1px solid rgba(0,255,65,0.2)", display: "flex", alignItems: "center", justifyContent: "center", background: "#030803",
      }}>
        {cardImg ? (
          <img src={cardImg} alt="" style={{ width: "100%", height: "100%", objectFit: isV2 && !isPoster ? "contain" : "cover", opacity: file.status === "present" ? 1 : 0.45 }} />
        ) : (
          <span style={{ fontSize: 34, opacity: 0.7 }}>▶</span>
        )}
        {variant === "v2" ? (
          // A4 (audit): on a page whose own header says "152 MISSING", whether the file is
          // actually on the bar PC is the card's headline fact — it was a 10px badge tied
          // in weight with the runtime counter in the opposite corner. In v2 it becomes the
          // most prominent thing on the card and the runtime demotes to the Disabled tier.
          // `st-pill` for the radius (a bare span still loses to the base `border-radius: 0
          // !important`), the ring via inset box-shadow because the token scope forces
          // `border-color: hairline !important` on every descendant, and an opaque ground
          // because a chip's 4%-white wash is unreadable over a bright poster.
          <>
            <span
              className={`st-pill st-body ${V2_STATUS_INK[file.status]}`}
              style={{
                position: "absolute", top: 8, left: 8,
                textTransform: "uppercase", fontWeight: 700, letterSpacing: 1,
                padding: "3px 10px",
                background: "rgba(2,6,10,0.92)",
                boxShadow: "inset 0 0 0 1px currentColor",
              }}
            >{chip.label}</span>
            <span
              className="st-t3"
              // bottom/right 6 → 8, matching the taller 2:3 frame's margins (§C1). Still the
              // demoted Disabled-tier peer of the status badge — do not promote it back.
              style={{ position: "absolute", bottom: 8, right: 8, fontSize: 12, letterSpacing: 1, padding: "1px 5px", background: "rgba(2,6,10,0.8)" }}
            >{formatDuration(file.duration_seconds)}</span>
            {/* §C2 fold: the rename control leaves the TITLE'S TEXT FLOW and becomes a corner
                affordance on the poster. Inside the title row its glyph + gap + padding took ~35px
                of a 152px line — a third of the text budget — which is why "Title (Year)" kept
                losing its year. The title row is now plain text at full card width, and this is
                the one control that opens the editor (no doubled affordance). 44×44 hit area, the
                visible chip drawn on the inner span because `.terminal-theme button` forces a
                transparent background. Top-RIGHT: top-left is the status badge, bottom-right the
                runtime chip. */}
            <button
              type="button"
              onClick={() => { setDraft(file.title ?? ""); setEditingTitle(true); }}
              title={`Rename ${display}`}
              aria-label={`Rename ${display}`}
              style={renameOverlayBtn}
            >
              <span
                className="st-pill st-t2"
                style={{ fontSize: 17, lineHeight: 1, padding: "5px 9px", background: "rgba(2,6,10,0.92)", boxShadow: "inset 0 0 0 1px currentColor" }}
              >✎</span>
            </button>
          </>
        ) : (
          <>
            <span className={chip.cls} style={{ position: "absolute", top: 6, left: 6, fontSize: 10, letterSpacing: 1, padding: "2px 5px", background: "#020602", border: "1px solid currentColor" }}>{chip.label}</span>
            <span style={{ position: "absolute", bottom: 6, right: 6, fontSize: 12, letterSpacing: 1, padding: "1px 5px", background: "#020602", border: "1px solid rgba(0,255,65,0.4)" }}>{formatDuration(file.duration_seconds)}</span>
          </>
        )}
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
          // §C2 — 2 lines, not 1 with an ellipsis: one line clipped every real title in the
          // library before its distinguishing part survived. After the fold the row is PLAIN TEXT
          // at the full card width (the ✎ moved to the poster corner), and the year has been
          // lifted out onto the meta line — so the two lines carry the NAME and nothing else.
          // `st-body` carries the size: 15px/1.5 Body role, and it is the only thing that can set
          // it here (the ConfirmDialog lesson — an !important beats any inline px).
          // The complete STORED string (name + year, exactly what the rename editor edits) stays
          // reachable on `title` + `aria-label`.
          <div
            className="st-body"
            title={display}
            aria-label={display}
            style={{
              minWidth: 0, overflow: "hidden",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              overflowWrap: "anywhere", textAlign: "left",
            }}
          >{titleName}</div>
        ) : (
          <button
            type="button"
            onClick={() => { setDraft(file.title ?? ""); setEditingTitle(true); }}
            title="Click to rename"
            style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", color: "var(--terminal-green)", fontFamily: MONO, fontSize: 18, cursor: "pointer", padding: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >{display}</button>
        )}
        {isV2 ? (
          // The meta line carries the provenance path AND — after the §C2 fold — the year, as its
          // own mono datum. The path keeps its 1-line ellipsis (it is provenance, not the
          // recognizability problem); the year is `flex: 0 0 auto` so the path can never squeeze it.
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 3, minWidth: 0 }}>
            {titleYear && <span className="st-mono st-t2" style={{ flex: "0 0 auto" }}>{titleYear}</span>}
            <span
              className="st-t3"
              style={{ minWidth: 0, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              title={file.filename}
            >{file.filename}</span>
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 3 }} title={file.filename}>{file.filename}</div>
        )}

        {/* PLAY ON — send this film to a screen right now (owner beat). Present files only: a
            missing/unsupported file has nothing to play. */}
        {canPlay && (
          <div style={{ marginTop: 8 }}>
            {!picking ? (
              <button
                type="button"
                onClick={() => setPicking(true)}
                title="Play this film now on a screen, then continue through the rest of the library"
                className={playBtnCls}
                style={playBtn}
              >{isV2 ? "▶ PLAY ON ▾" : "▶ PLAY ON…"}</button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11, letterSpacing: 1, opacity: 0.6, lineHeight: 1.4 }}>
                  STARTS THIS FILM, THEN THE REST OF THE LIBRARY
                </div>
                {screens.map((s) => (
                  <button key={s.id} type="button" disabled={play.isPending} onClick={() => play.mutate(s)} className={playBtnCls} style={playBtn}>
                    ▶ {s.name.toUpperCase()}
                  </button>
                ))}
                <button type="button" onClick={() => setPicking(false)} className={playBtnCls} style={{ ...playBtn, opacity: 0.6 }}>CANCEL</button>
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
/**
 * BEAT 8 (PR 6) — the `variant` that Beat 5 / Beat 7 already thread here now reaches the
 * FRAME and the leaves. Until this PR the editor branched only its icon floor and its delete
 * confirm, so a v2 page opened a tokened ConfirmDialog inside a classic-green drawer
 * (inventory §A row 10). Same shape as PR 2's ProgramPanel: ONE component, a `v2` fork at
 * each leaf, every branched `style` a WHOLE-OBJECT ternary whose classic arm is the shipped
 * literal key for key (so the serialised attribute order — and the innerHTML hash — of the
 * classic hub cannot move). NOTHING about behaviour moves: same `create`/`rename`/`del`/
 * `add`/`remove`/`swap` mutations with the same args, same `readOnly` derivation, same
 * `nextPos`, same ConfirmDialog. `openKey` is the caller's open-request identity (see
 * SlideOver) — the v2 page passes a fresh object per press so a ✕-then-re-press inside the
 * exit lands open; classic passes nothing and closes synchronously as it always has.
 */
export function PlaylistEditor({ initial, files, onClose, variant = "classic", openKey }: { initial: PlaylistWithStats | null; files: MediaFile[]; onClose: () => void; variant?: MediaPanelVariant; openKey?: unknown }) {
  const v2 = variant === "v2";
  const isFolder = initial?.playlist.source === "folder";
  const readOnly = isFolder; // folder name + membership are sync-owned
  const [name, setName] = useState(initial?.playlist.name ?? "");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  // Heading role = sentence case on v2 (the copy rule PR 2 set); classic keeps its caps.
  const titleV2 = isFolder ? "View folder playlist" : initial ? "Edit playlist" : "New playlist";

  // The reorder/remove icons sat at 40px — under the 44px floor (#104 NOTE-3). v2 lifts them;
  // classic keeps 40 so the hub's editor is unchanged. PR 6: the v2 twin is now geometry-only
  // (`iconV2`, bottom of file) — the `st-btn st-body` classes own its ink, face and size.
  const icon = v2 ? iconV2 : miniIcon;
  /** v2 leaf kit (PR 2's idiom): classes paint, twins carry geometry. An inline colour
   *  loses to the theme's !important green, so none is spent on the v2 arm. */
  const labelCls = v2 ? "st-label st-t2" : undefined;
  const noteCls = v2 ? "st-body st-t2" : undefined;
  const noteS = v2 ? undefined : { opacity: 0.6, fontSize: 15 };
  // DECISION: (Beat 8 PR 6) the per-clip ✕ is NEUTRAL on v2 — not danger, not amber. Danger
  // red is reserved for data loss (owner ruling): taking a clip out of a custom playlist is
  // reversible membership (the file stays in the library, the picker below re-adds it) and
  // classic never asked a confirm for it. Amber is §B's ambient/pending tone, not an action
  // tone — classic's `u-amber` here was a colour pick, not a state. Classic keeps `u-amber`.
  const removeCls = v2 ? "st-btn st-body" : "u-amber";
  // DECISION: (Beat 8 PR 6) the editor gains NO FRAMED/SHUFFLE/SUBS/CAROUSEL toggles. Those four
  // live on `PlaylistRow` (the list) and never on this sheet — adding them here would be a new
  // write surface (four more mutations reachable from a second place), not a token swap.
  /** Thumb frames: `border: "1px solid"` with no colour — the sheet blanket paints the hairline. */
  const thumbImgS = v2
    ? { width: 44, height: 30, objectFit: "cover" as const, border: "1px solid", flexShrink: 0 }
    : { width: 44, height: 30, objectFit: "cover" as const, border: "1px solid var(--terminal-green)", flexShrink: 0 };

  return (
    <SlideOver eyebrow="MEDIA ▸ PLAYLIST" title={v2 ? titleV2 : title} onClose={onClose} variant={variant} openKey={openKey}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* name */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* v2 splits the Label role (all-caps by definition) from its lowercase hint, so
              `text-transform: uppercase` never shouts "(FOLDER — READ-ONLY)". */}
          {/* Classic keeps its TWO JSX children (`NAME` + the conditional hint) so a folder renders
              the same two text nodes it always did — a template literal would collapse them into
              one node (PR 6 review WARN-1; React drops the `""` child, so the structure is exact). */}
          <span className={labelCls} style={v2 ? undefined : { fontSize: 14, letterSpacing: 2, opacity: 0.55 }}>{v2 ? "NAME" : <>NAME{isFolder ? " (folder — read-only)" : ""}</>}</span>
          {v2 && isFolder && <span className="st-body st-t2">Folder playlist — the name and its clips come from the media PC's folder, so they are read-only here.</span>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
              placeholder="playlist name"
              className={v2 ? "st-body" : undefined}
              style={v2
                ? { flex: "1 1 200px", minWidth: 0, border: "1px solid", padding: "10px 12px", minHeight: TAP, opacity: readOnly ? 0.6 : 1 }
                : { flex: "1 1 200px", minWidth: 0, background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "10px 12px", fontSize: 18, fontFamily: MONO, opacity: readOnly ? 0.6 : 1 }}
            />
            {/* `u-ink` rides with `st-btn-primary` (PR 2's pairing): `.st-sheet .st-btn-primary`
                paints the BUTTON's own colour, and the utility is what reaches any child. */}
            {!isFolder && !playlistId && (
              <button type="button" onClick={() => create.mutate()} disabled={create.isPending || !name.trim()} className={v2 ? "st-btn st-btn-primary u-ink st-body" : undefined} style={v2 ? ghostV2 : { ...ghost, fontWeight: 700 }}>{v2 ? "Create" : "CREATE"}</button>
            )}
            {!isFolder && playlistId && (
              <button type="button" onClick={() => rename.mutate()} disabled={rename.isPending} className={v2 ? "st-btn st-btn-primary u-ink st-body" : undefined} style={v2 ? ghostV2 : ghost}>{v2 ? "Save name" : "SAVE NAME"}</button>
            )}
          </div>
        </div>

        {!playlistId ? (
          <div className={noteCls} style={noteS}>{v2 ? "Name the playlist and create it, then add clips." : "Name the playlist and CREATE it, then add clips."}</div>
        ) : (
          <>
            {/* current items */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className={labelCls} style={v2 ? undefined : { fontSize: 14, letterSpacing: 2, opacity: 0.55 }}>CLIPS ({items.length})</span>
              {detailQ.isLoading ? (
                <div className={noteCls} style={noteS}>{v2 ? "Loading…" : "LOADING…"}</div>
              ) : items.length === 0 ? (
                <div className={noteCls} style={noteS}>Empty. Add clips from the library below.</div>
              ) : (
                items.map((it, i) => {
                  const chip = statusChip(it.file.status);
                  return (
                    // v2: the row is TOP-aligned so a two-line title (below) grows the row while the
                    // thumb and the three 44px icons keep their own height instead of stretching.
                    <div key={it.file.id} className={v2 ? "st-row" : "terminal-border"} style={v2 ? { padding: "7px 9px", display: "flex", alignItems: "flex-start", gap: 10 } : { padding: "7px 9px", display: "flex", alignItems: "center", gap: 10 }}>
                      {it.file.thumb
                        ? <img src={it.file.thumb} alt="" style={{ ...thumbImgS, opacity: it.file.status === "present" ? 1 : 0.45 }} />
                        : <span style={v2 ? { width: 44, height: 30, border: "1px solid", flexShrink: 0, display: "inline-block" } : { width: 44, height: 30, border: "1px solid var(--terminal-green)", flexShrink: 0, display: "inline-block" }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Every leaf carries its own role class: nothing inherits font-size
                            under `.terminal-theme *` (the PR #89 gotcha). */}
                        {/* v2: the Library card's TWO-LINE clamp instead of nowrap+ellipsis (Marvin
                            ruling on PR 6 NOTE-2 — a ten-character title beside three 44px icons is
                            Stephen's "cut-off titles" complaint). `title` carries the full string. */}
                        <div className={v2 ? "st-body" : undefined} title={v2 ? ((it.file.title ?? "").trim() || it.file.filename) : undefined} style={v2 ? { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" } : { fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(it.file.title ?? "").trim() || it.file.filename}</div>
                        <div className={v2 ? "st-body st-t3" : undefined} style={v2 ? undefined : { fontSize: 12, opacity: 0.55 }}>{formatDuration(it.file.duration_seconds)}{it.file.status !== "present" ? ` · ${chip.label}` : ""}</div>
                      </div>
                      {!readOnly && (
                        <>
                          <button type="button" disabled={i === 0 || swap.isPending} onClick={() => swap.mutate({ a: it, b: items[i - 1] })} aria-label="Move up" className={v2 ? "st-btn st-body" : undefined} style={icon}>▲</button>
                          <button type="button" disabled={i === items.length - 1 || swap.isPending} onClick={() => swap.mutate({ a: it, b: items[i + 1] })} aria-label="Move down" className={v2 ? "st-btn st-body" : undefined} style={icon}>▼</button>
                          <button type="button" onClick={() => remove.mutate(it.file.id)} className={removeCls} aria-label="Remove" style={icon}>✕</button>
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
                <span className={labelCls} style={v2 ? undefined : { fontSize: 14, letterSpacing: 2, opacity: 0.55 }}>ADD FROM LIBRARY</span>
                <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                  {files.length === 0 && <div className={noteCls} style={noteS}>No media synced yet.</div>}
                  {files.map((f) => {
                    const already = inPlaylist.has(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        disabled={already || add.isPending}
                        onClick={() => add.mutate(f.id)}
                        /* v2: a picker row is an interactive `st-row` (the sheet twin already
                           washes `button.st-row` on hover/press); `st-body` sizes the button itself. */
                        className={v2 ? "st-row st-body" : undefined}
                        style={v2
                          ? { display: "flex", gap: 10, alignItems: "center", border: "1px solid", padding: "6px 8px", cursor: already ? "default" : "pointer", minHeight: TAP, minWidth: TAP, opacity: already ? 0.4 : 1 }
                          : { display: "flex", gap: 10, alignItems: "center", background: "transparent", color: "var(--terminal-green)", border: "1px solid rgba(0,255,65,0.25)", padding: "6px 8px", cursor: already ? "default" : "pointer", fontFamily: MONO, minHeight: 44, opacity: already ? 0.4 : 1 }}
                      >
                        {f.thumb
                          ? <img src={f.thumb} alt="" style={v2 ? { width: 40, height: 28, objectFit: "cover", border: "1px solid", flexShrink: 0 } : { width: 40, height: 28, objectFit: "cover", border: "1px solid var(--terminal-green)", flexShrink: 0 }} />
                          : <span style={v2 ? { width: 40, height: 28, border: "1px solid", flexShrink: 0, display: "inline-block" } : { width: 40, height: 28, border: "1px solid var(--terminal-green)", flexShrink: 0, display: "inline-block" }} />}
                        <span className={v2 ? "st-body" : undefined} style={v2 ? { flex: 1, minWidth: 0, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : { flex: 1, minWidth: 0, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 16 }}>{(f.title ?? "").trim() || f.filename}</span>
                        <span className={v2 ? "st-label st-t3" : undefined} style={v2 ? undefined : { fontSize: 12, opacity: 0.55 }}>{already ? "ADDED" : "+ ADD"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!isFolder && (
              <div style={{ marginTop: 4 }}>
                <button
                  type="button"
                  // §C4 — v2 draws the ratified ConfirmDialog instead of the browser's
                  // `confirm()`; classic keeps `confirm()` untouched. SAME guard, SAME single
                  // `del` mutation, no double prompt — only the confirm SURFACE differs.
                  // DECISION: gated on `variant` rather than swapped for both. ConfirmDialog is a
                  // token-scoped v2 primitive (`st-sheet`/`st-panel`/`st-btn`), so rendering it
                  // inside the un-tokened classic hub would be a visual change to classic for no
                  // gain — and Beat 6 set the precedent when Users kept classic on `confirm()`
                  // and gave only v2 the sheet.
                  onClick={() => {
                    if (v2) { setConfirmDelete(true); return; }
                    if (confirm("Delete this playlist? Clips stay in the library; any screen pointed at it falls back to an empty program until re-pointed.")) del.mutate();
                  }}
                  /* Deleting the playlist IS data loss (the custom membership is gone), so v2
                     wears the danger ink the token sheet reserves for it; classic keeps its red literal. */
                  className={v2 ? "st-btn st-btn-danger st-body" : "u-red"}
                  style={v2 ? ghostV2 : { ...ghost, color: "var(--terminal-red,#ff5555)", borderColor: "var(--terminal-red,#ff5555)" }}
                >{v2 ? "Delete playlist" : "DELETE PLAYLIST"}</button>
              </div>
            )}
          </>
        )}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${initial?.playlist.name ?? name}?`}
          // The existing sentence, verbatim (§C4) — only the surface changes, not the copy.
          body="Clips stay in the library; any screen pointed at it falls back to an empty program until re-pointed."
          confirmLabel="Delete playlist"
          cancelLabel="Keep playlist"
          danger
          busy={del.isPending}
          onConfirm={() => { setConfirmDelete(false); del.mutate(); }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
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
/** v2 rename control — a 44×44 corner affordance on the poster (§C2 fold), replacing the row that
 *  used to sit inside the title's text flow. WIDTH and height both clear the tap floor (#103
 *  NOTE-6: a height-only harness once missed a 34px-wide button). The hit area is transparent and
 *  borderless; the visible chip is the inner span, because `.terminal-theme button` forces
 *  `background: transparent !important` and no inline background can win. No `fontSize` here on
 *  purpose — `.staff-ui button` pins button text at 20px !important, so the span carries its own. */
const renameOverlayBtn: CSSProperties = {
  position: "absolute", top: 0, right: 0, width: 44, height: 44,
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "transparent", border: "none", padding: 0,
  color: "var(--terminal-green)", fontFamily: MONO, cursor: "pointer", boxSizing: "border-box",
};
const miniIcon: CSSProperties = {
  fontFamily: MONO, fontSize: 14, color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)", background: "transparent",
  minWidth: 40, minHeight: 40, cursor: "pointer", flexShrink: 0,
};
/* v2 twins (Beat 8 PR 6) — geometry only, PR 2's idiom: no `fontFamily`/`fontSize` (the
 * `st-body` role owns the face and the 15px), no `background`/`color` (an inline colour cannot
 * beat the theme's !important green — the `st-btn*` classes are what paint), and
 * `border: "1px solid"` with no colour so the sheet blanket paints the hairline (the
 * ConfirmDialog idiom). `minWidth: TAP` joins `minHeight`: the 44px floor is measured on
 * BOTH axes (#103 NOTE-6). `iconV2` is the 40px `miniIcon` lifted to the floor — the same
 * lift Beat 5 shipped as `{ ...miniIcon, minWidth: 44, minHeight: 44 }`, minus the literals. */
const ghostV2: CSSProperties = { padding: "8px 12px", minWidth: TAP, minHeight: TAP, border: "1px solid", cursor: "pointer" };
const iconV2: CSSProperties = { minWidth: TAP, minHeight: TAP, border: "1px solid", cursor: "pointer", flexShrink: 0 };
