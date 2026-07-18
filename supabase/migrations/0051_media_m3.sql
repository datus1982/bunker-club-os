-- 0051 — media module M3 (docs/15 §M3, RATIFIED as amended): panel slots, program
-- holds (D4/D5 two-tier override), and the per-slot daypart schedule table.
-- Date: 2026-07-17. Branch: phase-media-m3. ADDITIVE ONLY (no drops, no data rewrites).
--
-- Ratified decisions this migration implements (docs/15 §M3, docs/media-m3-mockup.html):
--   D1 geometry / D6 audio / D7 chrome / D8 shape / D9 preemption are pure web — no schema.
--   D2 panel content   → signage_slots.kind ('screen'|'panel'); a panel is just another slot.
--   D3 schedule mech    → slot_program_schedule read anon, derived CLIENT-side (no cron/tick here).
--   D4 sched vs manual  → signage_slots.program_hold + program_set_at (the TWO-TIER hold, owner-ruled):
--        'pin'      = permanent manual pin (the no-schedule default — unchanged from M1/M2).
--        'boundary' = a plain manual flip; yields at the NEXT schedule boundary after program_set_at.
--        'event'    = a SPECIAL EVENT hold; SURVIVES daypart boundaries, expires at the venue
--                     business-day rollover (04:00 closeout) after program_set_at. (Owner's overtime case.)
--      program itself stays signage_slots.program jsonb (0047). null program ⇒ follow schedule/rotation.
--   D5 Q-SYS            → media-control writes program + program_hold='event' by default (see the fn).
--
-- ⚠ Grants: Supabase default-privileges GRANT ALL on new public tables to anon/authenticated.
-- Every block below strips that residue and re-grants precisely (0045/0047 pattern): anon +
-- authenticated SELECT (unattended TVs read as anon), only authenticated may write, and
-- has_module('signage') (via slot_venue) gates WHICH rows.
--
-- Idempotent: add column if not exists / create table if not exists / re-runnable grant+policy blocks.

-- ── signage_slots: panel modeling + the two-tier program hold ─────────────────────
-- kind='panel': a portrait sidebar slot that renders inside a landscape multiview (no TV of its
--   own, never heartbeats). It's a real slot so the whole queue/admin/render stack reuses verbatim.
alter table public.signage_slots
  add column if not exists kind text not null default 'screen'
    check (kind in ('screen', 'panel'));

-- program_hold: which expiry rule the current manual override obeys (null = no override / follow
--   schedule). program_set_at: WHEN the override was set (the anchor for boundary/event expiry).
alter table public.signage_slots
  add column if not exists program_hold text
    check (program_hold in ('pin', 'boundary', 'event'));
alter table public.signage_slots
  add column if not exists program_set_at timestamptz;

-- ── slot_program_schedule (per-slot dayparts; anon-readable; client-derived, NO cron) ─────
-- program: the SlotProgram to run in this daypart; the sentinel {"kind":"rotation"} means an
--   explicit "back to rotation" daypart (distinct from a gap no row covers, which is also rotation).
-- days_of_week: ['MO','TU',…] (scheduled_events.recurrence.daysOfWeek idiom); EMPTY = every day.
-- start_minute / end_minute: venue-local minutes past midnight. end<=start ⇒ the daypart WRAPS
--   past midnight (4 PM → 2 AM); TILL CLOSE is stored as the venue close minute. Resolution is
--   client-side venue-local wall time (Intl), so it is DST-correct without a fixed offset.
-- position: overlap tiebreak — when two rows cover "now", the HIGHER position wins.
create table if not exists public.slot_program_schedule (
  id            uuid primary key default gen_random_uuid(),
  slot_id       uuid references public.signage_slots on delete cascade not null,
  program       jsonb not null,
  days_of_week  text[] not null default '{}',
  start_minute  int not null check (start_minute between 0 and 1439),
  end_minute    int not null check (end_minute between 0 and 1440),
  position      int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz default now()
);
create index if not exists idx_slot_program_schedule_slot on public.slot_program_schedule(slot_id);

-- ── RLS: mirror slot_queue (0045) — anon SELECT, has_module('signage') via slot_venue manage ──
alter table public.slot_program_schedule enable row level security;
revoke all on public.slot_program_schedule from anon, authenticated;
grant select on public.slot_program_schedule to anon, authenticated;
grant insert, update, delete on public.slot_program_schedule to authenticated;

drop policy if exists public_read on public.slot_program_schedule;
create policy public_read on public.slot_program_schedule
  for select to anon, authenticated using (true);

drop policy if exists slot_program_schedule_module_manage on public.slot_program_schedule;
create policy slot_program_schedule_module_manage on public.slot_program_schedule
  for all to authenticated
  using (public.has_module(public.slot_venue(slot_id), 'signage'))
  with check (public.has_module(public.slot_venue(slot_id), 'signage'));

-- ── Realtime: TVs live-update on schedule edits (signage_slots is already published, 0013) ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'slot_program_schedule'
  ) then
    alter publication supabase_realtime add table public.slot_program_schedule;
  end if;
end $$;
