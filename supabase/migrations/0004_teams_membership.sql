-- 0004 — Teams, team members, safe public view
-- Source: docs/02 (Teams & membership). Legacy contact_*/notes/pin_code map in via
-- scripts/import-legacy.ts (docs/03), NOT as columns here — docs/02 is greenfield.

create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  venue_id   uuid not null references public.venues,
  name       text not null,
  logo_url   text,
  is_regular boolean not null default false,
  pin_hash   text,                    -- hashed via verify-team-pin edge fn; never exposed to anon/auth
  archived   boolean not null default false,
  created_at timestamptz default now(),
  unique (venue_id, name)
);

create table if not exists public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams on delete cascade,
  profile_id uuid not null references public.profiles,
  role       text not null default 'member' check (role in ('captain','member')),
  added_by   uuid references public.profiles,
  created_at timestamptz default now(),
  unique (team_id, profile_id)
);

create index if not exists idx_team_members_team    on public.team_members(team_id);
create index if not exists idx_team_members_profile on public.team_members(profile_id);

-- Safe columns only — the surface anon displays & other teams may read. Excludes
-- pin_hash and all contact info. This is a DEFINER view on purpose (default view
-- semantics): anon has no privilege on the base teams table (0011 revokes it), so
-- the view runs with owner rights and exposes ONLY these five columns. pin_hash
-- can never leak through it. Public SELECT is granted on the view in 0011.
create or replace view public.teams_public as
  select id, venue_id, name, logo_url, is_regular
  from public.teams
  where archived = false;
