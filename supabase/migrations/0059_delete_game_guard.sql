-- 0059_delete_game_guard.sql
-- delete_game(p_game_id) — add a work guard so a live game can't be deleted.
--
-- Motivation (real incident 2026-07-21): the delete affordance shipped in 0058 was
-- used on THAT NIGHT'S game after the host had already imported the full question
-- deck. Every child cascaded and the deck was gone. The owner asked for a guard:
-- "require a game to be ended before it can be deleted."
--
-- Rule (added after the authorization check, before the delete):
--   * status = 'completed'                        → allowed (the game is ended)
--   * game is provably empty — zero questions AND
--     zero scores AND zero game_teams              → allowed (nothing to lose; without
--       this exception a junk game created at 'setup' and never started would be
--       permanently undeletable)
--   * otherwise                                    → raise exception
--
-- games.status vocabulary (0006, verified against the live DB before writing this):
-- 'setup' | 'active' | 'paused' | 'stopped' | 'completed'. Only 'completed' counts as
-- ended — END GAME in Scoring writes exactly that.
--
-- rounds are deliberately NOT part of the emptiness test: GameSetup seeds rounds at
-- creation (default 6), so counting them would make every freshly created game
-- undeletable and defeat the empty-game exception. Rounds carry no host work on their
-- own — the work lives in questions / scores / game_teams.
--
-- Everything else from 0058 is preserved byte-for-byte: SECURITY DEFINER,
-- search_path = public, the game_venue()/'game not found' check, the
-- has_module(<venue>,'trivia') authorization check, the FK-cascade delete, and the
-- revoke/grant pair (re-stated because create or replace does not touch ACLs but we
-- keep the idiom explicit and idempotent).

create or replace function public.delete_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue  uuid;
  v_status text;
begin
  -- game_venue() is a security-definer helper (0011): reads games.venue_id
  -- without tripping games' RLS. Null ⇒ the game doesn't exist.
  v_venue := public.game_venue(p_game_id);
  if v_venue is null then
    raise exception 'game not found';
  end if;

  -- Caller must hold the trivia module for the game's venue (admin implies all).
  if not public.has_module(v_venue, 'trivia') then
    raise exception 'not authorized to delete this game';
  end if;

  -- Work guard (0059). Deleting is only safe once the game is ended, or while it
  -- still holds nothing a host could lose.
  select status into v_status from public.games where id = p_game_id;
  if v_status is distinct from 'completed'
     and (exists (select 1 from public.questions  where game_id = p_game_id)
       or exists (select 1 from public.scores     where game_id = p_game_id)
       or exists (select 1 from public.game_teams where game_id = p_game_id))
  then
    raise exception 'game must be ended before it can be deleted (end the game first, or clear its questions, scores and teams)';
  end if;

  -- Children (game_display_state, game_teams, questions, rounds, scores) fall via
  -- ON DELETE CASCADE; seasons.finals_game_id is cleared via ON DELETE SET NULL.
  delete from public.games where id = p_game_id;
end;
$$;

revoke execute on function public.delete_game(uuid) from public, anon;
grant execute on function public.delete_game(uuid) to authenticated, service_role;
