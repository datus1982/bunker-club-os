-- 0022 — Portal read models (docs/07): team history, streaks, season summary, roster privacy
--
-- The portal does NO score math in TypeScript — every number comes from a SQL view/RPC here,
-- and all season ranking flows through season_leaderboard() (the CLAUDE.md single-source rule).
-- team_season_summary() CALLS season_leaderboard so the portal, the display panel, the check-in
-- teaser, and finals qualification can never disagree.

-- ── team_history(team_id) — history table + sparkline feed (docs/07) ──────────
-- Per completed non-playoff game the team played: date, points, that night's place, the season
-- it counted toward, and COUNTS? (best-N membership made legible). best-N cut is per season and
-- per team. Legacy games with season_id null show but count toward nothing. Game points/places
-- are already public (leaderboard), so no new privacy surface.
create or replace function public.team_history(p_team_id uuid)
returns table (
  game_id       uuid,
  game_date     date,
  season_id     uuid,
  points        numeric,
  place         int,
  counts_toward boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with per_game_team as (
    select g.id as game_id, g.game_date, g.season_id, gt.team_id,
           coalesce(sum(s.points), 0)::numeric as pts
    from public.games g
    join public.game_teams gt on gt.game_id = g.id
    left join public.scores s on s.game_id = g.id and s.team_id = gt.team_id
    where g.status = 'completed' and not g.is_playoff
    group by g.id, g.game_date, g.season_id, gt.team_id
  ),
  ranked as (
    select *, rank() over (partition by game_id order by pts desc)::int as place
    from per_game_team
  ),
  mine as (
    select game_id, game_date, season_id, pts, place,
           row_number() over (partition by season_id order by pts desc, game_id) as pts_rank
    from ranked
    where team_id = p_team_id
  )
  select m.game_id, m.game_date, m.season_id, m.pts as points, m.place,
         case
           when m.season_id is null then false
           when se.scoring_mode = 'best_n' then m.pts_rank <= coalesce(se.best_n, 2147483647)
           else true
         end as counts_toward
  from mine m
  left join public.seasons se on se.id = m.season_id
  order by m.game_date desc;
$$;

-- Postgres grants function EXECUTE to PUBLIC by default; revoke so only the intended
-- role can call these definer functions (default-deny ethos, matches 0011/0019).
revoke execute on function public.team_history(uuid) from public, anon;
grant execute on function public.team_history(uuid) to authenticated;

-- ── team_streaks v2 — add current_streak (trailing run ending at latest game) ──
-- Longest = best island; current = the island that contains the team's most recent season game.
create or replace view public.team_streaks
with (security_invoker = true) as
with season_games as (
  select g.season_id, g.id as game_id,
         row_number() over (partition by g.season_id order by g.game_date, g.id) as game_seq
  from public.games g
  where g.season_id is not null and g.status = 'completed' and not g.is_playoff
),
team_games as (
  select sg.season_id, gt.team_id, sg.game_seq
  from season_games sg
  join public.game_teams gt on gt.game_id = sg.game_id
),
islands as (
  select season_id, team_id, game_seq,
         game_seq - row_number() over (partition by season_id, team_id order by game_seq) as grp
  from team_games
),
runs as (
  select season_id, team_id, grp, count(*) as run_len, max(game_seq) as last_seq
  from islands
  group by season_id, team_id, grp
),
team_last as (
  select season_id, team_id, max(game_seq) as latest_seq
  from team_games group by season_id, team_id
)
select r.season_id, r.team_id,
       max(r.run_len) as longest_streak,
       sum(r.run_len) as games_played,
       max(r.run_len) filter (where r.last_seq = tl.latest_seq) as current_streak
from runs r
join team_last tl on tl.season_id = r.season_id and tl.team_id = r.team_id
group by r.season_id, r.team_id;

grant select on public.team_streaks to anon, authenticated;

-- ── team_season_summary(team_id) — one call for card + dossier (reads season_leaderboard) ──
-- Resolves the team's CURRENT season (the one whose window contains today for its venue —
-- unique by the overlap constraint) and returns that team's row from season_leaderboard()
-- plus context numbers. rank null = team has no counted games yet this season.
create or replace function public.team_season_summary(p_team_id uuid)
returns table (
  season_id           uuid,
  season_name         text,
  scoring_mode        text,
  best_n              int,
  ends_on             date,
  rank                int,
  score               numeric,
  wins                int,
  games_played        int,
  games_counted       int,
  total_teams         int,
  points_behind_next  numeric,
  leader_score        numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_venue   uuid;
  v_season  public.seasons%rowtype;
begin
  select venue_id into v_venue from public.teams where id = p_team_id;
  if v_venue is null then return; end if;

  select * into v_season
  from public.seasons s
  where s.venue_id = v_venue
    and current_date between s.starts_on and s.ends_on
  order by (s.status = 'active') desc
  limit 1;

  if v_season.id is null then return; end if;

  return query
  with lb as (
    select * from public.season_leaderboard(v_season.id)
  ),
  me as (select * from lb where lb.team_id = p_team_id),
  nxt as (select l.score as next_score from lb l join me on true where l.rank = me.rank - 1 limit 1)
  select
    v_season.id, v_season.name, v_season.scoring_mode, v_season.best_n, v_season.ends_on,
    me.rank, me.score, me.wins, me.games_played,
    least(me.games_played, coalesce(v_season.best_n, me.games_played))::int as games_counted,
    (select count(*)::int from lb),
    coalesce((select nxt.next_score from nxt), 0) - coalesce(me.score, 0) as points_behind_next,
    (select max(lb.score) from lb) as leader_score
  from me
  -- Team in the season's venue but with no counted games yet: still return season fields.
  right join (select 1) one on true;
end;
$$;

revoke execute on function public.team_season_summary(uuid) from public, anon;
grant execute on function public.team_season_summary(uuid) to authenticated;

-- ── team_roster v2 — email privacy (carry-over #2) ────────────────────────────
-- Same signature as 0019, but email is returned ONLY to the team captain or venue staff.
-- Regular members get display_name + role only (email null). Stable columns; behavior refined.
create or replace function public.team_roster(p_team_id uuid)
returns table (
  profile_id   uuid,
  display_name text,
  email        text,
  role         text,
  joined_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_is_staff  boolean := public.venue_role_at_least(public.team_venue(p_team_id), 'staff');
  v_is_captain boolean;
  v_can_see_email boolean;
begin
  if not (public.is_team_member(p_team_id) or v_is_staff) then
    raise exception 'not authorized to view this roster';
  end if;

  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.profile_id = v_uid and tm.role = 'captain'
  ) into v_is_captain;
  v_can_see_email := v_is_staff or v_is_captain;

  return query
    select tm.profile_id, p.display_name,
           case when v_can_see_email then p.email else null end as email,
           tm.role, tm.created_at
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id
    order by (tm.role = 'captain') desc, tm.created_at;
end;
$$;

revoke execute on function public.team_roster(uuid) from public, anon;
grant execute on function public.team_roster(uuid) to authenticated;
