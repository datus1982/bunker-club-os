-- 0024 — Module-grant permissions (Phase 4b scope addition)
-- Access to a MODULE is no longer implied by rank. venue_staff gains an explicit
-- `modules text[]`; a staffer sees/touches a module only if it's granted (or they're
-- venue admin, which implies every module). Role labels (admin/host/staff) remain as
-- human titles + drive the genuinely rank-based checks (admin-only actions,
-- team_roster staff email visibility) — those keep venue_role_at_least.
--
-- Helper mirrors the 0018 SECURITY DEFINER pattern so RLS policies can read
-- venue_staff without granting table access to authenticated.

-- ── modules column ───────────────────────────────────────────────────────────
alter table public.venue_staff
  add column if not exists modules text[] not null default '{}';

-- Known module keys (documented, not enforced as an enum so new modules don't need a
-- migration to add): trivia, seasons, drinks, signage, website, events.

-- ── has_module(): admin ⇒ all; otherwise the module must be explicitly granted ──
create or replace function public.has_module(p_venue uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.venue_staff vs
    where vs.profile_id = auth.uid()
      and vs.venue_id = p_venue
      and (vs.role = 'admin' or p_module = any (vs.modules))
  );
$$;

-- ── Seed grants (docs/03 real staff) ─────────────────────────────────────────
-- stephentyler = admin (all modules implied, no explicit grants needed).
-- trashtvronnie = host, granted ONLY trivia.
update public.venue_staff vs
  set modules = array['trivia']
  from auth.users u
  where u.id = vs.profile_id and u.email = 'trashtvronnie@gmail.com';

-- ── Refactor module-scoped policies onto has_module ──────────────────────────
-- TRIVIA: games + its children + team management (the trivia host tools).
drop policy if exists games_host_manage on public.games;
create policy games_trivia_manage on public.games
  for all to authenticated
  using (public.has_module(venue_id, 'trivia'))
  with check (public.has_module(venue_id, 'trivia'));

drop policy if exists game_teams_host_manage on public.game_teams;
create policy game_teams_trivia_manage on public.game_teams
  for all to authenticated
  using (public.has_module(public.game_venue(game_id), 'trivia'))
  with check (public.has_module(public.game_venue(game_id), 'trivia'));

do $$
declare t text;
begin
  foreach t in array array['rounds','scores','questions','game_display_state'] loop
    execute format('drop policy if exists %I_host_manage on public.%I', t, t);
    execute format($f$create policy %I_trivia_manage on public.%I
      for all to authenticated
      using (public.has_module(public.game_venue(game_id), 'trivia'))
      with check (public.has_module(public.game_venue(game_id), 'trivia'))$f$, t, t);
  end loop;
end $$;

-- Teams + team_members staff-management path is a trivia host tool (players still
-- self-serve via their own policies + the definer RPCs, which are unchanged).
drop policy if exists teams_staff_manage on public.teams;
create policy teams_trivia_manage on public.teams
  for all to authenticated
  using (public.has_module(venue_id, 'trivia'))
  with check (public.has_module(venue_id, 'trivia'));

drop policy if exists team_members_staff_manage on public.team_members;
create policy team_members_trivia_manage on public.team_members
  for all to authenticated
  using (public.has_module(public.team_venue(team_members.team_id), 'trivia'))
  with check (public.has_module(public.team_venue(team_members.team_id), 'trivia'));

-- team_members SELECT for staff visibility also gated the roster read on staff rank;
-- keep the member-self path, swap the staff branch to the trivia grant (a non-trivia
-- staffer has no business reading arbitrary rosters).
drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
  for select to authenticated
  using (
    exists (select 1 from public.team_members tm
            where tm.team_id = team_members.team_id and tm.profile_id = auth.uid())
    or public.has_module(public.team_venue(team_members.team_id), 'trivia')
  );

-- teams SELECT for staff: same treatment (member OR trivia grant).
drop policy if exists teams_select_member on public.teams;
create policy teams_select_member on public.teams
  for select to authenticated
  using (
    exists (select 1 from public.team_members tm
            where tm.team_id = teams.id and tm.profile_id = auth.uid())
    or public.has_module(teams.venue_id, 'trivia')
  );

