-- 0026 — Hotfix: restore 0018 SECURITY DEFINER helper pattern in teams/team_members
--         policies (regression introduced by 0024)
--
-- 0024 (lines 85–102) dropped the fixed policies from 0018 and recreated them with raw
-- inline subqueries:
--
--   exists (select 1 from public.team_members tm
--           where tm.team_id = <outer>.team_id and tm.profile_id = auth.uid())
--
-- When Postgres evaluates these policies the subquery on team_members re-applies RLS,
-- which re-enters the same policy, producing "42P17 infinite recursion detected in policy
-- for relation team_members". Every authenticated read of teams or team_members fails.
--
-- Fix: replace the raw exists() with public.is_team_member() — the SECURITY DEFINER
-- function 0018 introduced that reads team_members WITHOUT re-applying RLS — exactly as
-- 0018 did. The has_module() branch added by 0024 is preserved unchanged.
-- All other 0024 policies on these tables (teams_trivia_manage,
-- team_members_trivia_manage) are safe: they only call has_module() + team_venue(),
-- both of which are SECURITY DEFINER and not recursive.

drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
  for select to authenticated
  using (
    public.is_team_member(team_members.team_id)
    or public.has_module(public.team_venue(team_members.team_id), 'trivia')
  );

drop policy if exists teams_select_member on public.teams;
create policy teams_select_member on public.teams
  for select to authenticated
  using (
    public.is_team_member(teams.id)
    or public.has_module(teams.venue_id, 'trivia')
  );
