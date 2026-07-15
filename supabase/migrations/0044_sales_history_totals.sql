-- 0044 — sales_history_totals RPC (reviewer F1 BLOCKER + F2 WARN)
--
-- The smart_toast slides summed sales_history CLIENT-SIDE via a plain PostgREST select, which
-- silently truncates at 1000 rows: a 30-day CHAMPION window is already >1000 rows, so the
-- headline "N SOLD" undercounted with no error. Fix: aggregate SERVER-SIDE in one RPC the TVs
-- call (anon). SECURITY INVOKER so sales_history's existing RLS governs what the caller sees
-- (anon has the read policy; nothing new is exposed — sums are already public via sales_cache).
--
-- F2: the window is EXACTLY p_days business dates ending at the CURRENT venue business date,
-- computed server-side from the venue tz + closeout (not a client gte/lte that spanned days+1
-- in the evening and inflated counts vs the label).
--
-- DECISION: the closeout logic lives HERE, in SQL, mirroring businessDate.ts / toast-sync's
-- effectiveCloseout — local hour < closeout ⇒ the current business date is YESTERDAY (bars roll
-- at ~4am). venue_settings.toast_closeout_hour wins (0..23), else 0 (Toast /config 404s at our
-- tier). This is a third copy of the same rule (edge fn + this RPC); kept intentionally local so
-- the RPC is self-contained for the anon TVs and needs no round-trip. If a fourth copy appears,
-- extract a shared SQL helper.

create or replace function public.sales_history_totals(p_venue uuid, p_days int)
returns table (toast_guid text, total_qty int, first_date text, date_count int)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tz       text;
  v_closeout int;
  v_local    timestamp;
  v_cur      date;
  v_lo       date;
  v_days     int := least(400, greatest(1, coalesce(p_days, 30)));
begin
  -- Venue tz (default America/Chicago) — anon can read public.venues (the board already does).
  select coalesce(v.timezone, 'America/Chicago') into v_tz
    from public.venues v where v.id = p_venue;
  v_tz := coalesce(v_tz, 'America/Chicago');

  -- Closeout hour from venue_settings (jsonb scalar), else 0; clamp to a sane hour.
  select (vs.value #>> '{}')::int into v_closeout
    from public.venue_settings vs
   where vs.venue_id = p_venue and vs.key = 'toast_closeout_hour';
  v_closeout := coalesce(v_closeout, 0);
  if v_closeout < 0 or v_closeout > 23 then v_closeout := 0; end if;

  -- Current venue business date (businessDate.ts semantics): local wall time; during the
  -- [midnight, closeout) gap it is still "last night" → yesterday.
  v_local := now() at time zone v_tz;
  v_cur := v_local::date;
  if extract(hour from v_local) < v_closeout then
    v_cur := v_cur - 1;
  end if;
  v_lo := v_cur - (v_days - 1);           -- inclusive window of EXACTLY v_days dates

  return query
  with win as (
    select h.toast_guid, h.quantity, h.business_date
      from public.sales_history h
     where h.venue_id = p_venue
       and to_date(h.business_date, 'YYYYMMDD') between v_lo and v_cur
  ),
  glob as (
    -- Window-global honesty metrics (same on every row): how far the data actually reaches, so
    -- a shallow-history CHAMPION says "LAST 9 DAYS", never a month it doesn't have.
    select count(distinct w.business_date)::int as dc,
           to_char(min(to_date(w.business_date, 'YYYYMMDD')), 'YYYYMMDD') as fd
      from win w
  )
  select w.toast_guid,
         sum(w.quantity)::int as total_qty,
         g.fd as first_date,
         g.dc as date_count
    from win w cross join glob g
   group by w.toast_guid, g.fd, g.dc
   order by total_qty desc, w.toast_guid;   -- deterministic
end;
$$;

-- House style: strip default-privilege residue, grant execute to exactly the callers (the TVs
-- call it with the anon key; staff surfaces with the authenticated key).
revoke all on function public.sales_history_totals(uuid, int) from public, anon, authenticated;
grant execute on function public.sales_history_totals(uuid, int) to anon, authenticated;
