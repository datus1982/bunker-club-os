-- 0007 — Trivia core: rounds, scores, questions, game_display_state
-- Source: docs/02 ("port unchanged from the existing system"). rounds & scores
-- predate the legacy migrations folder (docs/03); their DDL is reconstructed here
-- from the legacy TS types + query shapes. questions & game_display_state are
-- lifted verbatim from the legacy migrations (uuid_generate_v4 -> gen_random_uuid).
-- Constraints kept permissive on legacy-authored columns so import cannot be
-- rejected by data that the live system currently accepts.

-- ── rounds ─────────────────────────────────────────────────────────────────
create table if not exists public.rounds (
  id                     uuid primary key default gen_random_uuid(),
  game_id                uuid not null references public.games on delete cascade,
  round_number           int  not null,
  round_type             text not null default 'regular',  -- 'regular' | 'final' | 'bonus' (no check: accept legacy verbatim)
  after_round            int,
  is_complete            boolean not null default false,
  max_points             int,
  bonus_description      text,
  bonus_type             text,                              -- 'standard' | 'three-chance'
  bonus_round_numbers    int[],
  bonus_points_per_round int[],
  round_name             text,                              -- theme, e.g. 'General Knowledge'
  picture_url            text,                              -- picture-round image (Storage)
  video_url              text,                              -- inter-round video (YouTube etc.)
  created_at             timestamptz default now()
);
create index if not exists idx_rounds_game on public.rounds(game_id);

-- ── scores ─────────────────────────────────────────────────────────────────
-- Points per team per round. The seasons standings math sums these per game/team,
-- so exactly one row per (game, round, team) is required — the unique constraint
-- surfaces any legacy dupes during import (docs/03 FK/integrity check) rather than
-- silently double-counting.
create table if not exists public.scores (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games  on delete cascade,
  round_id   uuid not null references public.rounds on delete cascade,
  team_id    uuid not null references public.teams,
  points     int  not null default 0,
  created_at timestamptz default now(),
  unique (game_id, round_id, team_id)
);
create index if not exists idx_scores_game on public.scores(game_id);
create index if not exists idx_scores_team on public.scores(team_id);

-- ── questions (verbatim from legacy 20260301120000) ────────────────────────
create table if not exists public.questions (
  id              uuid primary key default gen_random_uuid(),
  game_id         uuid not null references public.games  on delete cascade,
  round_id        uuid not null references public.rounds on delete cascade,
  question_number int  not null,
  question_text   text not null,
  answer_text     text not null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (game_id, round_id, question_number)
);
create index if not exists idx_questions_game_round on public.questions(game_id, round_id);
create index if not exists idx_questions_round      on public.questions(round_id);

-- ── game_display_state (verbatim from legacy, all later ALTERs folded in) ───
create table if not exists public.game_display_state (
  id                     uuid primary key default gen_random_uuid(),
  game_id                uuid not null references public.games on delete cascade,
  current_round_id       uuid references public.rounds on delete set null,
  current_question_index int  default 0,
  show_answer            boolean default false,
  is_display_active      boolean default false,
  show_video             boolean default false,
  show_game_over         boolean default false,
  updated_at             timestamptz default now(),
  unique (game_id)
);
create index if not exists idx_game_display_state_game on public.game_display_state(game_id);
