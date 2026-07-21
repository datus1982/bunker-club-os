-- 0055 — real movie posters for the media library (launch-night cross-promo arc).
-- Date: 2026-07-20. Branch: phase-movie-posters (stacks on 0047 media / 0054 now_playing).
--
-- The media library's only artwork today is the shell's frame-thumb (media_files.thumb_path —
-- a grabbed video frame). That reads as a muddy still on a NOW PLAYING cross-promo slide. This
-- adds a proper poster path, sourced out-of-band by scripts/fetch-movie-posters.ts (TMDB when a
-- TMDB_API_KEY is present, else the keyless Wikipedia/Wikimedia pageimages API — see that script's
-- header for why iTunes is not usable) → mirrored into the PUBLIC `signage` bucket at
-- media-posters/{venue}/{hash}.{jpg|png} (posters are jpg or png — the first Wikipedia pass stored
-- 259 jpg + 66 png; all well within 0037's 5 MB image bucket caps), and read by the Q-SYS
-- nowPlaying API (media-control v6) + the new `now_playing` signage template.
--
--   • media_files.poster_path — signage-bucket path to the poster, or NULL when none was found.
--     Consumers PREFER poster_path and FALL BACK to the existing thumb_path, so a null poster
--     never breaks a card (the thumb frame still shows).
--
-- Additive + idempotent. No RLS/grant change: media_files already grants anon+authenticated
-- SELECT at the table level (0047 public_read), so this new column is anon-readable with the rest
-- of the row — exactly what the TV (anon) and the Q-SYS status read need. No realtime change:
-- poster_path is written once by the out-of-band script, and neither the TV board nor the hub
-- subscribes to a poster-only change (the now_playing slide polls, it does not stream).

alter table public.media_files
  add column if not exists poster_path text;

-- ── signage_items template constraint: add 'now_playing' (same idiom as 0036/0042/0043) ──
-- The NOW PLAYING cross-promo slide is a new authored template; extend the CHECK to admit it,
-- keeping every existing member. Idempotent (drop-then-add).
alter table public.signage_items
  drop constraint if exists signage_items_template_check;
alter table public.signage_items
  add constraint signage_items_template_check
  check (template in ('drink_special','event','announcement','image_only','celebration','top_sellers','instagram','smart_toast','now_playing'));
