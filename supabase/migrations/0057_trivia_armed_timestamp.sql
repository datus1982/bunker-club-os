-- 0057 — timestamp the trivia arm so it auto-expires nightly (WARN-1)
--
-- The 0056 flag stored a bare jsonb boolean and was STICKY — nothing reset it, so a
-- forgotten arm would silently flip the bar to the holding screen when a setup game is
-- created days later. Fix: store WHEN it was armed, and derive nightly expiry AT READ
-- (the 0051 D4 "never precompute an expiry" pattern — the client checks `at` against the
-- venue business-day rollover). A forgotten arm auto-dies at the next 04:00 closeout.
--
--   venue_settings key `trivia_screens_armed`
--     = { "armed": <bool>, "at": <iso timestamp | null> }   (object shape, going forward)
--
-- `at` is set to now() when arming, null when disarming. The client treats a lingering
-- bare boolean `true` (old 0056 shape) as armed-without-expiry for backward-compat, but
-- every write from here on is the object shape.
--
-- Same has_module('trivia') gate + anon revoke as 0056. Read stays anon (public_read).

create or replace function public.set_trivia_screens_armed(p_venue_id uuid, p_armed boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_module(p_venue_id, 'trivia') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.venue_settings (venue_id, key, value, updated_at)
  values (
    p_venue_id,
    'trivia_screens_armed',
    jsonb_build_object('armed', p_armed, 'at', case when p_armed then now() else null end),
    now()
  )
  on conflict (venue_id, key)
  do update set value = excluded.value, updated_at = now();

  return p_armed;
end;
$$;

-- Re-assert the lockdown (0056) — the function was replaced above.
revoke execute on function public.set_trivia_screens_armed(uuid, boolean) from public, anon;
grant execute on function public.set_trivia_screens_armed(uuid, boolean) to authenticated, service_role;
