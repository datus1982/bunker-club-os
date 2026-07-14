-- 0041 — Recurring end date (recurrence.until)
-- Owner ask (2026-07-14, design beat): "for recurring there should be an end date."
--
-- A recurring promo can now carry an optional stop date so a manager schedules it once
-- and it retires itself instead of running forever. No new column — the date lives inside
-- the existing recurrence jsonb as `until: "YYYY-MM-DD"` (a venue-LOCAL calendar date).
--
-- DECISION (inclusive semantics; jsonb field vs. column): `until` is INCLUSIVE — the event
-- still fires ON that date, and only occurrences whose venue-local date is strictly AFTER
-- `until` are suppressed. Stored as a jsonb field (not a new column) because recurrence is
-- already the single jsonb home for the whole schedule shape (daysOfWeek + time); the
-- frontend round-trips one object, and next_scheduled_occurrence already receives the whole
-- recurrence, so no signature change is needed.
--
-- SINGLE ENFORCEMENT POINT: only next_scheduled_occurrence() changes. When the computed next
-- occurrence's venue-local date is after `until`, it returns NULL. tick_scheduled_events()
-- already treats a NULL "next occurrence" on completion as "no more occurrences → completed",
-- so an expired recurring event retires exactly like a one-shot — the tick is untouched.
--
--   recurrence.until      next occurrence local date      result
--   ------------------    ----------------------------    ------------------------------
--   (absent)              any                             returns the occurrence (forever)
--   >= occurrence date    on or before until              returns the occurrence
--   < occurrence date     after until                     returns NULL → tick completes it

-- Venue-TZ / DST-safe pattern preserved verbatim from 0035 — only the `until` parse (v_until)
-- and the post-match cutoff (cand_date > v_until → null) are added.
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
  v_until   date;
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

  -- Optional inclusive end date (venue-local). Absent/blank = runs forever.
  if p_recurrence->>'until' is not null and length(trim(p_recurrence->>'until')) > 0 then
    v_until := (p_recurrence->>'until')::date;
  end if;

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
        -- Inclusive cutoff: an occurrence ON `until` still fires; strictly-after retires.
        if v_until is not null and cand_date > v_until then
          return null;
        end if;
        return cand_ts;
      end if;
    end if;
  end loop;

  return null;
end;
$$;

-- Re-assert the browser-role lockout from 0035 (create-or-replace keeps grants, but keep
-- this migration self-contained on a fresh replay).
revoke all on function public.next_scheduled_occurrence(jsonb, timestamptz, text) from public, anon, authenticated;
grant execute on function public.next_scheduled_occurrence(jsonb, timestamptz, text) to service_role;
