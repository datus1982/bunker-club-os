-- 0062_playlist_carousel_toggle.sql
--
-- Per-playlist CAROUSEL inclusion (owner beat 2026-08-21: keep the TV-show playlists out of the
-- carousel rotation). Additive, idempotent.
--
--   • media_playlists.in_carousel — true = this playlist participates in the CAROUSEL program's
--     rotation set (the `{kind:"carousel"}` program that plays a whole playlist through, then hops
--     to the next). Default TRUE so every existing playlist keeps today's behaviour — the carousel
--     set is unchanged until the owner un-toggles a playlist in the hub.
--
-- SCOPE (ratified): this flag governs ONLY the carousel rotation set. Manual playlist selection
-- (hub ProgramPanel, the media-control fn's `playlist` cmd, the Q-SYS `playlists` listing),
-- schedules/dayparts, and the virtual ALL-MEDIA sentinel all IGNORE it — an excluded playlist is
-- still fully selectable by hand and still schedulable as a daypart.
--
-- The media-catalog-sync fn upserts folder playlists with an explicit column list
-- (venue_id, name, source, folder_path — index.ts:291-300), so ON CONFLICT never writes this
-- column: a hub un-toggle survives every catalog sync, exactly like 0052's shuffle and 0053's
-- subtitles.

alter table public.media_playlists
  add column if not exists in_carousel boolean not null default true;

-- Ensure the default is TRUE even if a prior run created the column with a different default.
alter table public.media_playlists alter column in_carousel set default true;
