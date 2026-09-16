-- 0068 — audio module PR B (docs/16): the command queue + the agent's gated write lane.
-- Date: 2026-09-16. Branch: phase-audio-b (stacks on phase-audio-a / 0067).
-- Card: ~/Marvin/projects/bunker/qsys/card-audio-scenes-2026-09-16.md
--
-- PR A gave the platform the scene/preset/state tables and a READ-ONLY mirror (audio_live).
-- PR B adds the one thing staff can DO: press a button that becomes a durable, auditable row in
-- `audio_commands`; the NUC agent picks the row up, executes it against the Core (behind the
-- DOUBLE GATE below), and marks it done/error with a result. Nothing in this file touches an
-- existing table's rows — the only ALTER is two nullable columns on audio_state (0067, PR A's
-- own table, additive).
--
-- DECISION (card §3 said "a Supabase realtime channel"): commands are a TABLE, not a broadcast.
-- A broadcast is fire-and-forget on a channel the agent may not be listening to at that second
-- (PR #56 WARN-2 recorded the public-channel hazard); a row is durable (a press while the agent
-- is rebooting still executes), auditable (who pressed what, when, and what the Core said), and
-- RLS-gated by has_module('audio') like every other audio table. The agent reads the queue
-- through a token-gated SECURITY DEFINER RPC at ~1 Hz (the same cadence as its mirror post) —
-- the anon key the agent carries gets NO direct grant on the table, so nothing but the RPC's
-- fixed body can ever read or mutate a command row from the NUC side.
--
-- THE DOUBLE GATE (load-bearing — docs/16 "nothing writes to the Core until Stephen's word"):
--   (a) agent-side  `config.writesEnabled === true` (default false in config.example.json;
--       flipped only on the owner's word, in the room)
--   (b) platform-side an admin has pressed ARM WRITES on the scene editor, which stamps
--       audio_state.writes_armed_by / writes_armed_at. Every command row carries
--       payload.armed_by (the UI copies the current arm token into it); the agent executes only
--       when payload.armed_by == audio_state.writes_armed_by AND the arm has not expired.
--       Expiry is DERIVED AT READ (the 0051 D4 / 0057 pattern — no cron): an arm dies at the
--       venue's next 04:00 business-day rollover after writes_armed_at. audio_agent_take_commands
--       returns `writes_armed_by` + `writes_arm_valid` beside each command so the agent can
--       compare without any direct read of audio_state.
--   With either gate closed the agent marks the row `error` with result.reason='writes_disabled'
--   and puts NOTHING on the wire. capture_scene (reads) is ungated by design.
--
-- ⚠ Grants: default-privilege residue stripped, then granted precisely (the standing chore).
-- Idempotent: create table if not exists / add column if not exists / re-runnable blocks.

-- ── audio_commands — one row per staff press ──────────────────────────────────────
create table if not exists public.audio_commands (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references public.venues on delete cascade,
  kind         text not null check (kind in (
                 'recall_scene', 'zone_preset', 'mic_mute', 'reverb_bypass', 'capture_scene',
                 'sonos_favorite', 'video_source')),
  payload      jsonb not null default '{}'::jsonb,
  requested_by text,
  requested_at timestamptz not null default now(),
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  result       jsonb,
  done_at      timestamptz
);
create index if not exists audio_commands_queue
  on public.audio_commands (venue_id, requested_at) where status in ('queued', 'running');

-- ── audio_state gains the ARM WRITES stamp (additive; PR A's table) ──────────────
alter table public.audio_state add column if not exists writes_armed_by text;
alter table public.audio_state add column if not exists writes_armed_at timestamptz;

-- ── RLS: staff with the audio grant may SELECT + INSERT; nobody edits/deletes a row directly
-- (the agent finishes rows through audio_agent_finish_command; an admin un-arming writes is
-- an audio_state update, which 0067 already allows). anon gets NOTHING.
alter table public.audio_commands enable row level security;
revoke all on public.audio_commands from public, anon, authenticated;
grant select, insert on public.audio_commands to authenticated;
drop policy if exists audio_commands_audio_select on public.audio_commands;
create policy audio_commands_audio_select on public.audio_commands
  for select to authenticated using (public.has_module(venue_id, 'audio'));
drop policy if exists audio_commands_audio_insert on public.audio_commands;
create policy audio_commands_audio_insert on public.audio_commands
  for insert to authenticated with check (
    public.has_module(venue_id, 'audio')
    and status = 'queued'
    and result is null
    and done_at is null
  );

-- ── audio_next_rollover(p_at, p_venue): the venue's next 04:00 business-day rollover after p_at
-- SQL twin of useSignage.nextRollover() (0057 trivia arm expiry) so the agent's gate and the
-- UI's "ARMED" chip agree. Closeout hour = venue_settings 'toast_closeout_hour' (default 4);
-- timezone = venues.timezone (default America/Chicago).
create or replace function public.audio_next_rollover(p_at timestamptz, p_venue uuid)
returns timestamptz
language plpgsql
stable
as $$
declare
  v_tz    text;
  v_close int;
  v_local timestamp;
  v_day   timestamp;
begin
  select coalesce(timezone, 'America/Chicago') into v_tz from public.venues where id = p_venue;
  v_tz := coalesce(v_tz, 'America/Chicago');
  begin
    select coalesce((value #>> '{}')::int, 4) into v_close
      from public.venue_settings where venue_id = p_venue and key = 'toast_closeout_hour';
  exception when others then
    v_close := 4;
  end;
  v_close := coalesce(v_close, 4);
  v_local := p_at at time zone v_tz;
  v_day := date_trunc('day', v_local - make_interval(hours => v_close));
  return (v_day + interval '1 day' + make_interval(hours => v_close)) at time zone v_tz;
end;
$$;
revoke all on function public.audio_next_rollover(timestamptz, uuid) from public;
grant execute on function public.audio_next_rollover(timestamptz, uuid) to authenticated, service_role;

-- ── audio_agent_take_commands(p_token, p_venue, p_agent_id) — the agent's queue read ──
-- Marks up to 10 queued rows `running` (oldest first) and returns them together with the
-- CURRENT arm state so the agent can evaluate gate (b) without a direct audio_state read.
-- A `running` row older than 120 s is re-offered (an agent that died mid-command gets a retry
-- on restart; the executor is idempotent per row because it re-reads the Core before writing).
create or replace function public.audio_agent_take_commands(p_token text, p_venue uuid, p_agent_id text)
returns table (
  id uuid, kind text, payload jsonb, requested_by text, requested_at timestamptz,
  scene_name text, scene_payload jsonb, scene_ramp numeric,
  preset_gain numeric, preset_ramp numeric,
  writes_armed_by text, writes_arm_valid boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_armed_by text;
  v_armed_at timestamptz;
  v_valid    boolean;
begin
  if not public.audio_agent_token_ok(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_venue is null or not exists (select 1 from public.venues v where v.id = p_venue) then
    raise exception 'p_venue must name an existing venue' using errcode = '22023';
  end if;

  select s.writes_armed_by, s.writes_armed_at into v_armed_by, v_armed_at
    from public.audio_state s where s.venue_id = p_venue;
  v_valid := v_armed_by is not null and v_armed_at is not null
             and public.audio_next_rollover(v_armed_at, p_venue) > now();

  return query
    with picked as (
      update public.audio_commands c
         set status = 'running'
       where c.id in (
         select c2.id from public.audio_commands c2
          where c2.venue_id = p_venue
            and (c2.status = 'queued' or (c2.status = 'running' and c2.requested_at < now() - interval '120 seconds'))
          order by c2.requested_at
          limit 10
          for update skip locked
       )
       returning c.id, c.kind, c.payload, c.requested_by, c.requested_at
    )
    select p.id, p.kind, p.payload, p.requested_by, p.requested_at,
           sc.name          as scene_name,
           sc.payload       as scene_payload,
           sc.ramp_seconds  as scene_ramp,
           zp.gain_db       as preset_gain,
           zp.ramp_seconds  as preset_ramp,
           v_armed_by, v_valid
      from picked p
      left join public.audio_scenes sc
        on sc.venue_id = p_venue
       and sc.id = (case when (p.payload ->> 'scene_id') ~ '^[0-9a-fA-F-]{36}$' then (p.payload ->> 'scene_id')::uuid else null end)
      left join public.audio_zone_presets zp
        on zp.venue_id = p_venue
       and p.kind = 'zone_preset'
       and zp.zone  = (p.payload ->> 'zone')
       and zp.level = (p.payload ->> 'level')
     order by p.requested_at;
end;
$$;
revoke all on function public.audio_agent_take_commands(text, uuid, text) from public;
grant execute on function public.audio_agent_take_commands(text, uuid, text) to anon, authenticated, service_role;

-- ── audio_agent_finish_command(p_token, p_id, p_status, p_result) ──────────────────
create or replace function public.audio_agent_finish_command(p_token text, p_id uuid, p_status text, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.audio_agent_token_ok(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_status not in ('done', 'error') then
    raise exception 'p_status must be done or error' using errcode = '22023';
  end if;
  if p_result is not null and pg_column_size(p_result) > 65536 then
    raise exception 'result too large' using errcode = '22023';
  end if;
  update public.audio_commands
     set status = p_status, result = p_result, done_at = now()
   where id = p_id and status in ('queued', 'running');
end;
$$;
revoke all on function public.audio_agent_finish_command(text, uuid, text, jsonb) from public;
grant execute on function public.audio_agent_finish_command(text, uuid, text, jsonb) to anon, authenticated, service_role;

-- ── audio_agent_set_state(p_token, p_venue, p_scene_id, p_by, p_error) — the recall label ──
-- The agent stamps what it last recalled (or the error). Never touches writes_armed_*.
create or replace function public.audio_agent_set_state(p_token text, p_venue uuid, p_scene_id uuid, p_by text, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.audio_agent_token_ok(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  insert into public.audio_state (venue_id, active_scene_id, recalled_at, recalled_by, last_error)
       values (p_venue, p_scene_id, case when p_scene_id is null then null else now() end, p_by, p_error)
  on conflict (venue_id) do update
     set active_scene_id = coalesce(excluded.active_scene_id, public.audio_state.active_scene_id),
         recalled_at     = coalesce(excluded.recalled_at, public.audio_state.recalled_at),
         recalled_by     = coalesce(excluded.recalled_by, public.audio_state.recalled_by),
         last_error      = excluded.last_error;
end;
$$;
revoke all on function public.audio_agent_set_state(text, uuid, uuid, text, text) from public;
grant execute on function public.audio_agent_set_state(text, uuid, uuid, text, text) to anon, authenticated, service_role;

-- ── Realtime: the page watches its own command rows flip queued → done/error ──────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audio_commands'
  ) then
    alter publication supabase_realtime add table public.audio_commands;
  end if;
end $$;
