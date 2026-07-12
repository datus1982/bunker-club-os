-- 0008 — Seasons engine: standings view + season_leaderboard() + streaks
-- Source: docs/02 (Standings) + docs/06 (scoring modes). ALL season scoring logic
-- lives in season_leaderboard() so the portal, the display leaderboard, and the
-- finals-qualification query cannot disagree (docs/02 mandate).

-- ── season_standings (cumulative base snapshot, docs/02 verbatim shape) ──────
-- Convenience view for the simple case; season_leaderboard() is authoritative for
-- ranking in all three modes. Both derive from the same tables, so they agree.
create or replace view public.season_standings
with (security_invoker = true) as
with game_results as (
  select g.season_id, gt.team_id, g.id as game_id, g.game_date,
         coalesce(sum(s.points),0) as game_points,
         rank() over (partition by g.id order by coalesce(sum(s.points),0) desc) as game_place
  from public.games g
  join public.game_teams gt on gt.game_id = g.id
  left join public.scores s on s.game_id = g.id and s.team_id = gt.team_id
  where g.season_id is not null and g.status = 'completed' and not g.is_playoff
  group by g.season_id, gt.team_id, g.id, g.game_date
)
select season_id, team_id,
       count(*)                                          as games_played,
       sum(game_points)                                  as total_points,
       sum(case when game_place = 1 then 1 else 0 end)   as wins
from game_results
group by season_id, team_id;

-- ── season_leaderboard(season_id) — the one scoring function, 3 modes ────────
-- cumulative: sum all game points.
-- placement:  map each night's finishing place through placement_points[].
-- best_n:     sum each team's best N nightly scores.
-- Ranking tiebreak (docs/06): score desc, then wins desc, then games_played asc.
-- Head-to-head and the finals tiebreaker question are resolved at finals (Phase 4),
-- not derivable here.
create or replace function public.season_leaderboard(p_season_id uuid)
returns table (
  team_id       uuid,
  games_played  int,
  total_points  numeric,
  wins          int,
  score         numeric,
  rank          int
)
language plpgsql
stable
as $$
declare
  v_mode      text;
  v_best_n    int;
  v_placement jsonb;
begin
  select scoring_mode, best_n, placement_points
    into v_mode, v_best_n, v_placement
  from public.seasons
  where id = p_season_id;

  return query
  with game_results as (
    select gt.team_id,
           g.id as game_id,
           coalesce(sum(s.points), 0) as game_points,
           rank() over (partition by g.id order by coalesce(sum(s.points), 0) desc) as game_place
    from public.games g
    join public.game_teams gt on gt.game_id = g.id
    left join public.scores s on s.game_id = g.id and s.team_id = gt.team_id
    where g.season_id = p_season_id
      and g.status = 'completed'
      and not g.is_playoff
    group by gt.team_id, g.id
  ),
  per_team as (
    select gr.team_id,
           count(*)::int                                            as games_played,
           sum(gr.game_points)::numeric                             as total_points,
           sum(case when gr.game_place = 1 then 1 else 0 end)::int  as wins,
           -- placement: sum of placement_points[place-1] across nights.
           -- game_place is bigint (rank()); jsonb ->> needs int4, so cast the index.
           sum(coalesce((v_placement ->> ((gr.game_place - 1)::int))::numeric, 0))::numeric as placement_score
    from game_results gr
    group by gr.team_id
  ),
  best_n as (
    select x.team_id, coalesce(sum(x.game_points), 0)::numeric as best_n_score
    from (
      select gr.team_id, gr.game_points,
             row_number() over (partition by gr.team_id order by gr.game_points desc) as rn
      from game_results gr
    ) x
    where x.rn <= coalesce(v_best_n, 2147483647)
    group by x.team_id
  ),
  final as (
    select pt.team_id, pt.games_played, pt.total_points, pt.wins,
           case v_mode
             when 'cumulative' then pt.total_points
             when 'placement'  then pt.placement_score
             when 'best_n'     then bn.best_n_score
             else pt.total_points
           end as score
    from per_team pt
    join best_n bn on bn.team_id = pt.team_id
  )
  select f.team_id, f.games_played, f.total_points, f.wins, f.score,
         (rank() over (order by f.score desc, f.wins desc, f.games_played asc))::int as rank
  from final f;
end;
$$;

-- ── team_streaks (portal nicety, docs/02) ───────────────────────────────────
-- Longest run of consecutive season games a team actually played (gaps-and-islands).
-- Assumes one game per date per season. Current-streak refinement is a Phase 4
-- nicety; longest_streak + games_played cover the schema now.
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
  select season_id, team_id, grp, count(*) as run_len
  from islands
  group by season_id, team_id, grp
)
select season_id, team_id,
       max(run_len)  as longest_streak,
       sum(run_len)  as games_played
from runs
group by season_id, team_id;
