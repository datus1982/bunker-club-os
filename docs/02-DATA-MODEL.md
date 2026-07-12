# 02 — Data Model

Complete target schema. Written as if greenfield; 03 covers mapping existing OptiDev data into it. All tables get `created_at timestamptz default now()`. UUIDs via `gen_random_uuid()`.

## Core / tenancy

```sql
create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,              -- 'Bunker Club'
  slug text unique not null,       -- 'bunker-club'
  timezone text not null default 'America/Chicago',
  settings jsonb not null default '{}'
);

create table profiles (            -- 1:1 with auth.users
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  email text,
  phone text,
  marketing_opt_in boolean not null default false,
  created_at timestamptz default now()
);
-- trigger: insert profile row on auth.users insert

create table venue_staff (
  venue_id uuid references venues not null,
  profile_id uuid references profiles not null,
  role text not null check (role in ('admin','host','staff')),
  primary key (venue_id, profile_id)
);
```

## Teams & membership (registration v2 — see 05)

```sql
create table teams (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues not null,
  name text not null,
  logo_url text,
  is_regular boolean not null default false,
  pin_hash text,                   -- bcrypt/argon2 via edge fn; NEVER selectable by anon (column-level RLS via view)
  archived boolean not null default false,
  created_at timestamptz default now(),
  unique (venue_id, name)
);

create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams on delete cascade not null,
  profile_id uuid references profiles not null,
  role text not null default 'member' check (role in ('captain','member')),
  added_by uuid references profiles,
  created_at timestamptz default now(),
  unique (team_id, profile_id)
);
```

Migration note: existing `teams.contact_*` fields + plaintext `pin_code` map into `profiles`/`team_members` where possible; plaintext PINs get hashed into `pin_hash` (they're 4–6 digit; hashing is hygiene not cryptography — the real fix is server-side verification).

## Seasons (schema ships Phase 1; feature ships Phase 4)

```sql
create table seasons (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues not null,
  name text not null,                    -- 'Summer 2026 Wasteland Circuit'
  starts_on date not null,
  ends_on date not null,
  scoring_mode text not null default 'best_n'
    check (scoring_mode in ('cumulative','placement','best_n')),
  best_n int,                            -- for best_n: count top N game results per team
  placement_points jsonb,                -- for placement: e.g. [10,7,5,3,2,1]
  playoff_size int,                      -- top N qualify for finals; null = no playoff
  finals_game_id uuid,                   -- set when finals night is created
  status text not null default 'upcoming' check (status in ('upcoming','active','completed')),
  constraint no_overlap exclude using gist (
    venue_id with =, daterange(starts_on, ends_on, '[]') with &&
  )
);
```

Auto-enrollment rule: NO season signup exists. A game's `season_id` is stamped at game creation if `game_date` falls inside an active season for that venue. Any team checked into that game is thereby "in the season." Standings derive from data.

## Games (existing schema, extended)

```sql
create table games (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues not null,
  season_id uuid references seasons,           -- nullable; stamped automatically
  game_date date not null,
  start_time timestamptz,
  status text not null default 'setup' check (status in ('setup','active','paused','stopped','completed')),
  questions_per_round int not null default 10,
  is_playoff boolean not null default false
);

create table game_teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games on delete cascade not null,
  team_id uuid references teams not null,
  display_name text,                            -- name-as-registered that night (history)
  checked_in_by uuid references profiles,       -- NEW: who tapped check-in
  wildcard_used_on_round int,
  tiebreaker_rank int,
  created_at timestamptz default now(),
  unique (game_id, team_id)
);
```

`rounds`, `scores`, `questions`, `game_display_state` port unchanged from the existing system (full definitions in existing migrations + schema dump; see 03), with `venue_id` reachable via `game_id` (no column needed on child tables).

`theme_settings` becomes rows in `venues.settings` jsonb OR a `venue_settings(venue_id, key, value)` table — prefer the table (matches existing code shape, trivially portable).

## Standings (the seasons engine)

One SQL view, not application code:

```sql
create view season_standings as
with game_results as (
  select g.season_id, gt.team_id, g.id as game_id, g.game_date,
         coalesce(sum(s.points),0) as game_points,
         rank() over (partition by g.id order by coalesce(sum(s.points),0) desc) as game_place
  from games g
  join game_teams gt on gt.game_id = g.id
  left join scores s on s.game_id = g.id and s.team_id = gt.team_id
  where g.season_id is not null and g.status = 'completed' and not g.is_playoff
  group by g.season_id, gt.team_id, g.id, g.game_date
)
select season_id, team_id,
       count(*) as games_played,
       sum(game_points) as total_points,           -- cumulative
       sum(case when game_place = 1 then 1 else 0 end) as wins
from game_results
group by season_id, team_id;
```

`best_n` and `placement` modes: compute in a Postgres function `season_leaderboard(season_id uuid)` that reads the season's `scoring_mode` and returns ranked rows (window functions over the same CTE — placement mode maps `game_place` through `placement_points`; best_n sums only each team's top N `game_points`). Keep ALL scoring logic in this one function so the portal, the display leaderboard, and the finals-qualification query cannot disagree.

Streaks (portal nicety): `team_streaks` view counting consecutive game_dates per team within a season.

## RLS strategy (the fix for the wide-open OptiDev policies)

- Default deny on all tables.
- **Public (anon) SELECT** only on what displays need: `games`, `rounds` (minus answers before reveal is acceptable to skip in v1 — display state gates it), `scores`, `game_teams`, `teams (safe columns via view: id, name, logo_url, is_regular)`, `game_display_state`, `venue_settings`, `seasons`, standings function.
- **Questions/answers:** anon SELECT allowed (display needs them) — acceptable; host controls what's shown. Optional hardening later: display reads via a security-definer function keyed to display_state.
- **Players (authenticated):** SELECT own profile, own memberships, their teams' history. INSERT/UPDATE limited to: own profile, `team_members` rows for teams they belong to (add teammates), `game_teams` check-in for their teams (via RPC, below).
- **pin_hash:** revoke column from anon/authenticated entirely; verification only via `verify-team-pin` edge function (service role).
- **host/admin:** full CRUD on venue's game data via `venue_staff` role checks in policies: `exists (select 1 from venue_staff vs where vs.profile_id = auth.uid() and vs.venue_id = <row's venue> and vs.role in (...))`.
- **Check-in is an RPC** (`check_in_team(game_id, team_id)` security definer): validates caller is a member OR provides valid PIN via the edge function first; inserts game_teams + zero-score backfill for completed rounds (port that logic from AddTeam.tsx into SQL so it's atomic).
