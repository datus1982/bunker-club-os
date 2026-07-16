import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/supabaseClient";

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

/** Slot program shapes (docs/15 §Concept: PROGRAMS). null slot.program = rotation. */
export type SlotProgram =
  | { kind: "playlist"; playlist_id: string }
  // Reserved (M2/M3) — typed now so the resolver + Slot type never need widening.
  | { kind: "capture"; device_match?: string; audio?: boolean }
  | { kind: "multiview"; main?: unknown; panel_slot_id?: string };

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
      const [playlistRes, itemsRes] = await Promise.all([
        supabase
          .from("media_playlists")
          .select("id, name, source, folder_path, presentation, shuffle")
          .eq("id", pid)
          .maybeSingle(),
        supabase
          .from("media_playlist_items")
          .select(`position, file:media_files!inner(${FILE_COLS})`)
          .eq("playlist_id", pid)
          .eq("file.status", "present")
          .order("position"),
      ]);
      if (playlistRes.error) throw playlistRes.error;
      if (itemsRes.error) throw itemsRes.error;
      const playlist = (playlistRes.data as MediaPlaylist | null) ?? null;
      const files = ((itemsRes.data ?? []) as unknown as Array<{ file: Omit<MediaFile, "thumb"> | null }>)
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

/** mm:ss for a duration (null → "—:—"). Shared by the display + the hub library. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—:—";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
