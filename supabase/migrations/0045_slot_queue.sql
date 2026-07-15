-- 0045 — slot_queue junction (SIGNAGE HUB CONSOLIDATION, phase-hub-consolidation)
-- Source: docs/signage-hub-consolidation-mockup.html VIEW 8 (#schema), the ratified
-- data-spine change: a signage item stops being nailed to one screen and becomes a
-- venue-wide ASSET; a junction (slot_queue) says which screens it's queued on, where,
-- and for how long.
--
-- ⚠ EXPAND ONLY (additive). This project's live DB serves the bar's REAL running TVs,
-- and the CURRENTLY-DEPLOYED bundle still reads signage_items.slot_id. So this migration
-- must NOT drop/alter signage_items.slot_id / sort_order / duration_seconds — dropping
-- them would blank the TVs mid-development. We expand/contract: 0045 expands (adds the
-- junction + backfills so the new reader is byte-identical), 0046 contracts (drops the
-- item→slot binding) but is applied ONLY after the hub PR merges and prod is green.
--
-- Idempotent: create table if not exists / on conflict do nothing / add column if not
-- exists / re-runnable grant+policy blocks.

-- ── slot_venue(slot_id): the venue a slot belongs to ────────────────────────
-- SECURITY DEFINER so the slot_queue write policy can derive venue for has_module()
-- without recursing through signage_slots' own RLS (same idiom as game_venue/team_venue).
create or replace function public.slot_venue(p_slot_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select venue_id from public.signage_slots where id = p_slot_id $$;

grant execute on function public.slot_venue(uuid) to anon, authenticated;

-- ── slot_queue (screen ↔ asset junction) ────────────────────────────────────
-- position       : per-screen order — carries the old signage_items.sort_order.
-- duration_seconds: per-screen dwell — mirrors signage_items.duration_seconds
--                   (int not null default 12) so a backfilled row is byte-identical.
-- active         : is this asset ON AIR on this screen (the future ✕ removes/pauses per
--                   screen). Item-level signage_items.active stays authoritative for the
--                   asset globally; the reader ANDs the two — backfill sets true so the
--                   TVs render identically at cutover.
create table if not exists public.slot_queue (
  slot_id          uuid not null references public.signage_slots(id) on delete cascade,
  item_id          uuid not null references public.signage_items(id) on delete cascade,
  position         int  not null default 0,
  duration_seconds int  not null default 12,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  primary key (slot_id, item_id)
);
create index if not exists idx_slot_queue_item on public.slot_queue(item_id);

-- ── RLS: mirror signage_items exactly (0011 public_read + 0024 has_module manage) ──
alter table public.slot_queue enable row level security;

-- Supabase grants ALL on new public tables to anon/authenticated via default privileges
-- (this module has been burned twice by that residue). Strip it, then re-grant precisely:
-- anon + authenticated may SELECT (unattended TVs read as anon), only authenticated may
-- write — and the has_module policy gates WHICH rows.
revoke all on public.slot_queue from anon, authenticated;
grant select on public.slot_queue to anon, authenticated;
grant insert, update, delete on public.slot_queue to authenticated;

-- Public display read — same as signage_items' public_read (anon TVs need it).
drop policy if exists public_read on public.slot_queue;
create policy public_read on public.slot_queue
  for select to anon, authenticated using (true);

-- Staff manage — same gate as signage_items_module_manage (0024): has_module('signage'),
-- venue derived from the slot via the definer helper (no signage_slots RLS recursion).
drop policy if exists slot_queue_module_manage on public.slot_queue;
create policy slot_queue_module_manage on public.slot_queue
  for all to authenticated
  using (public.has_module(public.slot_venue(slot_id), 'signage'))
  with check (public.has_module(public.slot_venue(slot_id), 'signage'));

-- ── Realtime: add to the publication IF signage_items is in it (TVs live-update) ──
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'signage_items'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'slot_queue'
  ) then
    alter publication supabase_realtime add table public.slot_queue;
  end if;
end $$;

-- ── Backfill: each existing slot-bound item → one queued asset on its original screen ──
-- Carries the item's old sort_order → position and duration_seconds → duration_seconds so
-- the new junction reader resolves the SAME order + dwell the slot_id reader did. Item-level
-- active is unchanged; junction active=true keeps rendering identical. Idempotent.
insert into public.slot_queue (slot_id, item_id, position, duration_seconds, active)
select slot_id, id, sort_order, duration_seconds, true
from public.signage_items
where slot_id is not null
on conflict (slot_id, item_id) do nothing;

-- ── Per-screen takeover scope: nullable slot_id (null = all screens, today's behaviour) ──
alter table public.screen_takeovers add column if not exists slot_id uuid references public.signage_slots(id);
