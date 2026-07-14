-- 0038 — Manual leaderboard board stage (owner trivia-host choreography note)
--
-- The host runs the public leaderboard as choreography: a JOIN QR while teams
-- arrive, a "scores sealed" holding screen while entering scores, LIVE STANDINGS
-- between rounds, and a deliberate FINAL REVEAL at the end. Legacy encoded only the
-- GAME OVER moment (game_display_state.show_game_over); everything else auto-derived
-- from game/round state, so the host had no manual control over what the room saw.
--
-- This adds a single explicit stage that the Scoring console's segmented control
-- writes, and the public leaderboard surface (trivia/Leaderboard.tsx — shared by the
-- /leaderboard route AND the signage portrait game-mode board) renders from.
--
--   'qr'        — big JOIN QR, no scores visible
--   'scoring'   — "scores sealed" holding screen, no scores visible
--   'standings' — the live standings board (default; existing behavior)
--   'final'     — the FINAL SCORES / GAME OVER reveal
--
-- show_game_over is KEPT (legacy readers + the END GAME / final-round-complete flows
-- still raise it). The display treats final as reachable via EITHER board_stage='final'
-- OR show_game_over OR a completed game, so END GAME and the manual FINAL REVEAL both
-- land the room on the final board without any code auto-flipping board_stage. Only the
-- Scoring segmented control ever writes board_stage.
--
-- RLS: game_display_state already has the anon public_read (0011) + trivia-module write
-- gate (0024) covering every column, so board_stage rides the existing policies — no new
-- grant. Anon writes stay rejected; host{trivia} writes succeed.

alter table public.game_display_state
  add column if not exists board_stage text not null default 'standings'
    check (board_stage in ('qr', 'scoring', 'standings', 'final'));

comment on column public.game_display_state.board_stage is
  'Manual public-leaderboard stage set by the Scoring segmented control (0038): '
  'qr | scoring | standings | final. The display keys on this; show_game_over is kept '
  'for legacy readers and the END GAME / final-round flows (which raise it without '
  'touching board_stage). No code auto-flips board_stage — only the host control does.';

-- Backfill: any game already showing GAME OVER is at the final stage.
update public.game_display_state
   set board_stage = 'final'
 where show_game_over = true
   and board_stage = 'standings';
