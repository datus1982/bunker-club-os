-- 0028 — Signage seed slots + public heartbeat RPC (Phase 5, docs/09)
-- Source: docs/09 "Screens & scheduling". The signage_* schema (0009), RLS
-- (0011/0024 — staff manage via has_module('signage'); anon public_read via 0011),
-- and realtime (0013) already exist. This migration only:
--   (1) seeds two starter display slots for the active venue, and
--   (2) adds a narrow SECURITY DEFINER heartbeat so the PUBLIC (anon) slot page can
--       bump its own last_seen — anon has no UPDATE grant on signage_slots (writes
--       are has_module('signage') only), so a definer RPC is the safe touch-one-
--       timestamp path (docs/09 screen-health + docs/12).
-- Idempotent: on conflict do nothing / create or replace. No PII in the seed.

-- ── Starter slots ────────────────────────────────────────────────────────────
insert into public.signage_slots (venue_id, name, orientation, slug, terminal_number, location_label)
values
  ('11111111-1111-1111-1111-111111111111', 'Portrait Main', 'portrait',  'portrait-main', 1, 'Taproom'),
  ('11111111-1111-1111-1111-111111111111', 'Bar TV',        'landscape', 'landscape-bar', 2, 'Bar')
on conflict (slug) do nothing;

-- ── signage_heartbeat(slug) — public screen-health ping ─────────────────────
-- The slot page calls this every ~60s. SECURITY DEFINER so it runs with owner
-- rights (bypasses the has_module write policy) but does exactly one thing: stamp
-- last_seen for the named slug. No row is created, nothing else is mutated, and the
-- parameter is bound (no injection surface). Safe to grant anon.
create or replace function public.signage_heartbeat(p_slug text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.signage_slots set last_seen = now() where slug = p_slug;
$$;

revoke all on function public.signage_heartbeat(text) from public;
grant execute on function public.signage_heartbeat(text) to anon, authenticated;
