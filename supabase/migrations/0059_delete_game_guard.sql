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
--     zero scores AND zero game_teams AND no round
--     carrying an attached video_url / picture_url  → allowed (nothing to lose; without
--       this exception a junk game created at 'setup' and never started would be
--       permanently undeletable)
--   * otherwise                                    → raise exception
--
-- games.status vocabulary (0006, verified against the live DB before writing this):
-- 'setup' | 'active' | 'paused' | 'stopped' | 'completed'. Only 'completed' counts as
-- ended — END GAME in Scoring writes exactly that.
--
-- rounds: their EXISTENCE is deliberately NOT part of the emptiness test — GameSetup
-- seeds rounds at creation (default 6), so counting rows would make every freshly
-- created game undeletable and defeat the empty-game exception. But rounds do carry
-- attached host work in two columns, so the test is column-aware:
--   * video_url   — VideoEntry writes inter-round videos straight onto rounds. The real
--       prep order is: create game → attach round videos → import the deck, so a
--       video-only game is a genuine window where work exists but no question/score/
--       team row does yet.
--   * picture_url — the picture-round image (BulkImport / QuestionEntry upload).
-- Neither is ever populated by game creation, so counting them cannot resurrect the
-- every-new-game-undeletable problem. Verified against the live DB: a freshly created
-- game's seeded rounds have video_url and picture_url null.
--
-- round_name is deliberately NOT counted. It is a display label, not attached content:
-- the only bulk writer of it (BulkImport) writes questions in the same pass, so it adds
-- essentially no coverage over the questions test; it is retyped in seconds if lost;
-- and of the rounds columns it is the one a future creation-time default could
-- plausibly seed (e.g. labelling rounds at setup), which would silently make every new
-- game undeletable — exactly the failure the rounds exclusion exists to prevent.
-- bonus_description is excluded for the same seeded-at-creation reason: GameSetup
-- writes it on bonus rounds at creation time.
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
       or exists (select 1 from public.game_teams where game_id = p_game_id)
       -- Rounds count only when they carry attached work (see the header): the rows
       -- themselves are seeded at creation, video_url / picture_url never are.
       or exists (select 1 from public.rounds     where game_id = p_game_id
                    and (video_url is not null or picture_url is not null)))
  then
    raise exception 'game must be ended before it can be deleted (end the game first, or clear its questions, scores, teams and round videos/images)';
  end if;

  -- Children (game_display_state, game_teams, questions, rounds, scores) fall via
  -- ON DELETE CASCADE; seasons.finals_game_id is cleared via ON DELETE SET NULL.
  delete from public.games where id = p_game_id;
end;
$$;

revoke execute on function public.delete_game(uuid) from public, anon;
grant execute on function public.delete_game(uuid) to authenticated, service_role;
