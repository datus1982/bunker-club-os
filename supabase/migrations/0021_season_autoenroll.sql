-- 0021 — Season auto-enrollment trigger (docs/06 "zero signup friction")
--
-- docs/02/06 say a game's season_id is "stamped automatically at create" when its date
-- falls inside a season window — but nothing implemented it (GameSetup left it null). Put
-- it in a trigger so EVERY game-create path enrolls: host GameSetup, fixtures, finals nights.
-- The seasons_no_overlap exclusion constraint (0005) guarantees at most one season covers a
-- given (venue, date), so the lookup is unambiguous. Only fills a null season_id — an
-- explicit value (e.g. a manual correction) is never overwritten. is_playoff games still get
-- stamped (they belong to the season) but are excluded from standings math by the function.

create or replace function public.stamp_game_season()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.season_id is null then
    select s.id into new.season_id
    from public.seasons s
    where s.venue_id = new.venue_id
      and new.game_date between s.starts_on and s.ends_on
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_game_season on public.games;
create trigger trg_stamp_game_season
  before insert or update of game_date, venue_id on public.games
  for each row execute function public.stamp_game_season();
