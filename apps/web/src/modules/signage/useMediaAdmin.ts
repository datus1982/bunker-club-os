import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { thumbUrl } from "./mediaProgram";
import type { MediaFile, MediaPlaylist, Presentation, MultiviewMain } from "./mediaProgram";
import type { ProgramHold, ScheduleProgram } from "./scheduleResolve";
import { collectPaged } from "./mediaPagination";

/**
 * Data layer for the hub MEDIA section (docs/15 M1). Writer/reader counterpart to
 * mediaProgram.ts's public display reader. All writes require has_module('signage') (RLS 0047,
 * admin implied). The catalog (media_files + folder playlists) is OWNED by the media-catalog-sync
 * edge fn — the hub only edits titles here and never touches folder-playlist membership; custom
 * playlists are fully hub-managed. Realtime-first: one channel per read invalidates its key.
 */

// (Re-export the display types so hub components import media types from one place.)
export type { MediaFile, MediaPlaylist, Presentation };

const FILE_COLS =
  "id, filename, title, hash, duration_seconds, width, height, size_bytes, thumb_path, status";

/* ── media library (files) ───────────────────────────────────────────────── */

export function useMediaFiles() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["media-admin", "files"],
    queryFn: async (): Promise<MediaFile[]> => {
      const data = await collectPaged<Omit<MediaFile, "thumb">>(async (from, to) => {
        const { data, error } = await supabase
          .from("media_files")
          .select(FILE_COLS)
          .eq("venue_id", VENUE_ID)
          .order("filename")
          .order("id") // stable tiebreak so range windows never overlap or skip a row
          .range(from, to);
        if (error) throw error;
        return (data ?? []) as unknown as Omit<MediaFile, "thumb">[];
      });
      return data.map((f) => ({ ...f, thumb: thumbUrl(f.thumb_path) }));
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("media-admin:files")
      .on("postgres_changes", { event: "*", schema: "public", table: "media_files", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["media-admin", "files"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return q;
}

/* ── playlists (with per-playlist stats) ─────────────────────────────────── */

export interface PlaylistWithStats {
  playlist: MediaPlaylist;
  /** Every item, regardless of file status. */
  itemCount: number;
  /** Items whose file is present (what actually plays). */
  presentCount: number;
  /** Summed duration of present items (seconds). */
  runtimeSeconds: number;
}

export function useMediaPlaylists() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["media-admin", "playlists"],
    queryFn: async (): Promise<PlaylistWithStats[]> => {
      type ItemStatRow = { playlist_id: string; file: { duration_seconds: number | null; status: string } | null };
      const [playlists, items] = await Promise.all([
        collectPaged<MediaPlaylist>(async (from, to) => {
          const { data, error } = await supabase
            .from("media_playlists")
            .select("id, name, source, folder_path, presentation, shuffle")
            .eq("venue_id", VENUE_ID)
            .order("source") // folder first? order name below
            .order("name")
            .order("id") // stable tiebreak for range paging
            .range(from, to);
          if (error) throw error;
          return (data ?? []) as unknown as MediaPlaylist[];
        }),
        collectPaged<ItemStatRow>(async (from, to) => {
          const { data, error } = await supabase
            .from("media_playlist_items")
            .select("playlist_id, file:media_files!inner(duration_seconds, status)")
            .order("playlist_id")
            .order("file_id") // stable tiebreak for range paging
            .range(from, to);
          if (error) throw error;
          return (data ?? []) as unknown as ItemStatRow[];
        }),
      ]);
      const statsById = new Map<string, { itemCount: number; presentCount: number; runtimeSeconds: number }>();
      for (const r of items) {
        const s = statsById.get(r.playlist_id) ?? { itemCount: 0, presentCount: 0, runtimeSeconds: 0 };
        s.itemCount += 1;
        if (r.file?.status === "present") {
          s.presentCount += 1;
          s.runtimeSeconds += r.file.duration_seconds ?? 0;
        }
        statsById.set(r.playlist_id, s);
      }
      return playlists.map((playlist) => ({
        playlist,
        ...(statsById.get(playlist.id) ?? { itemCount: 0, presentCount: 0, runtimeSeconds: 0 }),
      }));
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("media-admin:playlists")
      .on("postgres_changes", { event: "*", schema: "public", table: "media_playlists", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["media-admin", "playlists"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "media_playlist_items" },
        () => { qc.invalidateQueries({ queryKey: ["media-admin", "playlists"] }); qc.invalidateQueries({ queryKey: ["media-admin", "playlist-detail"] }); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return q;
}

/** One ordered playlist item joined to its file (all statuses — the editor shows missing rows). */
export interface PlaylistItemDetail {
  position: number;
  file: MediaFile;
}

/** The full membership of ONE playlist, ordered by position, for the editor slide-over. */
export function usePlaylistDetail(playlistId: string | null) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["media-admin", "playlist-detail", playlistId],
    enabled: !!playlistId,
    queryFn: async (): Promise<PlaylistItemDetail[]> => {
      const rows = await collectPaged<{ position: number; file: Omit<MediaFile, "thumb"> }>(async (from, to) => {
        const { data, error } = await supabase
          .from("media_playlist_items")
          .select(`position, file:media_files!inner(${FILE_COLS})`)
          .eq("playlist_id", playlistId as string)
          .order("position") // primary order; position has no unique constraint (M1 note)
          .order("file_id") // stable tiebreak so a tie straddling a page boundary can't dup/skip
          .range(from, to);
        if (error) throw error;
        return (data ?? []) as unknown as Array<{ position: number; file: Omit<MediaFile, "thumb"> }>;
      });
      return rows.map((r) => ({
        position: r.position,
        file: { ...r.file, thumb: thumbUrl(r.file.thumb_path) },
      }));
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("media-admin:playlist-detail")
      .on("postgres_changes", { event: "*", schema: "public", table: "media_playlist_items" },
        () => qc.invalidateQueries({ queryKey: ["media-admin", "playlist-detail"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return q;
}

/* ── mutations (plain async — components wrap in useMutation) ─────────────── */

/** Rename a library file (media_files.title; the sync never overwrites a hub-set title). */
export async function updateMediaTitle(id: string, title: string): Promise<void> {
  const { error } = await supabase.from("media_files").update({ title: title.trim() || null }).eq("id", id);
  if (error) throw error;
}

/** Per-playlist presentation toggle (framed ↔ fullbleed) — editable for BOTH sources. */
export async function setPlaylistPresentation(id: string, presentation: Presentation): Promise<void> {
  const { error } = await supabase.from("media_playlists").update({ presentation }).eq("id", id);
  if (error) throw error;
}

/** Per-playlist shuffle toggle — editable for BOTH sources. */
export async function setPlaylistShuffle(id: string, shuffle: boolean): Promise<void> {
  const { error } = await supabase.from("media_playlists").update({ shuffle }).eq("id", id);
  if (error) throw error;
}

/** Create a hub-built CUSTOM playlist (folder playlists are sync-owned). Returns the id. */
export async function createCustomPlaylist(name: string): Promise<string> {
  const { data, error } = await supabase
    .from("media_playlists")
    .insert({ venue_id: VENUE_ID, name: name.trim() || "NEW PLAYLIST", source: "custom" })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** Rename a custom playlist (folder names are owned by the sync — guarded in the UI). */
export async function renamePlaylist(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("media_playlists").update({ name: name.trim() || "PLAYLIST" }).eq("id", id);
  if (error) throw error;
}

/** Delete a custom playlist (cascade removes its items; a queued program keeps its id but
 *  resolves to empty → MEDIA HOST OFFLINE-style empty card until re-pointed). */
export async function deletePlaylist(id: string): Promise<void> {
  const { error } = await supabase.from("media_playlists").delete().eq("id", id);
  if (error) throw error;
}

/** Append a file to a custom playlist at the next position. */
export async function addPlaylistItem(playlistId: string, fileId: string, position: number): Promise<void> {
  const { error } = await supabase
    .from("media_playlist_items")
    .insert({ playlist_id: playlistId, file_id: fileId, position });
  if (error) throw error;
}

export async function removePlaylistItem(playlistId: string, fileId: string): Promise<void> {
  const { error } = await supabase
    .from("media_playlist_items")
    .delete()
    .eq("playlist_id", playlistId)
    .eq("file_id", fileId);
  if (error) throw error;
}

/** Swap two items' positions on the same playlist (▲/▼ reorder). */
export async function swapPlaylistItems(
  playlistId: string,
  a: { file_id: string; position: number },
  b: { file_id: string; position: number },
): Promise<void> {
  const e1 = await supabase.from("media_playlist_items").update({ position: b.position }).eq("playlist_id", playlistId).eq("file_id", a.file_id);
  if (e1.error) throw e1.error;
  const e2 = await supabase.from("media_playlist_items").update({ position: a.position }).eq("playlist_id", playlistId).eq("file_id", b.file_id);
  if (e2.error) throw e2.error;
}

/* ── slot program (the screen-card PROGRAM control) ──────────────────────── */

/** A program the hub can WRITE: ROTATION (null), playlist, capture (M2), or multiview (M3). */
export type WritableProgram =
  | { kind: "playlist"; playlist_id: string }
  | { kind: "capture"; device_match?: string; presentation?: "framed" | "fullbleed" }
  | { kind: "multiview"; main: MultiviewMain; panel_slot_id: string };

/**
 * Write a slot's program + the M3 hold pair (D4). null = ROTATION / follow the schedule (clears
 * the override). A non-null program is a manual OVERRIDE with a hold tier:
 *   'pin'      — permanent (used when the slot has NO schedule; unchanged from M1/M2).
 *   'boundary' — a plain flip; yields at the next schedule boundary.
 *   'event'    — a SPECIAL EVENT hold; survives boundaries, expires at the 04:00 rollover.
 * The caller (ProgramPanel) picks the tier from the SPECIAL EVENT toggle + whether a schedule exists.
 */
export async function setSlotProgram(
  slotId: string, program: WritableProgram | null, hold: ProgramHold = "boundary",
): Promise<void> {
  const update = program === null
    ? { program: null, program_hold: null, program_set_at: null }
    : { program, program_hold: hold, program_set_at: new Date().toISOString() };
  const { error } = await supabase.from("signage_slots").update(update).eq("id", slotId);
  if (error) throw error;
}

/** Clear the manual override so the slot follows its schedule again (RESUME SCHEDULE / D4/D5). */
export async function resumeSchedule(slotId: string): Promise<void> {
  return setSlotProgram(slotId, null);
}

/* ── panel slots (D2) + dayparts (D3) ───────────────────────────────────────── */

/** Create a dedicated multiview PANEL slot (kind='panel', portrait, no TV). Returns its id so the
 *  caller can point a multiview program at it. slug is unique — derive from the name + a suffix. */
export async function createPanelSlot(name: string): Promise<string> {
  const base = (name.trim() || "panel").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "panel";
  const slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  const { data, error } = await supabase
    .from("signage_slots")
    .insert({ venue_id: VENUE_ID, name: name.trim() || "BAR PANEL", orientation: "portrait", slug, kind: "panel" })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** Raw slot_program_schedule row shape (admin editor). */
export interface ScheduleRowRaw {
  id: string;
  slot_id: string;
  program: ScheduleProgram;
  days_of_week: string[];
  start_minute: number;
  end_minute: number;
  position: number;
  active: boolean;
}

/** A slot's dayparts for the admin schedule editor (raw columns; realtime via the hub channel). */
export function useSlotScheduleAdmin(slotId: string | null) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["media-admin", "schedule", slotId],
    enabled: !!slotId,
    queryFn: async (): Promise<ScheduleRowRaw[]> => {
      const { data, error } = await supabase
        .from("slot_program_schedule")
        .select("id, slot_id, program, days_of_week, start_minute, end_minute, position, active")
        .eq("slot_id", slotId as string)
        .order("position", { ascending: false })
        .order("id");
      if (error) throw error;
      return ((data ?? []) as Array<Omit<ScheduleRowRaw, "days_of_week"> & { days_of_week: string[] | null }>).map((r) => ({
        ...r, days_of_week: r.days_of_week ?? [],
      }));
    },
  });
  useEffect(() => {
    const ch = supabase
      .channel("media-admin:schedule")
      .on("postgres_changes", { event: "*", schema: "public", table: "slot_program_schedule" },
        () => qc.invalidateQueries({ queryKey: ["media-admin", "schedule"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
  return q;
}

/** ALL dayparts across the venue's slots (single-venue; the junction has no venue_id), grouped by
 *  slot_id — for the hub to show which screens have a schedule + the active-daypart chip. */
export function useAllScheduleRows() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["media-admin", "schedule", "all"],
    queryFn: async (): Promise<Map<string, ScheduleRowRaw[]>> => {
      const { data, error } = await supabase
        .from("slot_program_schedule")
        .select("id, slot_id, program, days_of_week, start_minute, end_minute, position, active")
        .order("position", { ascending: false });
      if (error) throw error;
      const m = new Map<string, ScheduleRowRaw[]>();
      for (const r of (data ?? []) as Array<Omit<ScheduleRowRaw, "days_of_week"> & { days_of_week: string[] | null }>) {
        const row: ScheduleRowRaw = { ...r, days_of_week: r.days_of_week ?? [] };
        if (!m.has(row.slot_id)) m.set(row.slot_id, []);
        m.get(row.slot_id)!.push(row);
      }
      return m;
    },
  });
  useEffect(() => {
    const ch = supabase
      .channel("media-admin:schedule-all")
      .on("postgres_changes", { event: "*", schema: "public", table: "slot_program_schedule" },
        () => qc.invalidateQueries({ queryKey: ["media-admin", "schedule"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
  return q;
}

export async function createScheduleRow(row: {
  slot_id: string; program: ScheduleProgram; days_of_week: string[];
  start_minute: number; end_minute: number; position: number;
}): Promise<void> {
  const { error } = await supabase.from("slot_program_schedule").insert(row);
  if (error) throw error;
}

export async function updateScheduleRow(id: string, patch: Partial<Omit<ScheduleRowRaw, "id" | "slot_id">>): Promise<void> {
  const { error } = await supabase.from("slot_program_schedule").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteScheduleRow(id: string): Promise<void> {
  const { error } = await supabase.from("slot_program_schedule").delete().eq("id", id);
  if (error) throw error;
}

/** A media-status chip label + tone for a file (PRESENT / MISSING / UNSUPPORTED). */
export function statusChip(status: MediaFile["status"]): { label: string; cls: string } {
  if (status === "present") return { label: "PRESENT", cls: "" };
  if (status === "missing") return { label: "MISSING", cls: "u-red" };
  return { label: "UNSUPPORTED", cls: "u-amber" };
}
