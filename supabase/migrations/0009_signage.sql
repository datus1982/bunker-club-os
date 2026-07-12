-- 0009 — Signage templater + screen OS
-- Source: docs/09. Schema ships now (Phase 0); the module builds in Phase 5.
-- Includes: slot calibration/heartbeat fields, celebration template, item
-- recurrence, takeover->celebration link, and the Toast menu mirror.

-- ── signage_slots (a schedulable display surface) ───────────────────────────
create table if not exists public.signage_slots (
  id                 uuid primary key default gen_random_uuid(),
  venue_id           uuid not null references public.venues,
  name               text not null,                      -- 'Portrait Left', 'Landscape Bar TV'
  orientation        text not null check (orientation in ('portrait','landscape')),
  slug               text unique not null,               -- public URL: /signage/s/{slug}
  -- Screen identity + health (docs/09, docs/12): heartbeat every 60s -> last_seen.
  terminal_number    int,
  location_label     text,                                -- 'Taproom East'
  last_seen          timestamptz,
  -- Display-canvas overscan backstop (docs/01). Applied by <DisplayCanvas>.
  overscan_inset_pct numeric not null default 0,
  scale_adjust       numeric not null default 1.0,
  created_at         timestamptz default now()
);

-- ── signage_items ───────────────────────────────────────────────────────────
-- fields jsonb carries per-template content incl. source_toast_guid, photo
-- treatment (viewport|phosphor), celebration honoree/occasion, blurb override, etc.
-- recurrence jsonb (same shape as scheduled_events): annual { month, day } or
-- weekly { daysOfWeek }, plus a time window; pg_cron re-arms starts_at/ends_at on
-- completion (holidays configured once, forever).
create table if not exists public.signage_items (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references public.venues,
  slot_id          uuid references public.signage_slots on delete set null,
  template         text not null
                     check (template in ('drink_special','event','announcement','image_only','celebration')),
  fields           jsonb not null default '{}',
  starts_at        timestamptz,                            -- null = evergreen
  ends_at          timestamptz,
  recurrence       jsonb,                                  -- annual/weekly re-arm; null = one-shot
  sort_order       int not null default 0,
  duration_seconds int not null default 12,
  active           boolean not null default true,
  created_by       uuid references public.profiles,
  created_at       timestamptz default now()
);
create index if not exists idx_signage_items_slot   on public.signage_items(slot_id);
create index if not exists idx_signage_items_active on public.signage_items(venue_id, active);

-- ── screen_takeovers (broadcast overrides) ──────────────────────────────────
-- signage_item_id links a scheduled celebration shout-out to its takeover so the
-- celebration's admin card can show/edit its linked moment (docs/09).
create table if not exists public.screen_takeovers (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references public.venues,
  message         text not null,
  sub_message     text,
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,                             -- null = until dismissed
  signage_item_id uuid references public.signage_items on delete cascade,
  created_by      uuid references public.profiles,
  created_at      timestamptz default now()
);
create index if not exists idx_screen_takeovers_venue on public.screen_takeovers(venue_id, starts_at);

-- ── toast_menu_cache (POS as CMS mirror, docs/09) ───────────────────────────
-- toast-menu-sync upserts here; screens read OUR mirrored image, never Toast CDN.
create table if not exists public.toast_menu_cache (
  guid               text primary key,
  venue_id           uuid not null references public.venues,
  name               text,
  description        text,
  price              numeric,
  image_url          text,                                 -- Toast CDN original
  image_storage_path text,                                 -- our mirrored copy (bucket: signage)
  menu_group         text,
  item_tags          text[],
  out_of_stock       boolean not null default false,
  updated_at         timestamptz default now(),
  created_at         timestamptz default now()
);
create index if not exists idx_toast_menu_cache_venue on public.toast_menu_cache(venue_id);
