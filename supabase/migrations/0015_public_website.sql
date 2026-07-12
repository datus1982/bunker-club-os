-- 0015 — Public website support (docs/14, Phase 3.5)
-- Reconciles the schema with docs/14 (public marketing site) + the updated docs/09
-- Toast section. Additive only — never edits an applied migration.
--
--   • show_on_website flags: one toggle publishes a screen promo/event to the site.
--   • public-safe views (public_menu, public_events): anon reads THESE, never the
--     raw description column (Toast descriptions may carry internal recipes —
--     docs/09 description-safety rule; docs/14 "never raw description column").
--   • anon loses column-level SELECT on toast_menu_cache.description (mirrors the
--     pin_hash lockdown in 0011). Staff (authenticated) keep it for /signage admin.

-- ── Publish flags ───────────────────────────────────────────────────────────
-- signage_items: publish a screen promo/event/celebration to /events. Staff flow
-- otherwise unchanged (docs/14). scheduled_events: publish tease copy only.
alter table public.signage_items
  add column if not exists show_on_website boolean not null default false;
alter table public.scheduled_events
  add column if not exists show_on_website boolean not null default false;

-- ── Lock the raw description column away from anon ──────────────────────────
-- 0011 granted anon a table-wide SELECT on toast_menu_cache; a table-level grant
-- silently covers every column. Drop it and re-grant per column, excluding
-- description, so anon can never read raw recipe text. The public_read policy
-- (using(true)) still gates rows; display routes need name/price/photo/stock, not
-- the description. authenticated keeps its table-wide grant from 0011 (staff admin).
revoke select on public.toast_menu_cache from anon;
grant select
  (guid, venue_id, name, price, image_url, image_storage_path,
   menu_group, item_tags, out_of_stock, updated_at, created_at)
  on public.toast_menu_cache to anon;

-- ── public_menu (docs/14) ───────────────────────────────────────────────────
-- DEFINER view (default semantics, like teams_public): anon has no privilege on
-- the description column, but the view runs with owner rights and exposes ONLY the
-- computed public blurb. public_blurb = text BEFORE a `---` delimiter; absent a
-- delimiter, NULL — "show nothing until a human fills the blurb override" (docs/09).
-- Excludes the hidden ★ SCREENS toggle-duplicate group (docs/09). in_stock exposed
-- so the page can hide 86'd items or badge them 'gone for now' (docs/14).
create or replace view public.public_menu as
  select
    guid,
    venue_id,
    menu_group        as "group",
    name,
    case when description like '%---%'
         then nullif(trim(split_part(description, '---', 1)), '')
         else null end as public_blurb,
    price,
    coalesce(image_storage_path, image_url) as image,
    not out_of_stock  as in_stock
  from public.toast_menu_cache
  where coalesce(menu_group, '') <> '★ SCREENS';

-- ── public_events (docs/14) ─────────────────────────────────────────────────
-- Tease copy only, no stage internals (docs/14). DEFINER view exposes a curated
-- column set from scheduled_events flagged for the website and not yet finished.
-- The /events route also reads website-flagged signage_items directly (already
-- anon-readable display data) and the weekly trivia standing block.
create or replace view public.public_events as
  select
    id,
    venue_id,
    name,
    skin,
    fire_at,
    fields ->> 'title'  as title,
    fields ->> 'blurb'  as blurb
  from public.scheduled_events
  where show_on_website = true
    and status in ('scheduled', 'running');

-- ── Grants (anon reads the views, never the raw description) ─────────────────
grant select on public.public_menu   to anon, authenticated;
grant select on public.public_events to anon, authenticated;
