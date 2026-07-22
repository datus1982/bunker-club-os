-- 0058_delete_game.sql
-- delete_game(p_game_id) — hard-delete a trivia game and all its children.
--
-- Motivation: the owner has junk/test games in history (artifacts of the old
-- system loading a historical game into an active state) and there was no way
-- to remove them. History.tsx gains a per-game DELETE affordance backed by this
-- RPC.
--
-- Authorization: SECURITY DEFINER, gated on has_module(<game venue>, 'trivia')
-- via the game_venue() definer helper (0011) so the venue lookup + module check
-- never recurse through games' own RLS. Mirrors the RPC idiom in 0019/0024:
-- set search_path, explicit exceptions, revoke from public/anon, grant to
-- authenticated + service_role.
--
-- FK-safe delete: every child of games is ON DELETE CASCADE
--   game_display_state.game_id, game_teams.game_id, questions.game_id,
--   rounds.game_id, scores.game_id  → CASCADE
--   questions.round_id, scores.round_id, game_display_state.current_round_id
--     are handled when rounds cascade (CASCADE / SET NULL respectively)
--   seasons.finals_game_id → SET NULL (deleting a game must NOT delete a season;
--     if a junk game happened to be stamped as a season's finals, the stamp is
--     simply cleared — the season row survives)
-- so a single `delete from games` removes every child with zero orphans. We rely
-- on the cascade (per repo convention) rather than deleting children by hand.

create or replace function public.delete_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue uuid;
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

  -- Children (game_display_state, game_teams, questions, rounds, scores) fall via
  -- ON DELETE CASCADE; seasons.finals_game_id is cleared via ON DELETE SET NULL.
  delete from public.games where id = p_game_id;
end;
$$;

revoke execute on function public.delete_game(uuid) from public, anon;
grant execute on function public.delete_game(uuid) to authenticated, service_role;
