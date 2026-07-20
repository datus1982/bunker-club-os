-- 0052_playlist_shuffle_default.sql
--
-- Beat (owner, 2026-07-20): playlists should SHUFFLE by default "so its not just the same
-- sequence everytime". The per-playlist shuffle toggle already exists (0047 media_playlists.shuffle,
-- hub MEDIA LIBRARY + the web PlaylistProgram's session-seeded shuffle) — this just flips the
-- single lever: the column default becomes true, and every EXISTING playlist is set to shuffle.
--
-- The media-catalog-sync edge fn preserves hub edits across syncs (it never overwrites shuffle), so
-- a later manual un-shuffle in the hub sticks. Idempotent + safe to re-run.

alter table public.media_playlists alter column shuffle set default true;

-- Turn shuffle on for all current playlists (the bar's folder playlists synced from the mini PC +
-- any custom playlists). Manual un-shuffles after this migration are preserved by the sync.
update public.media_playlists set shuffle = true where shuffle is distinct from true;
