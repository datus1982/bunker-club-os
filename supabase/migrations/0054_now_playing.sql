-- 0054 — now-playing enrichment for the Q-SYS status API (docs/15).
-- Date: 2026-07-20. Branch: phase-qsys-nowplaying (stacks on phase-qsys-v3 / PR #62).
--
-- The Q-SYS `status` command (media-control fn) can report WHAT a landscape screen is playing
-- (program kind/source/hold + playlist name) but NOT which film is on screen right now — the
-- shuffle position lives only in the TV browser. This adds a narrow, spoofable-harmless channel
-- for the TV to report its current file so the iPad UCI can show TITLE · YEAR · poster art (like
-- the Sonos "now playing" card).
--
--   • signage_slots.now_playing_file_id — the media_files row the TV is currently playing
--     (on delete set null: a file leaving the library never dangles the pointer).
--   • signage_slots.now_playing_at — when it was last reported. The fn treats it as fresh for
--     15 min; a stale/absent stamp ⇒ no nowPlaying (the UCI falls back to the playlist name).
--   • report_now_playing(p_slug, p_file_id) — a SECURITY DEFINER RPC the anon TV page calls
--     fire-and-forget on each advance + a 5-min refresh. Anon has no UPDATE grant on
--     signage_slots (writes are has_module('signage') only), so a definer RPC is the safe
--     touch-two-columns path — the SAME advisory-trust pattern as signage_heartbeat (0028): the
--     data is DISPLAY-ONLY and spoofable-harmless (a bad actor could at worst mislabel the UCI's
--     now-playing card; nothing is authorized off it). See 0028's accepted N5 note.
--
-- The RPC's body is a fixed UPDATE of exactly those two columns for the named slug — it cannot be
-- coerced into writing any other column (its contract is the statement, not a parameter).
--
-- Additive + idempotent. No realtime change needed: neither the TV board (useSignage Slot select)
-- nor the hub reads now_playing_*, and the slotRealtime.ts render-field whitelist already skips
-- any signage_slots UPDATE that touches only non-render fields, so these writes cause zero churn.

-- ── columns ──────────────────────────────────────────────────────────────────
alter table public.signage_slots
  add column if not exists now_playing_file_id uuid references public.media_files(id) on delete set null,
  add column if not exists now_playing_at timestamptz;

-- ── report_now_playing(slug, file_id) — public display-only ping ──────────────
-- SECURITY DEFINER so the anon slot page can stamp its current file without an UPDATE grant.
-- Bound parameters (no injection surface); stamps exactly the two now_playing_* columns for the
-- named slug and nothing else. Safe to grant anon (advisory trust class — see the header note).
create or replace function public.report_now_playing(p_slug text, p_file_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.signage_slots
     set now_playing_file_id = p_file_id,
         now_playing_at = now()
   where slug = p_slug;
$$;

revoke all on function public.report_now_playing(text, uuid) from public;
grant execute on function public.report_now_playing(text, uuid) to anon, authenticated;
