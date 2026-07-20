import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/supabaseClient";
import { collectPaged } from "./mediaPagination";

/**
 * Media module M1 — the PROGRAM tier data layer (docs/15).
 *
 * `signage_slots.program jsonb` (null = today's rotation) is the programmable bottom tier of
 * the slot mode ladder (takeover > MOMENT > live game > PROGRAM). resolveSlotMode is
 * UNCHANGED — a program only ever renders while mode === 'rotation' && slot.program != null,
 * so takeovers/moments/live games preempt every program exactly as they preempt rotation.
 *
 * Only `playlist` renders in M1; `capture` (M2) and `multiview` (M3) shapes are reserved so
 * the type + resolver never need widening later. The media files themselves live on the
 * media PC and are served over `http://127.0.0.1:{port}` by the Electron shell (a secure
 * context — mixed-content-safe, LAN-independent). This module is a pure realtime READER of
 * the media_* tables (TVs read anon), like every other display surface.
 */

/** The program shown in a multiview MAIN region — a playlist or a live capture (docs/15 M3 D8).
 *  Reuses the M1/M2 shapes verbatim; `presentation` is IGNORED in multiview (the geometry owns
 *  the 1312×738 stage — always contained). */
export type MultiviewMain =
  | { kind: "playlist"; playlist_id: string }
  | { kind: "capture"; device_match?: string };

/** Slot program shapes (docs/15 §Concept: PROGRAMS). null slot.program = rotation. */
export type SlotProgram =
  | { kind: "playlist"; playlist_id: string }
  // Capture (M2): the live UVC input (the Roku) via getUserMedia. `device_match` filters the
  // videoinput label (blank = first camera); `presentation` overrides the fullbleed default.
  | { kind: "capture"; device_match?: string; presentation?: Presentation; audio?: boolean }
  // Multiview (M3, D1/D8): a 16:9 main region (playlist|capture) + a portrait PANEL slot running
  // the existing rotation. Preempted whole by takeover/moment/game (D9 — resolveSlotMode unchanged).
  | { kind: "multiview"; main: MultiviewMain; panel_slot_id: string };

/**
 * The default localhost port the Electron media shell serves video on. A `?mediahost=host:port`
 * query param on the slot URL overrides it for unusual setups (e.g. the shell on a sidecar box,
 * or a dev machine serving from a different port). Both are documented on resolveMediaBase.
 */
export const MEDIA_SHELL_PORT = 48151;

/**
 * The base URL the media shell serves files from. Default `http://127.0.0.1:{MEDIA_SHELL_PORT}`
 * (127.0.0.1 is a secure context, so an https page may fetch from it — the whole reason the
 * shell serves locally). Override with `?mediahost=host:port` on the slot URL: the value is used
 * verbatim after an `http://` prefix (only added when the param carries no scheme), so
 * `?mediahost=192.168.1.50:48151` and `?mediahost=http://localhost:9000` both work.
 */
export function resolveMediaBase(search: URLSearchParams): string {
  const override = search.get("mediahost");
  if (override && override.trim()) {
    const v = override.trim();
    return /^https?:\/\//i.test(v) ? v.replace(/\/+$/, "") : `http://${v.replace(/\/+$/, "")}`;
  }
  return `http://127.0.0.1:${MEDIA_SHELL_PORT}`;
}

/** The playback URL for a content-hashed file: `{base}/media/{hash}` (the shell's route). */
export function mediaFileUrl(base: string, hash: string): string {
  return `${base}/media/${encodeURIComponent(hash)}`;
}

export type MediaStatus = "present" | "missing" | "unsupported";

export interface MediaFile {
  id: string;
  filename: string;
  title: string | null;
  hash: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  thumb_path: string | null;
  status: MediaStatus;
  /** Public URL of the mirrored thumbnail in the signage bucket (null when unsynced). */
  thumb: string | null;
}

export type Presentation = "framed" | "fullbleed";

export interface MediaPlaylist {
  id: string;
  name: string;
  source: "custom" | "folder";
  folder_path: string | null;
  presentation: Presentation;
  shuffle: boolean;
}

