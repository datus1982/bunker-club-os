-- 0035 — Scheduled Events Engine (docs/13, Phase 7)
-- Source: docs/13-MODULE-EVENTS.md (2026-07-13 owner-ratified amendment).
--
-- Brings the Phase 0 scheduled_events table (0010) to the amended three-kind spec
-- (WINDOW / MESSAGE / MOMENT), tightens RLS so anon can no longer read raw rows
-- (PR #12 review NOTE 8 — a birthday MESSAGE would otherwise leak names to anyone
-- with the anon key), and adds the self-running tick: a pure-SQL pg_cron job (1/min,
-- no edge fn, no secret) that flips status and re-arms recurrence in the venue TZ.
--
-- Schema diff vs 0010/0015 (verified against the applied migrations, NOT docs blindly):
--   • kind            — NEW here. Everything else docs/13 lists already exists:
--   • skin, fields, toast_guid, fire_at, recurrence, tease_minutes, alert_minutes,
--     window_minutes, interrupt_game, status  — all created by 0010.
--   • show_on_website — added by 0015 (public_events feed). Untouched here.

-- ── 1. kind (window | message | moment) ──────────────────────────────────────
alter table public.scheduled_events
  add column if not exists kind text not null default 'moment'
    check (kind in ('window','message','moment'));

-- ── 2. Partial unique: at most one MOMENT running per venue ───────────────────
-- 0010 constrained ANY one running event per venue. docs/13 amendment: only MOMENTs
-- are exclusive (they take over); WINDOW/MESSAGE are rotation-level and may overlap
-- each other and a moment.
drop index if exists public.uniq_one_running_event_per_venue;
create unique index if not exists uniq_one_running_moment_per_venue
  on public.scheduled_events(venue_id)
  where kind = 'moment' and status = 'running';

-- ── 3. RLS tightening — revoke blanket anon read (docs/13; PR #12 NOTE 8) ─────
-- 0011 gave anon a table-wide SELECT + a using(true) read policy. Drop both. Staff
-- keep their read/write via 0024's scheduled_events_module_manage (has_module('events'),
-- for all → covers SELECT). authenticated keeps the table-level grant from 0011; anon
-- loses it. Displays (anon) read ONLY the horizon-gated signage_events_live view below.
drop policy if exists public_read on public.scheduled_events;
revoke select on public.scheduled_events from anon;

-- Confirm staff write/read policy is present (0024). Re-assert idempotently so this
-- migration is self-contained even if replayed on a fresh DB after 0024.
drop policy if exists scheduled_events_module_manage on public.scheduled_events;
create policy scheduled_events_module_manage on public.scheduled_events
  for all to authenticated
  using (public.has_module(venue_id, 'events'))
  with check (public.has_module(venue_id, 'events'));

-- ── 4. signage_events_live — anon display feed, horizon-gated ─────────────────
-- SECURITY DEFINER by default (like public_menu/public_events): runs with the owner's
-- rights, so anon reads it without any privilege on the base table. Exposes a row ONLY
-- inside its on-screen horizon and ONLY display-rendered columns. Statuses aborted /
-- disabled / completed never appear (they resolve outside the time window too, but the
-- status filter is the hard gate).
--   • moment      : fire_at − tease_minutes  →  fire_at + window_minutes + 2 min all-clear
--   • window/msg  : fire_at                  →  fire_at + window_minutes
create or replace view public.signage_events_live as
  select
    se.id,
    se.venue_id,
    se.name,
    se.kind,
    se.skin,
    se.fields,          -- display copy incl. fields.live_count (per-minute counter cache)
    se.toast_guid,
    se.fire_at,
    se.tease_minutes,
    se.alert_minutes,
    se.window_minutes,
    se.interrupt_game,
    se.status
  from public.scheduled_events se
  where se.status in ('scheduled', 'running')
    and se.fire_at is not null
    and (
      (se.kind = 'moment'
        and now() >= se.fire_at - make_interval(mins => se.tease_minutes)
        and now() <  se.fire_at + make_interval(mins => se.window_minutes) + interval '2 minutes')
      or
      (se.kind in ('window', 'message')
        and now() >= se.fire_at
        and now() <  se.fire_at + make_interval(mins => se.window_minutes))
    );

grant select on public.signage_events_live to anon, authenticated;

-- ── 5. next_scheduled_occurrence() — recurrence → next fire_at, venue-TZ, DST-safe ──
-- recurrence = { "daysOfWeek": ["MO","TU",…], "time": "HH:MM" } interpreted in p_tz.
-- Returns the earliest instant strictly AFTER p_after whose venue-local weekday is in
-- daysOfWeek and venue-local time is `time`. Using AT TIME ZONE with the zone NAME makes
-- the math DST-correct (never a fixed offset). Anchoring on p_after = now() means a
-- long-missed window re-arms to the next FUTURE occurrence, not the day after a stale
-- fire_at. Returns null for a one-shot (recurrence null / empty).
create or replace function public.next_scheduled_occurrence(
  p_recurrence jsonb,
  p_after      timestamptz,
  p_tz         text
) returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_time    time;
  v_dow_map jsonb := '{"SU":0,"MO":1,"TU":2,"WE":3,"TH":4,"FR":5,"SA":6}'::jsonb;
  v_allowed int[] := '{}';
  d         text;
  v_date0   date;
  i         int;
  cand_date date;
  cand_ts   timestamptz;
