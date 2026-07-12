-- 0018 — Fix infinite recursion in teams / team_members RLS (bug in 0011)
--
-- 0011's teams_select_member subqueries team_members, and every team_members policy
-- subqueries team_members and/or teams. Because RLS is re-applied inside those
-- subqueries, each policy re-invokes the other (and itself), so Postgres aborts any
-- authenticated read of teams or team_members with 42P17 "infinite recursion detected
-- in policy". This blocked every host tool that reads teams (Scoring's participant grid,
-- GameSetup's regular-team picker, the Teams roster). Anon was unaffected — it reads the
-- SECURITY DEFINER teams_public view, which never evaluates these policies.
--
-- Fix: move the membership + venue lookups into SECURITY DEFINER helpers that read the
-- base tables WITHOUT re-applying RLS, then reference only those helpers in the policies.
-- This is the same technique 0011 already uses for game_venue(). Behaviour is identical
-- (a user still sees their own teams; staff see their venue's teams) — only the recursion
-- is removed.

-- True when the current user is a member of the given team (no RLS → no recursion).
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.profile_id = auth.uid()
  );
$$;

-- The venue a team belongs to (no RLS → no recursion when used in team_members policies).
create or replace function public.team_venue(p_team_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select venue_id from public.teams where id = p_team_id;
$$;

grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.team_venue(uuid) to authenticated;

-- ── teams: own teams (via helper) or staff of the venue ──────────────────────
drop policy if exists teams_select_member on public.teams;
create policy teams_select_member on public.teams
  for select to authenticated
  using (
    public.is_team_member(id)
    or public.venue_role_at_least(venue_id, 'staff')
  );

-- ── team_members: own team's roster (via helpers), or staff of the team's venue ──
drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
  for select to authenticated
  using (
    public.is_team_member(team_members.team_id)
    or public.venue_role_at_least(public.team_venue(team_members.team_id), 'staff')
  );

drop policy if exists team_members_insert_own_team on public.team_members;
create policy team_members_insert_own_team on public.team_members
  for insert to authenticated
  with check (
    public.is_team_member(team_members.team_id)
    or public.venue_role_at_least(public.team_venue(team_members.team_id), 'staff')
  );

drop policy if exists team_members_staff_manage on public.team_members;
create policy team_members_staff_manage on public.team_members
  for all to authenticated
  using (public.venue_role_at_least(public.team_venue(team_members.team_id), 'staff'))
  with check (public.venue_role_at_least(public.team_venue(team_members.team_id), 'staff'));
