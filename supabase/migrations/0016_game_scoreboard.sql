-- 0016 — game_scoreboard(game_id): atomic per-game standings (docs/04 QUAL-4)
-- Replaces the legacy Leaderboard's client-side assembly of totals from 4 polled
-- queries (Leaderboard.tsx:270-309) with ONE query. Behavior-identical to legacy:
--
--   total_score = Σ over rounds of points, DOUBLED on the team's wildcard round
--                 (wildcard_used_on_round matched by rounds.round_number).
--   sort:  total_score desc
--          → teams with a manual tiebreaker_rank ahead of those without
--          → tiebreaker_rank asc
--          → game_teams.created_at asc   (stable final tie-break)
--
-- NOTE: this is the per-GAME display total. It is deliberately separate from
-- season_leaderboard(), whose season math ignores the wildcard (docs/06). Do not
-- fold them together.
--
-- SECURITY DEFINER: /leaderboard is a public (anon) display route, but anon has no
-- privilege on the teams base table (0011 — reads go through teams_public). This
-- function is game-scoped and returns ONLY safe team columns (name, is_regular,
-- logo_url) — never pin_hash or contact info — so definer rights are safe here, the
-- same rationale as the teams_public view. It reads the teams base (not teams_public)
-- so a team archived after the fact still appears in its historical scoreboard,
-- matching legacy.

create or replace function public.game_scoreboard(p_game_id uuid)
returns table (
  team_id                uuid,
  team_name              text,
  is_regular             boolean,
  logo_url               text,
  total_score            int,
  wildcard_used          boolean,
  wildcard_used_on_round int,
  tiebreaker_rank        int,
  place                  int
)
language sql
stable
security definer
set search_path = public
as $$
  with team_totals as (
    select
      gt.team_id,
      -- Import disambiguated 22 duplicate team names on teams.name and preserved the
      -- as-registered original on game_teams.display_name (docs/03). Prefer display_name
      -- so the board shows the name the room saw; fall back to teams.name (new games
      -- leave display_name null until Phase 2 check-in).
      -- DECISION: legacy read teams.name directly; display_name is the faithful choice
      -- post-disambiguation. Match legacy visually, not literally.
      coalesce(nullif(gt.display_name, ''), t.name)  as team_name,
      t.is_regular,
      t.logo_url,
      gt.wildcard_used_on_round,
      gt.tiebreaker_rank,
      gt.created_at                                  as gt_created_at,
      coalesce(sum(
        case when gt.wildcard_used_on_round = r.round_number
             then s.points * 2
             else s.points end
      ), 0)::int                                     as total_score
    from public.game_teams gt
    join public.teams t on t.id = gt.team_id
    left join public.scores s on s.game_id = gt.game_id and s.team_id = gt.team_id
    left join public.rounds r on r.id = s.round_id
    where gt.game_id = p_game_id
    group by gt.team_id, gt.display_name, t.name, t.is_regular, t.logo_url,
             gt.wildcard_used_on_round, gt.tiebreaker_rank, gt.created_at
  )
  select
    team_id,
    team_name,
    is_regular,
    logo_url,
    total_score,
    (wildcard_used_on_round is not null)             as wildcard_used,
    wildcard_used_on_round,
    tiebreaker_rank,
    row_number() over (
      order by
        total_score desc,
        case when tiebreaker_rank is not null then 0 else 1 end,
        tiebreaker_rank asc,
        gt_created_at asc
    )::int                                           as place
  from team_totals
  order by place
$$;

grant execute on function public.game_scoreboard(uuid) to anon, authenticated;
