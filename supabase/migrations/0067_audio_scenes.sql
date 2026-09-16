-- 0067 — audio module PR A (docs/16): scenes + zone presets + state + the agent's live mirror.
-- Date: 2026-09-16. Branch: phase-audio-a. Card: ~/Marvin/projects/bunker/qsys/card-audio-scenes-2026-09-16.md
--
-- Groundwork for AUDIO SCENES over QRC (the platform owns preset DATA, UI and ramps; Q-SYS still
-- owns the room). PR A is schema + the read-only NUC agent — NOTHING here or in the agent writes
-- to the Core, and NOTHING here writes to any existing table. The four tables below are new;
-- every existing venue_staff row is untouched (admin implies every module, so the owner has
-- `audio` by construction; anyone else needs an explicit grant in USERS).
--
-- New MODULE KEY: `audio`. Module keys are documented-not-enforced (0024: "not enforced as an
-- enum so new modules don't need a migration to add") — there is no CHECK constraint on
-- venue_staff.modules (verified live: the only CHECK on venue_staff is venue_staff_role_check).
-- The TS side enumerates keys in useRole.ts / usersShared.ts / moduleLabels.ts + the invite-staff
-- edge fn's KNOWN_MODULES; all four gain `audio` in this PR. Known keys are now:
--   trivia, seasons, drinks, signage, website, events, audio.
--
-- ⚠ Grants: Supabase default-privileges GRANT ALL on new public tables to anon/authenticated.
-- Every block below strips that residue and re-grants precisely (the standing chore): anon gets
-- NOTHING on any audio table (there is no unattended-TV reader of audio data — every reader is a
-- signed-in staffer), authenticated SELECT/INSERT/UPDATE/DELETE gated by has_module('audio'),
-- audio_live is written ONLY through the definer RPC audio_agent_report(), and the agent's CLI
-- capture fills audio_scenes.payload ONLY through audio_agent_capture() (same token gate).
--
-- Idempotent: create table if not exists / on conflict do nothing / re-runnable grant + policy +
-- publication blocks.

-- ── audio_scenes (NORMAL / DJ / KARAOKE / TRIVIA — the buttons) ────────────────────
-- payload = a flat map of {component, control} → value captured FROM THE ROOM by the PR B
-- editor's CAPTURE FROM ROOM. Seeded EMPTY: the app never invents levels (card §2).
create table if not exists public.audio_scenes (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references public.venues on delete cascade,
  name             text not null,
  position         int not null default 0,
  ramp_seconds     numeric not null default 3 check (ramp_seconds >= 0 and ramp_seconds <= 60),
  payload          jsonb not null default '{}'::jsonb,
  is_default       boolean not null default false,
  requires_confirm boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (venue_id, name)
);
-- At most one default scene per venue (the one that recalls without a confirm).
create unique index if not exists audio_scenes_one_default
  on public.audio_scenes (venue_id) where is_default;

-- ── audio_zone_presets (INSIDE / PATIO × LOW / MED / HIGH) ────────────────────────
-- gain_db NULL = not yet authored ("set current as MED" in PR B fills it from audio_live).
create table if not exists public.audio_zone_presets (
  venue_id     uuid not null references public.venues on delete cascade,
  zone         text not null check (zone in ('inside','patio')),
  level        text not null check (level in ('low','med','high')),
  gain_db      numeric check (gain_db is null or (gain_db >= -100 and gain_db <= 10)),
  ramp_seconds numeric not null default 2 check (ramp_seconds >= 0 and ramp_seconds <= 60),
  updated_at   timestamptz not null default now(),
  primary key (venue_id, zone, level)
);

-- ── audio_state (one row per venue: the LABEL of what was last recalled) ──────────
-- The truth is always the live read-back (audio_live); this is the chip's label.
create table if not exists public.audio_state (
  venue_id        uuid primary key references public.venues on delete cascade,
  active_scene_id uuid references public.audio_scenes on delete set null,
  recalled_at     timestamptz,
  recalled_by     text,
  last_error      text
);

-- ── audio_live (one row per venue: the agent's ≤1 Hz mirror of the read-back set) ──
-- Written ONLY by audio_agent_report() below. snapshot shape = docs/16 §Snapshot.
create table if not exists public.audio_live (
  venue_id   uuid primary key references public.venues on delete cascade,
  snapshot   jsonb not null default '{}'::jsonb,
  agent_id   text,
  updated_at timestamptz not null default now()
);

-- ── updated_at maintenance (scenes + presets are hub-edited rows) ─────────────────
create or replace function public.audio_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists audio_scenes_touch on public.audio_scenes;
create trigger audio_scenes_touch before update on public.audio_scenes
  for each row execute function public.audio_touch_updated_at();

drop trigger if exists audio_zone_presets_touch on public.audio_zone_presets;
create trigger audio_zone_presets_touch before update on public.audio_zone_presets
  for each row execute function public.audio_touch_updated_at();

-- ── RLS: staff read/write gated on has_module(venue_id,'audio'); anon NOTHING ────
-- Same shape as the 0024 module policies. audio_live is SELECT-only for staff (its writer is
-- the definer RPC, which runs as the function owner and is not subject to these policies).
do $$
declare t text;
begin
  foreach t in array array['audio_scenes','audio_zone_presets','audio_state','audio_live'] loop
    execute format('alter table public.%I enable row level security', t);
    -- strip the default-privilege residue, then grant precisely
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I_audio_select on public.%I', t, t);
    execute format(
      'create policy %I_audio_select on public.%I for select to authenticated using (public.has_module(venue_id, ''audio''))',
      t, t);
  end loop;

  -- writable by staff with the audio grant: scenes, presets, state (NOT audio_live)
  foreach t in array array['audio_scenes','audio_zone_presets','audio_state'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I_audio_manage on public.%I', t, t);
    execute format(
      'create policy %I_audio_manage on public.%I for all to authenticated using (public.has_module(venue_id, ''audio'')) with check (public.has_module(venue_id, ''audio''))',
      t, t);
  end loop;
end $$;

-- ── audio_agent_token_ok(p_token): the ONE token gate both agent RPCs share ────────
-- DECISION: the agent authenticates with a DEVICE TOKEN held in Vault (secret name
-- 'audio_agent_token'), compared inside SECURITY DEFINER RPCs — the 0042 instagram_token
-- pattern (Vault-by-name, value seeded out-of-band, never committed) rather than a
-- venue_settings key (venue_settings rows are staff-readable, so a token there would leak to
-- every signed-in staffer). Chosen over the MEDIA_DEVICE_TOKEN edge-fn gate (0047 /
-- media-catalog-sync) because it needs no edge function: the NUC agent calls PostgREST directly
-- with the project's PUBLIC anon key (the same key every TV carries) + this token, and each RPC's
-- fixed body is the only thing that can happen. Seed the secret out-of-band (Vault, never here):
--   select vault.create_secret('<AUDIO_AGENT_TOKEN>', 'audio_agent_token');
-- Until it is seeded every agent RPC rejects everything (fail CLOSED).
-- Token compare is on sha256 digests (pgcrypto, already enabled in 0001) so the comparison
-- never touches the raw secret bytes; not a constant-time primitive (none exists in SQL) —
-- the same accepted class as media-control's compare (PR #56 NOTE-7).
-- EXECUTE is revoked from every client role: this helper is callable only from the definer RPCs
-- below (they run as the function owner), never directly as a token oracle.
create or replace function public.audio_agent_token_ok(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'audio_agent_token'
   limit 1;
  if v_secret is null or p_token is null or p_token = '' then
    return false;
  end if;
  return extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
       = extensions.digest(convert_to(v_secret, 'UTF8'), 'sha256');
end;
$$;

revoke all on function public.audio_agent_token_ok(text) from public, anon, authenticated, service_role;

-- ── audio_agent_report(p_token, p_snapshot, p_agent_id) — the agent's mirror write path ──
-- Venue scoping: the RPC signature is fixed by the card (token, snapshot, agent_id), so the
-- venue rides in the snapshot as `venue_id` and must be an existing venue. One token today
-- (one venue); per-venue tokens = a secret name suffix, a two-line change later.
create or replace function public.audio_agent_report(p_token text, p_snapshot jsonb, p_agent_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue  uuid;
begin
  if not public.audio_agent_token_ok(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'snapshot must be a JSON object' using errcode = '22023';
  end if;
  -- A read-back mirror is a few KB; refuse anything that is not one.
  if pg_column_size(p_snapshot) > 262144 then
    raise exception 'snapshot too large' using errcode = '22023';
  end if;

  begin
    v_venue := (p_snapshot ->> 'venue_id')::uuid;
  exception when others then
    v_venue := null;
  end;
  if v_venue is null or not exists (select 1 from public.venues where id = v_venue) then
    raise exception 'snapshot.venue_id must name an existing venue' using errcode = '22023';
  end if;

  insert into public.audio_live (venue_id, snapshot, agent_id, updated_at)
       values (v_venue, p_snapshot, nullif(btrim(coalesce(p_agent_id, '')), ''), now())
  on conflict (venue_id) do update
     set snapshot   = excluded.snapshot,
         agent_id   = excluded.agent_id,
         updated_at = now();
end;
$$;

revoke all on function public.audio_agent_report(text, jsonb, text) from public;
grant execute on function public.audio_agent_report(text, jsonb, text) to anon, authenticated, service_role;

-- ── audio_agent_capture(p_token, p_scene_name, p_payload, p_agent_id) — the CLI capture ──
-- The agent's `npm run capture -- --scene NORMAL` reads the CURRENT lever values from the Core
-- (Component.Get, read-only) and stores them as that scene's payload so tonight's captures
-- survive even if the editor UI (PR B) slips. Same token gate; the scene is matched by name,
-- case-insensitively, within the venue named by p_payload.venue_id; a scene that does not exist
-- is an error (the RPC never creates scenes — those are seeded/authored by staff). The stored
-- payload = p_payload minus venue_id, stamped with captured_at / captured_by. Returns the scene id.
create or replace function public.audio_agent_capture(p_token text, p_scene_name text, p_payload jsonb, p_agent_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue uuid;
  v_scene uuid;
begin
  if not public.audio_agent_token_ok(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;
  if pg_column_size(p_payload) > 262144 then
    raise exception 'payload too large' using errcode = '22023';
  end if;
  begin
    v_venue := (p_payload ->> 'venue_id')::uuid;
  exception when others then
    v_venue := null;
  end;
  if v_venue is null or not exists (select 1 from public.venues where id = v_venue) then
    raise exception 'payload.venue_id must name an existing venue' using errcode = '22023';
  end if;
  select id into v_scene
    from public.audio_scenes
   where venue_id = v_venue
     and upper(name) = upper(btrim(coalesce(p_scene_name, '')))
   limit 1;
  if v_scene is null then
    raise exception 'no scene named "%" for this venue', p_scene_name using errcode = '22023';
  end if;
  update public.audio_scenes
     set payload = (p_payload - 'venue_id')
                   || jsonb_build_object('captured_at', now(), 'captured_by', nullif(btrim(coalesce(p_agent_id, '')), ''))
   where id = v_scene;
  return v_scene;
end;
$$;

revoke all on function public.audio_agent_capture(text, text, jsonb, text) from public;
grant execute on function public.audio_agent_capture(text, text, jsonb, text) to anon, authenticated, service_role;

-- ── Seed: the Bunker venue's four scenes, six presets, one state row ──────────────
-- Fixed recognizable ids so re-runs are no-ops. Payloads EMPTY (captured from the room later).
insert into public.audio_scenes (id, venue_id, name, position, ramp_seconds, payload, is_default, requires_confirm)
values
  ('a0d10000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'NORMAL',  0, 3, '{}'::jsonb, true,  false),
  ('a0d10000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'DJ',      1, 3, '{}'::jsonb, false, true),
  ('a0d10000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', 'KARAOKE', 2, 3, '{}'::jsonb, false, true),
  ('a0d10000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111', 'TRIVIA',  3, 3, '{}'::jsonb, false, true)
on conflict (venue_id, name) do nothing;

insert into public.audio_zone_presets (venue_id, zone, level, gain_db, ramp_seconds)
select '11111111-1111-1111-1111-111111111111', z, l, null, 2
  from unnest(array['inside','patio']) z
 cross join unnest(array['low','med','high']) l
on conflict (venue_id, zone, level) do nothing;

insert into public.audio_state (venue_id)
values ('11111111-1111-1111-1111-111111111111')
on conflict (venue_id) do nothing;

-- ── Realtime: the hub / iPad / phone follow the mirror + labels live ──────────────
do $$
declare t text;
begin
  foreach t in array array['audio_live', 'audio_state', 'audio_scenes', 'audio_zone_presets'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
