-- 0060 — Scoring console rebuild (owner spec): a persisted game clock + an explicit
-- LANDSCAPE display stage, both on game_display_state. Additive and INERT for the code
-- at HEAD — nothing reads either column until the rebuilt Scoring console / GameDisplay
-- ship, so this is safe to apply to the live project ahead of the merge (like 0038 did
-- for board_stage).
--
-- clock_started_at — the timestamp START was pressed. The Scoring console derives the
--   host game clock as (now − clock_started_at), ticking on a local 1s timer, so the
--   elapsed time survives a reload (the value lives in the DB, not React state). null =
--   the clock is stopped (shown 0:00). Only the console's START writes it; END GAME
--   leaves the game (it moves to History), so no explicit stop write is needed.
--
-- display_stage — the LANDSCAPE audience board (trivia/GameDisplay) is a single-select
--   between five host-driven stages, mirroring what board_stage (0038) already does for
--   the PORTRAIT leaderboard. The two controls are INDEPENDENT and fully manual:
--     'qr'      — the SCAN-TO-JOIN board (reuses the pre-game holding visual)
--     'qa'      — the question/answer projector (default; keeps is_display_active
--                 semantics — the projector's SHOW QUESTION still gates the question)
--     'video'   — plays the next-incomplete round's video_url, DECOUPLED from
--                 current_round_id/current_question_index so question nav can never
--                 interrupt or advance the video (owner bug 2026-07-22)
--     'upnext'  — an "UP NEXT — ROUND X · <category>" card from the next round
--     'thanks'  — a "THANK YOU FOR PLAYING" card
--
--   DEFAULT 'qa': existing rows (incl. the currently-live game) get 'qa', which maps to
--   today's landscape behavior exactly — the question projector gated by
--   is_display_active shows the "WAITING FOR ROUND TO BEGIN" screen until the host shows
--   a question. So the default seizes nothing.
--
--   IDLE / ROTATION GATE (unchanged): display_stage is only ever consulted once the bar
--   TV is ALREADY in game mode, which the arm model alone decides — the landscape enters
--   game mode only when trivia is EFFECTIVELY armed (0056/0057) AND a game is present,
--   and renders GameDisplay only when that game is active/paused (else the holding
--   board). When not armed / no game, the TV stays on rotation/media and never reads
--   display_stage. Adding this column therefore cannot put trivia on a screen the host
--   hasn't armed — the fail-safe of 0056/0057 is untouched.
--
-- RLS: game_display_state already carries the anon public_read (0011) + the
-- has_module('trivia') write gate (0024) over every column, so both new columns ride the
-- existing policies — no new grant. Anon writes stay rejected; host{trivia} writes
-- succeed. board_stage's own check/values are NOT touched.

alter table public.game_display_state
  add column if not exists clock_started_at timestamptz;

alter table public.game_display_state
  add column if not exists display_stage text not null default 'qa'
    check (display_stage in ('qr', 'qa', 'video', 'upnext', 'thanks'));

comment on column public.game_display_state.clock_started_at is
  'Timestamp START was pressed in the Scoring console (0060). The host game clock is '
  'derived as now − clock_started_at, ticking on a local 1s timer, so elapsed time '
  'survives a reload. null = clock stopped (0:00). Only the console START writes it.';

comment on column public.game_display_state.display_stage is
  'Manual LANDSCAPE audience-board stage set by the Scoring DISPLAY control (0060): '
  'qr | qa | video | upnext | thanks. Independent of board_stage (the PORTRAIT control). '
  'video plays the next-incomplete round video decoupled from current_round_id so '
  'question nav never interrupts it. Only ever read once the arm model has already put '
  'the game on the landscape TV (0056/0057) — default qa maps to today''s behavior.';