begin
  if p_recurrence is null
     or p_recurrence->>'time' is null
     or p_recurrence->'daysOfWeek' is null
     or jsonb_typeof(p_recurrence->'daysOfWeek') <> 'array'
     or jsonb_array_length(p_recurrence->'daysOfWeek') = 0 then
    return null;
  end if;

  v_time := (p_recurrence->>'time')::time;

  for d in select jsonb_array_elements_text(p_recurrence->'daysOfWeek') loop
    if v_dow_map ? upper(d) then
      v_allowed := v_allowed || (v_dow_map->>upper(d))::int;
    end if;
  end loop;
  if array_length(v_allowed, 1) is null then
    return null;
  end if;

  -- Venue-local calendar date of the anchor.
  v_date0 := (p_after at time zone p_tz)::date;

  -- Scan today .. +7 local days; first (dow-matching, local-time) instant strictly
  -- after p_after wins. +7 guarantees a hit for any single matching weekday.
  for i in 0..7 loop
    cand_date := v_date0 + i;
    if extract(dow from cand_date)::int = any (v_allowed) then
      cand_ts := (cand_date + v_time) at time zone p_tz;  -- local wall-clock → timestamptz
      if cand_ts > p_after then
        return cand_ts;
      end if;
    end if;
  end loop;

  return null;
end;
$$;

-- Lock browser-facing roles out; backend (service_role) + cron (owner) keep it.
revoke all on function public.next_scheduled_occurrence(jsonb, timestamptz, text) from public, anon, authenticated;
grant execute on function public.next_scheduled_occurrence(jsonb, timestamptz, text) to service_role;

-- ── 6. tick_scheduled_events() — the once-a-minute status machine ─────────────
-- Pure SQL (no edge fn, no secret). For every live row:
--   scheduled → running   when now() enters [fire_at, end)
--   running   → completed  when now() >= end     (end = fire_at + window + 2min for moment)
--   on completion: re-arm to next_scheduled_occurrence(recurrence) if recurring,
--                  else leave 'completed'.
--   MISSED WINDOW (scheduled but now() already past end — created in the past / venue
--   closed): skip straight to re-arm/complete, never fire retroactively.
-- Guards: FOR UPDATE SKIP LOCKED (no double-processing across overlapping ticks) +
-- a status predicate on every UPDATE (one-way transition per row per tick, clock-skew
-- safe). A scheduled moment won't fire while another moment is already running for the
-- venue (avoids the partial-unique violation aborting the whole tick).
create or replace function public.tick_scheduled_events()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_end  timestamptz;
  v_next timestamptz;
begin
  for r in
    select se.id, se.venue_id, se.kind, se.status, se.fire_at,
           se.window_minutes, se.recurrence,
           coalesce(v.timezone, 'America/Chicago') as tz
    from public.scheduled_events se
    join public.venues v on v.id = se.venue_id
    where se.status in ('scheduled', 'running')
      and se.fire_at is not null
    for update of se skip locked
  loop
    v_end := r.fire_at
             + make_interval(mins => r.window_minutes)
             + case when r.kind = 'moment' then interval '2 minutes' else interval '0 seconds' end;

    if now() >= v_end then
      -- Window is fully past (whether we ever flipped to running or missed it entirely):
      -- complete, and re-arm if recurring.
      v_next := public.next_scheduled_occurrence(r.recurrence, now(), r.tz);
      if v_next is not null then
        update public.scheduled_events
           set fire_at = v_next, status = 'scheduled'
         where id = r.id and status = r.status;
      else
        update public.scheduled_events
           set status = 'completed'
         where id = r.id and status = r.status;
      end if;

    elsif r.status = 'scheduled' and now() >= r.fire_at then
      -- Entered the active window: fire — unless another moment already holds the venue.
      if r.kind = 'moment' and exists (
           select 1 from public.scheduled_events x
           where x.venue_id = r.venue_id
             and x.kind = 'moment'
             and x.status = 'running'
             and x.id <> r.id
         ) then
        null;  -- DECISION: defer; it becomes a missed-window on a later tick if unclaimed.
      else
        update public.scheduled_events
           set status = 'running'
         where id = r.id and status = 'scheduled';
      end if;
    end if;
    -- else: still in the future (or a moment's tease/alert lead-in) — leave scheduled.
  end loop;
end;
$$;

revoke all on function public.tick_scheduled_events() from public, anon, authenticated;
grant execute on function public.tick_scheduled_events() to service_role;

-- ── 7. pg_cron: run the tick every minute (plain SQL, no Vault secret) ────────
-- cron.schedule upserts on jobname, so replay is idempotent.
do $$
begin
  perform cron.schedule(
    'scheduled-events-tick-1m',
    '* * * * *',
    'select public.tick_scheduled_events();'
  );
exception when undefined_function or invalid_schema_name then
  raise notice 'pg_cron not ready — schedule scheduled-events-tick-1m manually';
end $$;
