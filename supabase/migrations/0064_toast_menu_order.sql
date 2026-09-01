-- 0064 — Toast IS the menu order (owner ask 2026-09-01)
--
-- "I want to be able to set the order [in Toast], I don't want to have to come to a session."
--
-- Until now the public /menu ordered its SECTIONS from the venue_settings
-- `site_menu_group_order` list (seeded in 0031) with a byte-matching constant in
-- useMenu.ts as the fallback, and its ITEMS alphabetically. Any group the owner
-- added in Toast (e.g. "Tiki Tuesday") fell to the bottom of the page until a
-- developer edited both the DB row and the constant — the exact hand-off he wants
-- gone. Toast is already the CMS for names/prices/photos/descriptions/visibility
-- (docs/09 "POS as CMS"); this makes it the CMS for ORDER too.
--
-- Like pos_visible (0034), long_blurb (0048) and price_options (0050), the derivation
-- lives ENTIRELY on the WRITE side — toast-menu-sync (v10) records where each item sat
-- in the Toast menu walk. This migration only stores + exposes those numbers:
--   1. toast_menu_cache.group_position — monotonically increasing per group across the
--      whole walk (menus in Toast's order, groups in order, sub-groups depth-first right
--      after their parent). Every item in a group carries its group's number.
--   2. toast_menu_cache.item_position — the item's index inside its group's menuItems.
--   3. both exposed through public_menu, APPENDED last (a view column can only be added
--      at the end without a DROP), so every existing consumer keeps its columns.
-- Both are NULLABLE: null = unknown / not yet synced. The website sorts nulls LAST and
-- tiebreaks by name, so a half-synced cache degrades to the old alphabetical behaviour
-- instead of scrambling.
--
-- NOTE: `site_menu_group_order` (0031) becomes DEAD after this ships — nothing reads it.
-- It is deliberately NOT deleted here (a migration that drops the owner's data while the
-- previous bundle may still be running in a browser tab would strand that tab's ordering).
-- Retiring the row is a post-deploy DATA step.
-- Additive only — never edits an applied migration.

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.toast_menu_cache
  add column if not exists group_position integer,
  add column if not exists item_position integer;

-- Cheap index for the ordered read (single venue, ~300 rows — belt and braces).
create index if not exists toast_menu_cache_position_idx
  on public.toast_menu_cache (venue_id, group_position, item_position);

-- DECISION: no anon column-level grant on the cache columns (unlike 0050's price_options).
-- Only the website reads ordering, and it reads it through public_menu; no signage surface
-- reads toast_menu_cache directly for order. authenticated keeps its 0011 table-wide SELECT.

-- ── public_menu — expose group_position + item_position ──────────────────────
-- Recreated per 0050's shape EXACTLY (short public_blurb + long_blurb + price_options, the
-- `★ SCREENS` filter, and the `and pos_visible` POS-visibility gate 0049 restored), with the
-- ONLY change being the two position columns APPENDED last. No re-parse anywhere — the
-- write-side sync stays the single enforcement point (the 0040 double-filter lesson).
create or replace view public.public_menu as
  select
    guid,
    venue_id,
    menu_group        as "group",
    name,
    nullif(trim(description), '') as public_blurb,
    price,
    coalesce(image_storage_path, image_url) as image,
    not out_of_stock  as in_stock,
    nullif(trim(long_blurb), '')  as long_blurb,
    price_options,
    group_position,
    item_position
  from public.toast_menu_cache
  where coalesce(menu_group, '') <> '★ SCREENS'
    and pos_visible;

-- Re-assert the anon/authenticated SELECT grant (relation-level covers the new columns) and
-- strip the TRIGGER-privilege residue CREATE OR REPLACE can resurrect (0040 NOTE-2 house
-- pattern — public views hold SELECT only).
grant select on public.public_menu to anon, authenticated;
revoke trigger on public.public_menu from public, anon, authenticated;
