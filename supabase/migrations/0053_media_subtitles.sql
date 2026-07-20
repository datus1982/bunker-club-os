-- 0053_media_subtitles.sql
--
-- Media shell v0.2 subtitles (docs/15). Additive, idempotent.
--
--   • media_files.has_subtitles  — the shell reports it per file (a Kodi-style `.srt` sidecar sits
--     next to the video; the shell serves it as WebVTT at /subs/{hash} and sets this flag in the
--     catalog payload). Default FALSE — a v0.1 shell never sends it, so existing rows stay false and
--     nothing changes on the TV until the mini PC is updated.
--   • media_playlists.subtitles — the per-playlist ON/OFF toggle for rendering the subtitle track.
--     Owner ruling (2026-07-20, live at the bar): "make subtitles on by default for all playlists,
--     they usually are." So the column DEFAULTS TRUE and every existing playlist is flipped to true
--     — the same single-lever pattern as 0052's shuffle default. A manual hub un-toggle sticks: the
--     media-catalog-sync fn never overwrites media_playlists.subtitles (it only writes name/source on
--     folder-playlist conflict), so a later OFF in the hub survives every sync.
--
-- The <track> only ever renders when the playlist's `subtitles` is on AND the current file's
-- `has_subtitles` is true — so with the v0.1 shell installed (has_subtitles always false) the TV is
-- unaffected regardless of the playlist default.

-- ── media_files.has_subtitles (default false — a v0.1 shell never reports it) ──
alter table public.media_files add column if not exists has_subtitles boolean not null default false;

-- ── media_playlists.subtitles (owner ruling: default TRUE + flip all existing rows) ──
alter table public.media_playlists add column if not exists subtitles boolean not null default true;

-- Ensure the default is TRUE even if a prior run created the column with a different default.
alter table public.media_playlists alter column subtitles set default true;

-- Turn subtitles on for every current playlist (folder + custom). Manual un-toggles after this
-- migration are preserved by the sync (it never writes this column). Idempotent + safe to re-run.
update public.media_playlists set subtitles = true where subtitles is distinct from true;
