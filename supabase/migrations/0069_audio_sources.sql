-- 0069 — audio module PR C (docs/16 §1b/§4b): per-SOURCE LOW/MED/HIGH presets + NUDGE ranges +
-- the recall/preset BASELINE the "nudged" readout derives from.
-- Date: 2026-09-16. Branch: phase-audio-c (stacks on 0067 + 0068, both live).
-- Card: ~/Marvin/projects/bunker/qsys/card-audio-scenes-2026-09-16.md — Stephen 2026-09-16:
--   "low/med/high for mics, sonos, and the other audio inputs … moving away from faders and
--    towards 'nudges' but also restricted to certain ranges, never too quiet, never too loud"
--
-- THE SOURCE MODEL (orchestrator DECISION, mirrored in apps/bunker-agent/src/sources.ts):
--   mic1 → Inside Mixer input.1.gain · mic2 → input.2.gain · verb → input.8.gain (Verb Return)
--   sonos / booth / hdmi → input.5.gain ("Selected Source" = whatever Inside Router_8x8
--   select.1 routes: 1 Sonos · 2 Booth · 3 HDMI). A preset/nudge for a source the router is
--   NOT on is refused as `not_routed` by the agent (the preset row itself is still saved here).
--   Inputs 3/4/6/7 are unwired legacy labels and are never a source.
--
-- WHAT THIS FILE TOUCHES: two NEW tables, two additive nullable columns on audio_state (0067,
-- PR A's own table), one NEW token RPC (seed), one NEW token RPC (baseline), and a RE-CREATE of
-- 0068's audio_agent_take_commands (its RETURNS TABLE gains the source preset gain + the venue's
-- ranges — a return-type change needs DROP + CREATE; grants re-issued below). No existing row of
-- any table is modified. Nothing here writes to the Core (the agent does, behind the 0068 double
-- gate + the SCENE_LEVERS intersection, both unchanged).
--
-- NEVER INVENTED: audio_source_presets is seeded NULL (18 rows); audio_source_ranges is NOT
-- seeded here at all — the agent calls audio_agent_seed_ranges() ONCE after it captures NORMAL,
-- with min/max = captured ± 6 dB per source it could read (clamped to [-100, 10]); a row that
-- already exists is never overwritten (the owner's edit wins), a source absent from the capture
-- stays unseeded (UI: "range not set"; nudges refused `range_not_set`).
--
-- ⚠ Grants: default-privilege residue stripped, then granted precisely (the standing chore);
-- client UPDATE is COLUMN-LISTED on both new tables (the #125 WARN-1 lock shape) so no surprise
-- column can be edited from PostgREST. Idempotent: create if not exists / add column if not
-- exists / on conflict do nothing / re-runnable grant + policy + publication blocks.

-- ── audio_source_ranges — the owner's [min, max] + nudge step per source ──────────
create table if not exists public.audio_source_ranges (
  venue_id   uuid not null references public.venues on delete cascade,
  source     text not null check (source in ('mic1','mic2','sonos','booth','hdmi','verb')),
  min_db     numeric not null check (min_db >= -100 and min_db <= 10),
  max_db     numeric not null check (max_db >= -100 and max_db <= 10),
  step_db    numeric not null default 1.5 check (step_db >= 0.5 and step_db <= 6),
  updated_at timestamptz not null default now(),
  primary key (venue_id, source),
  check (min_db < max_db)
);

-- ── audio_source_presets — LOW / MED / HIGH per source (gain_db NULL = not authored) ──
create table if not exists public.audio_source_presets (
  venue_id   uuid not null references public.venues on delete cascade,
  source     text not null check (source in ('mic1','mic2','sonos','booth','hdmi','verb')),
  level      text not null check (level in ('low','med','high')),
  gain_db    numeric check (gain_db is null or (gain_db >= -100 and gain_db <= 10)),
  updated_at timestamptz not null default now(),
  primary key (venue_id, source, level)
);

drop trigger if exists audio_source_ranges_touch on public.audio_source_ranges;
create trigger audio_source_ranges_touch before update on public.audio_source_ranges
  for each row execute function public.audio_touch_updated_at();
drop trigger if exists audio_source_presets_touch on public.audio_source_presets;
create trigger audio_source_presets_touch before update on public.audio_source_presets
  for each row execute function public.audio_touch_updated_at();

-- ── audio_state gains the BASELINE (additive; PR A's table) ───────────────────────
-- baseline = a FLAT map "<Component>|<control>" → value of every lever the agent last SET by a
-- recall (replace) or a zone/source preset (merge). A nudge never touches it — "nudged +1.5 dB"
-- on the page = live lever value − baseline value. Written ONLY through audio_agent_set_baseline.
-- (The '|' separator: no component or control name in the pinned inventory contains one.)
alter table public.audio_state add column if not exists baseline jsonb;
alter table public.audio_state add column if not exists baseline_at timestamptz;

-- ── RLS: staff read/write gated on has_module(venue_id,'audio'); anon NOTHING ────
do $$
declare t text;
begin
  foreach t in array array['audio_source_ranges','audio_source_presets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I_audio_select on public.%I', t, t);
    execute format(
      'create policy %I_audio_select on public.%I for select to authenticated using (public.has_module(venue_id, ''audio''))',
      t, t);
    execute format('drop policy if exists %I_audio_manage on public.%I', t, t);
    execute format(
      'create policy %I_audio_manage on public.%I for all to authenticated using (public.has_module(venue_id, ''audio'')) with check (public.has_module(venue_id, ''audio''))',
      t, t);
  end loop;
end $$;
-- Column-listed client writes (the #125 lock shape): the editor edits exactly these.
-- Ranges: INSERT allowed so the owner can set a range BEFORE the first NORMAL capture seeds it
-- (DECISION — an admin typing a range is authoring, not the app inventing one); no DELETE.
grant insert (venue_id, source, min_db, max_db, step_db) on public.audio_source_ranges to authenticated;
grant update (min_db, max_db, step_db) on public.audio_source_ranges to authenticated;
-- Presets: the 18 rows are seeded; the editor only ever UPDATEs gain_db. No INSERT, no DELETE.
grant update (gain_db) on public.audio_source_presets to authenticated;

-- ── audio_agent_seed_ranges(p_token, p_venue, p_ranges) — the ONE-TIME default ───────
-- p_ranges = [{ source, min_db, max_db }, …] computed by the agent from the NORMAL capture
-- (captured ± 6). Inserts ONLY sources with no row yet (on conflict do nothing) — an existing
-- row (owner-set or an earlier seed) is never touched. Clamps to [-100, 10]; skips a pair that
-- does not satisfy min < max after clamping or names an unknown source. Returns the sources it
-- inserted. Same token gate as every agent RPC (0067 audio_agent_token_ok).
create or replace function public.audio_agent_seed_ranges(p_token text, p_venue uuid, p_ranges jsonb)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  r        jsonb;
  v_src    text;
  v_min    numeric;
  v_max    numeric;
  v_done   text[] := '{}';
  v_ins    text;
begin
  if not public.audio_agent_token_ok(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_venue is null or not exists (select 1 from public.venues v where v.id = p_venue) then
    raise exception 'p_venue must name an existing venue' using errcode = '22023';
  end if;
  if p_ranges is null or jsonb_typeof(p_ranges) <> 'array' then
    raise exception 'p_ranges must be a JSON array' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_ranges) loop
    v_src := r ->> 'source';
    if v_src is null or v_src not in ('mic1','mic2','sonos','booth','hdmi','verb') then continue; end if;
    begin
      v_min := greatest(-100, least(10, (r ->> 'min_db')::numeric));
      v_max := greatest(-100, least(10, (r ->> 'max_db')::numeric));
    exception when others then
      continue;
    end;
    if v_min is null or v_max is null or not (v_min < v_max) then continue; end if;
    insert into public.audio_source_ranges (venue_id, source, min_db, max_db)
         values (p_venue, v_src, v_min, v_max)
    on conflict (venue_id, source) do nothing
    returning source into v_ins;
    if v_ins is not null then v_done := array_append(v_done, v_ins); end if;
    v_ins := null;
  end loop;
  return v_done;
end;
$$;
revoke all on function public.audio_agent_seed_ranges(text, uuid, jsonb) from public;
grant execute on function public.audio_agent_seed_ranges(text, uuid, jsonb) to anon, authenticated, service_role;

-- ── audio_agent_set_baseline(p_token, p_venue, p_levers, p_replace) ─────────────────
-- p_levers = the flat "<Component>|<control>" → value map the agent JUST WROTE. p_replace true
-- (recall_scene) = the scene is the whole new baseline; false (zone/source preset) = merge that
-- lever into the existing map. Never touches active_scene_id / recalled_* / writes_armed_*.
create or replace function public.audio_agent_set_baseline(p_token text, p_venue uuid, p_levers jsonb, p_replace boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.audio_agent_token_ok(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_levers is null or jsonb_typeof(p_levers) <> 'object' then
    raise exception 'p_levers must be a JSON object' using errcode = '22023';
  end if;
  if pg_column_size(p_levers) > 65536 then
    raise exception 'baseline too large' using errcode = '22023';
  end if;
  insert into public.audio_state (venue_id, baseline, baseline_at)
       values (p_venue, p_levers, now())
  on conflict (venue_id) do update
     set baseline    = case when p_replace then excluded.baseline
                            else coalesce(public.audio_state.baseline, '{}'::jsonb) || excluded.baseline end,
         baseline_at = now();
end;
$$;
revoke all on function public.audio_agent_set_baseline(text, uuid, jsonb, boolean) from public;
grant execute on function public.audio_agent_set_baseline(text, uuid, jsonb, boolean) to anon, authenticated, service_role;

-- ── audio_agent_take_commands — RE-CREATED with the source preset gain + the venue's ranges ──
-- Identical to 0068's body (gate (b) derivation, 10-row take, 120 s re-offer, scene/zone joins)
-- plus: `source_preset_gain` (audio_source_presets join for kind = source_preset) and `ranges`
-- (the venue's audio_source_ranges as a jsonb array, repeated on every row — ≤ 6 entries) so the
-- executor clamps recalls and refuses out-of-range nudges without any direct table read.
drop function if exists public.audio_agent_take_commands(text, uuid, text);
create function public.audio_agent_take_commands(p_token text, p_venue uuid, p_agent_id text)
returns table (
  id uuid, kind text, payload jsonb, requested_by text, requested_at timestamptz,
  scene_name text, scene_payload jsonb, scene_ramp numeric,
  preset_gain numeric, preset_ramp numeric,
  source_preset_gain numeric, ranges jsonb,
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
  v_ranges   jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object('source', rg.source, 'min_db', rg.min_db, 'max_db', rg.max_db, 'step_db', rg.step_db) order by rg.source), '[]'::jsonb)
    into v_ranges
    from public.audio_source_ranges rg
   where rg.venue_id = p_venue;

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
           sp.gain_db       as source_preset_gain,
           v_ranges         as ranges,
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
      left join public.audio_source_presets sp
        on sp.venue_id = p_venue
       and p.kind = 'source_preset'
       and sp.source = (p.payload ->> 'source')
       and sp.level  = (p.payload ->> 'level')
     order by p.requested_at;
end;
$$;
revoke all on function public.audio_agent_take_commands(text, uuid, text) from public;
grant execute on function public.audio_agent_take_commands(text, uuid, text) to anon, authenticated, service_role;

-- ── audio_commands: the two new kinds ─────────────────────────────────────────────
-- The 0068 CHECK is an unnamed table constraint; find it by definition and replace it.
do $$
declare v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.audio_commands'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind%';
  if v_name is not null then
    execute format('alter table public.audio_commands drop constraint %I', v_name);
  end if;
  alter table public.audio_commands add constraint audio_commands_kind_check check (kind in (
    'recall_scene', 'zone_preset', 'mic_mute', 'reverb_bypass', 'capture_scene',
    'sonos_favorite', 'video_source', 'source_preset', 'source_nudge'));
end $$;

-- ── Seed: 18 source presets (6 sources × LOW/MED/HIGH), all NULL. Ranges NOT seeded here. ──
insert into public.audio_source_presets (venue_id, source, level, gain_db)
select '11111111-1111-1111-1111-111111111111', s, l, null
  from unnest(array['mic1','mic2','sonos','booth','hdmi','verb']) s
 cross join unnest(array['low','med','high']) l
on conflict (venue_id, source, level) do nothing;

-- ── Realtime: the page follows ranges + presets live (audio_state already published) ──
do $$
declare t text;
begin
  foreach t in array array['audio_source_ranges', 'audio_source_presets'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