-- DRINKS: config + group selection + the available-groups picker.
drop policy if exists drinks_groups_staff_manage on public.drinks_menu_groups;
create policy drinks_groups_module_manage on public.drinks_menu_groups
  for all to authenticated
  using (public.has_module(venue_id, 'drinks'))
  with check (public.has_module(venue_id, 'drinks'));

drop policy if exists drinks_config_staff_manage on public.drinks_display_config;
create policy drinks_config_module_manage on public.drinks_display_config
  for all to authenticated
  using (public.has_module(venue_id, 'drinks'))
  with check (public.has_module(venue_id, 'drinks'));

drop policy if exists drinks_available_staff_read on public.drinks_available_groups;
create policy drinks_available_module_read on public.drinks_available_groups
  for select to authenticated
  using (public.has_module(venue_id, 'drinks'));

-- SIGNAGE (Phase 5 surface) + EVENTS: split scheduled_events onto its own module.
do $$
declare t text;
begin
  foreach t in array array['signage_slots','signage_items','screen_takeovers'] loop
    execute format('drop policy if exists %I_staff_manage on public.%I', t, t);
    execute format($f$create policy %I_module_manage on public.%I
      for all to authenticated
      using (public.has_module(venue_id, 'signage'))
      with check (public.has_module(venue_id, 'signage'))$f$, t, t);
  end loop;
end $$;

drop policy if exists scheduled_events_staff_manage on public.scheduled_events;
create policy scheduled_events_module_manage on public.scheduled_events
  for all to authenticated
  using (public.has_module(venue_id, 'events'))
  with check (public.has_module(venue_id, 'events'));

-- ── check_in_team: host walk-up now gated on the trivia grant (admin implied) ──
create or replace function public.check_in_team(
  p_game_id uuid,
  p_team_id uuid,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_venue uuid;
  v_team_venue uuid;
  v_is_member  boolean;
  v_is_staff   boolean;
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_name       text;
  v_gt_id      uuid;
begin
  select venue_id into v_game_venue from public.games where id = p_game_id;
  select venue_id into v_team_venue from public.teams where id = p_team_id;

  if v_game_venue is null then raise exception 'game not found'; end if;
  if v_team_venue is null then raise exception 'team not found'; end if;
  if v_game_venue <> v_team_venue then
    raise exception 'team and game belong to different venues';
  end if;

  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.profile_id = auth.uid()
  ) into v_is_member;
  -- Walk-up check-in is a trivia host action (was venue_role_at_least host).
  v_is_staff := public.has_module(v_game_venue, 'trivia');

  if not (v_is_member or v_is_staff or v_is_service) then
    raise exception 'not authorized to check in this team';
  end if;

  select coalesce(nullif(btrim(p_display_name), ''), t.name)
    into v_name
  from public.teams t where t.id = p_team_id;

  insert into public.game_teams (game_id, team_id, display_name, checked_in_by)
  select p_game_id, p_team_id, v_name, auth.uid()
  where not exists (
    select 1 from public.game_teams gt
    where gt.game_id = p_game_id and gt.team_id = p_team_id
  )
  returning id into v_gt_id;

  if v_gt_id is null then
    select id into v_gt_id from public.game_teams
    where game_id = p_game_id and team_id = p_team_id;
    if nullif(btrim(p_display_name), '') is not null then
      update public.game_teams set display_name = v_name where id = v_gt_id;
    end if;
  end if;

  insert into public.scores (game_id, round_id, team_id, points)
  select p_game_id, r.id, p_team_id, 0
  from public.rounds r
  where r.game_id = p_game_id
    and r.is_complete = true
    and not exists (
      select 1 from public.scores s
      where s.round_id = r.id and s.team_id = p_team_id
    );

  return v_gt_id;
end;
$$;

grant execute on function public.check_in_team(uuid, uuid, text) to authenticated, service_role;
