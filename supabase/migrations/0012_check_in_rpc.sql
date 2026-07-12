-- 0012 — check_in_team RPC (atomic check-in + zero-score backfill)
-- Source: docs/02. security definer: authorizes internally (RLS is bypassed).
-- Caller must be a member of the team, OR venue staff (host+), OR the service role
-- (the verify-team-pin edge fn calls this after validating a PIN). Ports the
-- mid-game join logic from the legacy AddTeam.tsx into SQL so it's atomic:
-- inserting game_teams AND backfilling zero scores for already-completed rounds.

create or replace function public.check_in_team(p_game_id uuid, p_team_id uuid)
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
  v_is_staff := public.venue_role_at_least(v_game_venue, 'host');

  if not (v_is_member or v_is_staff or v_is_service) then
    raise exception 'not authorized to check in this team';
  end if;

  -- Idempotent game_teams insert.
  insert into public.game_teams (game_id, team_id, display_name, checked_in_by)
  select p_game_id, p_team_id,
         (select name from public.teams where id = p_team_id),
         auth.uid()
  where not exists (
    select 1 from public.game_teams gt
    where gt.game_id = p_game_id and gt.team_id = p_team_id
  )
  returning id into v_gt_id;

  if v_gt_id is null then
    select id into v_gt_id from public.game_teams
    where game_id = p_game_id and team_id = p_team_id;
  end if;

  -- Zero-score backfill: a team joining mid-game gets 0 for rounds already scored.
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

grant execute on function public.check_in_team(uuid, uuid) to authenticated, service_role;
