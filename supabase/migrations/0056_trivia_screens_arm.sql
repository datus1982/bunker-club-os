-- 0056 — "PUT TRIVIA ON SCREENS" arm model (trivia-sandbox arc)
--
-- The bar TVs are a SANDBOX BY DEFAULT. A trivia game can run purely for scoring
-- without ever touching the bar screens. The host EXPLICITLY ARMS trivia to put it
-- on the TVs; the holding-vs-live state is then automatic (holding while the game is
-- in `setup`, live once it is `active`/`paused`). The signage resolver reads this key.
--
--   venue_settings key `trivia_screens_armed` (jsonb boolean, DEFAULT = OFF).
--
-- DEFAULT OFF. Absent / null / unreadable ⇒ NOT armed (the bar simply doesn't show
-- trivia). With the explicit-arm model this is the intended default — the host arms
-- on a real night and the state is visible on the Scoring console; a failed read just
-- means "not on the screens", the host re-arms, and realtime corrects it. This is the
-- accepted tradeoff of explicit arming, NOT silent suppression of a running night.
-- ONLY an explicit stored `true` puts trivia on the screens.
--
-- Anon read: NO new grant needed. venue_settings already carries the 0011
-- `public_read` policy (SELECT to anon, authenticated using (true)) — the exact path
-- the signage ticker reads signage_ticker_lines / signage_last_rung. The public TV
-- reads this key the same way. We do NOT open up anything new on venue_settings.
--
-- Write: a SECURITY DEFINER RPC gated on has_module(venue,'trivia') so a host with
-- the trivia grant (NOT necessarily a venue admin) can arm/disarm — mirrors the 0024
-- check_in_team / has_module idioms. Base-table writes on venue_settings stay
-- admin-only (0011 venue_settings_admin_manage).

-- ── set_trivia_screens_armed(): host-with-trivia arms/disarms the bar TVs ─────
create or replace function public.set_trivia_screens_armed(p_venue_id uuid, p_armed boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Same authorization surface as the other trivia RPCs: the caller must hold the
  -- trivia module on this venue (admin implies it). Anon (auth.uid() null) fails here.
  if not public.has_module(p_venue_id, 'trivia') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.venue_settings (venue_id, key, value, updated_at)
  values (p_venue_id, 'trivia_screens_armed', to_jsonb(p_armed), now())
  on conflict (venue_id, key)
  do update set value = excluded.value, updated_at = now();

  return p_armed;
end;
$$;

-- Lock the function down: strip the PUBLIC + anon execute grants so anon cannot even call
-- it (belt-and-suspenders — the internal has_module guard already rejects a null auth.uid()).
-- Supabase's default privileges re-grant execute to anon/authenticated, so revoke anon
-- explicitly to get a clean permission-denied rather than reaching the internal raise.
revoke execute on function public.set_trivia_screens_armed(uuid, boolean) from public, anon;
grant execute on function public.set_trivia_screens_armed(uuid, boolean) to authenticated, service_role;

-- ── Realtime: publish venue_settings so arm/disarm propagates to the TVs live ──
-- The public SlotDisplay subscribes (filtered to key=trivia_screens_armed) and
-- re-resolves its mode within realtime latency — no sub-30s poll. venue_settings is
-- already fully anon-SELECTable (public_read), so publishing it exposes nothing new;
-- realtime honors the same RLS. Idempotent (mirrors 0013).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'venue_settings'
  ) then
    alter publication supabase_realtime add table public.venue_settings;
  end if;
end $$;
