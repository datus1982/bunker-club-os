-- 0001 — Extensions, tenancy root (venues), venue_settings
-- Source: docs/02 (Core / tenancy). Target schema is greenfield; docs/02 is authoritative.

-- gen_random_uuid() lives in pgcrypto on Supabase; btree_gist backs the seasons
-- no-overlap EXCLUDE constraint (0005). Idempotent.
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ── venues ─────────────────────────────────────────────────────────────────
-- One row today (Bunker Club). venue_id lands on every top-level table so the
-- schema is multi-venue from day one (docs/00 principle 2), feature builds later.
create table if not exists public.venues (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,                              -- 'Bunker Club'
  slug       text unique not null,                       -- 'bunker-club'
  timezone   text not null default 'America/Chicago',
  settings   jsonb not null default '{}',
  created_at timestamptz default now()
);

-- ── venue_settings ─────────────────────────────────────────────────────────
-- docs/02: theme_settings becomes rows here (preferred over venues.settings jsonb
-- because it matches the legacy code shape and is trivially portable). Also the
-- home for cosmetic config: rank-tier labels, ticker manual lines, etc. (docs/06, 09).
create table if not exists public.venue_settings (
  venue_id   uuid not null references public.venues on delete cascade,
  key        text not null,
  value      jsonb not null default '{}',
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  primary key (venue_id, key)
);
