-- 0006 — Games + game_teams
-- Source: docs/02 (Games, existing schema extended). Legacy-only columns
-- (name, num_rounds, elapsed_time_seconds) are intentionally dropped per docs/02;
-- see scripts/import-legacy.ts for the mapping decision.

create table if not exists public.games (
  id                 uuid primary key default gen_random_uuid(),
  venue_id           uuid not null references public.venues,
  season_id          uuid references public.seasons,     -- nullable; stamped automatically at create
  game_date          date not null,
  start_time         timestamptz,
  status             text not null default 'setup'
                       check (status in ('setup','active','paused','stopped','completed')),
  questions_per_round int not null default 10,
  is_playoff         boolean not null default false,
  created_at         timestamptz default now()
);

create index if not exists idx_games_venue_status on public.games(venue_id, status);
create index if not exists idx_games_season       on public.games(season_id);

-- Now that games exists, wire the seasons.finals_game_id FK (set when a finals
-- night is created, docs/06).
alter table public.seasons
  drop constraint if exists seasons_finals_game_fk;
alter table public.seasons
  add constraint seasons_finals_game_fk
  foreign key (finals_game_id) references public.games on delete set null;

create table if not exists public.game_teams (
  id                     uuid primary key default gen_random_uuid(),
  game_id                uuid not null references public.games on delete cascade,
  team_id                uuid not null references public.teams,
  display_name           text,                            -- name-as-registered that night (history)
  checked_in_by          uuid references public.profiles, -- NEW (docs/02): who tapped check-in
  wildcard_used_on_round int,
  tiebreaker_rank        int,
  created_at             timestamptz default now(),
  unique (game_id, team_id)
);

create index if not exists idx_game_teams_game on public.game_teams(game_id);
create index if not exists idx_game_teams_team on public.game_teams(team_id);
