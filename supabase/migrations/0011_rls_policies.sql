-- 0011 — Row-Level Security: default deny, scoped grants
-- Source: docs/02 (RLS strategy) — the fix for OptiDev's wide-open policies.
--   • Public (anon) SELECT only on what unattended displays need (read-only).
--   • Players (authenticated): own profile, own memberships, their teams' data;
--     writes limited to own profile, team_members for their teams, check-in via RPC.
--   • Staff: full CRUD on their venue's data via venue_staff role checks.
--   • pin_hash: never selectable by anon/authenticated — verify only via edge fn.

-- Helper: a game's venue, security definer so child-table policies don't recurse
-- through games' own RLS.
create or replace function public.game_venue(p_game_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select venue_id from public.games where id = p_game_id $$;

-- ── Enable RLS everywhere (default deny) ────────────────────────────────────
alter table public.venues             enable row level security;
alter table public.venue_settings     enable row level security;
alter table public.profiles           enable row level security;
alter table public.venue_staff        enable row level security;
alter table public.teams              enable row level security;
alter table public.team_members       enable row level security;
alter table public.seasons            enable row level security;
alter table public.games              enable row level security;
alter table public.game_teams         enable row level security;
alter table public.rounds             enable row level security;
alter table public.scores             enable row level security;
alter table public.questions          enable row level security;
alter table public.game_display_state enable row level security;
alter table public.signage_slots      enable row level security;
alter table public.signage_items      enable row level security;
alter table public.screen_takeovers   enable row level security;
alter table public.toast_menu_cache   enable row level security;
alter table public.scheduled_events   enable row level security;

-- ── Public display reads (anon + authenticated) ─────────────────────────────
-- Read-only, safe to leave on an unattended screen. Explicit table-level grants
-- so we don't rely on Supabase's implicit default privileges, and so the
-- security_invoker standings views resolve for anon.
do $$
declare t text;
begin
  foreach t in array array[
    'venues','venue_settings','seasons','games','game_teams','rounds','scores',
    'questions','game_display_state','signage_slots','signage_items',
    'screen_takeovers','toast_menu_cache','scheduled_events'
  ] loop
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('drop policy if exists public_read on public.%I', t);
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- ── profiles ────────────────────────────────────────────────────────────────
-- Insert is via the on_auth_user_created trigger (security definer); no insert policy.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ── venue_staff (a user reads their own roles; admins manage) ────────────────
drop policy if exists venue_staff_select_own on public.venue_staff;
create policy venue_staff_select_own on public.venue_staff
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists venue_staff_admin_manage on public.venue_staff;
create policy venue_staff_admin_manage on public.venue_staff
  for all to authenticated
  using (public.venue_role_at_least(venue_id, 'admin'))
  with check (public.venue_role_at_least(venue_id, 'admin'));

-- ── teams (base table: no anon; players see their teams; staff manage) ───────
-- anon reads name/logo via the teams_public view only.
drop policy if exists teams_select_member on public.teams;
create policy teams_select_member on public.teams
  for select to authenticated
  using (
    exists (select 1 from public.team_members tm
            where tm.team_id = teams.id and tm.profile_id = auth.uid())
    or public.venue_role_at_least(teams.venue_id, 'staff')
  );

drop policy if exists teams_staff_manage on public.teams;
create policy teams_staff_manage on public.teams
  for all to authenticated
  using (public.venue_role_at_least(venue_id, 'staff'))
  with check (public.venue_role_at_least(venue_id, 'staff'));
-- Player self-service team creation is refined in Phase 2 (registration v2), likely
-- via an RPC so venue_id/pin handling stays server-side.

-- ── team_members (see own team's roster; add teammates to your team) ─────────
drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
  for select to authenticated
  using (
    exists (select 1 from public.team_members mine
            where mine.team_id = team_members.team_id and mine.profile_id = auth.uid())
    or exists (select 1 from public.teams t
               where t.id = team_members.team_id and public.venue_role_at_least(t.venue_id, 'staff'))
  );

drop policy if exists team_members_insert_own_team on public.team_members;
create policy team_members_insert_own_team on public.team_members
  for insert to authenticated
  with check (
    exists (select 1 from public.team_members mine
            where mine.team_id = team_members.team_id and mine.profile_id = auth.uid())
    or exists (select 1 from public.teams t
               where t.id = team_members.team_id and public.venue_role_at_least(t.venue_id, 'staff'))
  );

drop policy if exists team_members_staff_manage on public.team_members;
create policy team_members_staff_manage on public.team_members
  for all to authenticated
  using (exists (select 1 from public.teams t
                 where t.id = team_members.team_id and public.venue_role_at_least(t.venue_id, 'staff')))
  with check (exists (select 1 from public.teams t
                 where t.id = team_members.team_id and public.venue_role_at_least(t.venue_id, 'staff')));

-- ── Staff-managed venue data ────────────────────────────────────────────────
-- seasons + venue_settings + venues: admin. (public_read already grants anon SELECT.)
drop policy if exists seasons_admin_manage on public.seasons;
create policy seasons_admin_manage on public.seasons
  for all to authenticated
  using (public.venue_role_at_least(venue_id, 'admin'))
  with check (public.venue_role_at_least(venue_id, 'admin'));

drop policy if exists venue_settings_admin_manage on public.venue_settings;
create policy venue_settings_admin_manage on public.venue_settings
  for all to authenticated
  using (public.venue_role_at_least(venue_id, 'admin'))
  with check (public.venue_role_at_least(venue_id, 'admin'));

drop policy if exists venues_admin_manage on public.venues;
create policy venues_admin_manage on public.venues
  for all to authenticated
  using (public.venue_role_at_least(id, 'admin'))
  with check (public.venue_role_at_least(id, 'admin'));

-- games + game_teams: host. Child tables (rounds/scores/questions/display_state)
-- reach venue via game_venue(game_id).
drop policy if exists games_host_manage on public.games;
create policy games_host_manage on public.games
  for all to authenticated
  using (public.venue_role_at_least(venue_id, 'host'))
  with check (public.venue_role_at_least(venue_id, 'host'));

drop policy if exists game_teams_host_manage on public.game_teams;
create policy game_teams_host_manage on public.game_teams
  for all to authenticated
  using (public.venue_role_at_least(public.game_venue(game_id), 'host'))
  with check (public.venue_role_at_least(public.game_venue(game_id), 'host'));

do $$
declare t text;
begin
  foreach t in array array['rounds','scores','questions','game_display_state'] loop
    execute format('drop policy if exists %I_host_manage on public.%I', t, t);
    execute format($f$create policy %I_host_manage on public.%I
      for all to authenticated
      using (public.venue_role_at_least(public.game_venue(game_id), 'host'))
      with check (public.venue_role_at_least(public.game_venue(game_id), 'host'))$f$, t, t);
  end loop;
end $$;

-- signage_slots + signage_items + screen_takeovers + scheduled_events: staff.
do $$
declare t text;
begin
  foreach t in array array['signage_slots','signage_items','screen_takeovers','scheduled_events'] loop
    execute format('drop policy if exists %I_staff_manage on public.%I', t, t);
    execute format($f$create policy %I_staff_manage on public.%I
      for all to authenticated
      using (public.venue_role_at_least(venue_id, 'staff'))
      with check (public.venue_role_at_least(venue_id, 'staff'))$f$, t, t);
  end loop;
end $$;
-- toast_menu_cache is written only by the toast-menu-sync edge fn (service role,
-- which bypasses RLS); no authenticated write policy on purpose.

-- ── pin_hash lockdown (docs/02 mandate) ─────────────────────────────────────
-- Never selectable by anon/authenticated. Verification only via verify-team-pin
-- edge fn (service role). Grant authenticated column-level SELECT on everything
-- EXCEPT pin_hash; RLS still gates which rows.
-- Drop the table-wide grants (a table-level privilege silently covers pin_hash and
-- overrides any column-level revoke), then re-grant per column, excluding pin_hash.
-- pin_hash is therefore never readable OR writable by anon/authenticated — only the
-- verify-team-pin edge fn (service role, bypasses grants) ever touches it. RLS still
-- gates which rows (staff manage; players read their own via teams_select_member).
revoke select, insert, update, delete on public.teams from anon;
revoke select, insert, update on public.teams from authenticated;
grant select (id, venue_id, name, logo_url, is_regular, archived, created_at)
  on public.teams to authenticated;
grant insert (id, venue_id, name, logo_url, is_regular, archived, created_at)
  on public.teams to authenticated;
grant update (name, logo_url, is_regular, archived)
  on public.teams to authenticated;

-- ── Explicit grants for views + scoring function ────────────────────────────
grant select on public.teams_public     to anon, authenticated;
grant select on public.season_standings  to anon, authenticated;
grant select on public.team_streaks       to anon, authenticated;
grant execute on function public.season_leaderboard(uuid) to anon, authenticated;