/** Turn a signage-bucket thumb path into a public URL (mirrors useInstagram's pattern). */
export function thumbUrl(path: string | null): string | null {
  return path ? supabase.storage.from("signage").getPublicUrl(path).data.publicUrl : null;
}

const FILE_COLS =
  "id, filename, title, hash, duration_seconds, width, height, size_bytes, thumb_path, status";

/**
 * The playlist a slot's `playlist` program should play right now: the playlist row + its items
 * (joined to media_files) in `position` order, filtered to `status='present'` — a missing file
 * never lands in the loop (the shell marks it missing when it leaves the folder). Realtime on
 * all three media tables so the loop live-updates: a title edit, a presentation flip, a reorder,
 * or the shell reporting a file present/missing all re-resolve without a reload.
 */
export function usePlaylistProgram(playlistId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["media", "program", playlistId],
    enabled: !!playlistId,
    queryFn: async (): Promise<{ playlist: MediaPlaylist | null; files: MediaFile[] }> => {
      const pid = playlistId as string;
      const [playlistRes, itemRows] = await Promise.all([
        supabase
          .from("media_playlists")
          .select("id, name, source, folder_path, presentation, shuffle")
          .eq("id", pid)
          .maybeSingle(),
        collectPaged<{ file: Omit<MediaFile, "thumb"> | null }>(async (from, to) => {
          const { data, error } = await supabase
            .from("media_playlist_items")
            .select(`position, file:media_files!inner(${FILE_COLS})`)
            .eq("playlist_id", pid)
            .eq("file.status", "present")
            .order("position") // primary order; position has no unique constraint (M1 note)
            .order("file_id") // stable tiebreak so a tie straddling a page boundary can't dup/skip
            .range(from, to);
          if (error) throw error;
          return (data ?? []) as unknown as Array<{ file: Omit<MediaFile, "thumb"> | null }>;
        }),
      ]);
      if (playlistRes.error) throw playlistRes.error;
      const playlist = (playlistRes.data as MediaPlaylist | null) ?? null;
      const files = itemRows
        .map((r) => r.file)
        .filter((f): f is Omit<MediaFile, "thumb"> => f !== null)
        .map((f) => ({ ...f, thumb: thumbUrl(f.thumb_path) }));
      return { playlist, files };
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("media:program")
      .on("postgres_changes", { event: "*", schema: "public", table: "media_files" },
        () => qc.invalidateQueries({ queryKey: ["media", "program"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "media_playlists" },
        () => qc.invalidateQueries({ queryKey: ["media", "program"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "media_playlist_items" },
        () => qc.invalidateQueries({ queryKey: ["media", "program"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return query;
}

/**
 * Split a Kodi-style title into its name + a trailing "(YYYY)" year, if present (owner beat
 * 2026-07-20: the framed-playlist chrome shows NOW SHOWING with the film's name + year).
 * "Labyrinth (1986)" → { title: "Labyrinth", year: "1986" }; "The Thing" → { title, year: null };
 * "Alien (Director's Cut)" → year stays null (parens carry no 4-digit year) so it renders as-is —
 * a manual hub-edited title is preserved verbatim minus a real trailing year.
 */
export function parseTitleYear(raw: string): { title: string; year: string | null } {
  const m = raw.match(/^(.*\S)\s*\((\d{4})\)\s*$/);
  if (m) return { title: m[1].trim(), year: m[2] };
  return { title: raw.trim(), year: null };
}

/**
 * The NOW SHOWING name + year for a playing file, or null when there is no file. Sources
 * media_files.title (the sync prettifies filenames; the hub can hand-edit it) and only falls back
 * to the filename (extension stripped) when the title is unset. Blank → null (no label).
 */
export function nowShowingParts(file: MediaFile | null | undefined): { title: string; year: string | null } | null {
  if (!file) return null;
  const raw = (file.title && file.title.trim()) || file.filename.replace(/\.[^.]+$/, "");
  const t = raw.trim();
  return t ? parseTitleYear(t) : null;
}

/** mm:ss for a duration (null → "—:—"). Shared by the display + the hub library. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—:—";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
