-- 0005 — Seasons
-- Source: docs/02 (Seasons) + docs/06. Schema ships now (Phase 0); feature ships
-- Phase 4. No signup: a game's season_id is stamped at creation if its date falls
-- inside an active season (auto-enrollment lives in the game-create path, docs/06).

create table if not exists public.seasons (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references public.venues,
  name             text not null,                       -- 'Summer 2026 Wasteland Circuit'
  starts_on        date not null,
  ends_on          date not null,
  scoring_mode     text not null default 'best_n'
                     check (scoring_mode in ('cumulative','placement','best_n')),
  best_n           int,                                 -- best_n mode: count each team's top N nights
  placement_points jsonb,                               -- placement mode: e.g. [10,7,5,3,2,1]
  playoff_size     int,                                 -- top N qualify for finals; null = no playoff
  finals_game_id   uuid,                                -- FK added after games exists (0006)
  status           text not null default 'upcoming'
                     check (status in ('upcoming','active','completed')),
  created_at       timestamptz default now(),
  -- No two seasons for one venue may overlap in date range (inclusive bounds).
  constraint seasons_no_overlap exclude using gist (
    venue_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  )
);

create index if not exists idx_seasons_venue_status on public.seasons(venue_id, status);
