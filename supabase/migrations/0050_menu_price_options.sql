-- 0050 — pour-size price options on the public menu (owner ask 2026-07-17)
--
-- The owner's liquor/draft items carry a $0 BASE_PRICE and expose real prices as options in a
-- "Size"/"Tier"/"Pour" modifier group (Menus V2). Those items show NO price on the public menu
-- today. toast-menu-sync (v8) now extracts a compact, public-safe options row per item —
-- e.g. [{"label":"SHOT","price":7},{"label":"COCKTAIL","price":8},{"label":"DOUBLE","price":9}]
-- (drafts: PINT/PITCHER) — via the pure priceOptions.ts extractor (pnpm test:priceoptions).
--
-- Like long_blurb (0048) and pos_visible (0034), the parsing lives ENTIRELY on the WRITE side
-- (the sync edge fn) — the single enforcement point. This migration only:
--   1. adds toast_menu_cache.price_options jsonb (null = no size group / no meaningful prices);
--   2. exposes it through public_menu, as-is (no re-parse), APPENDED last;
--   3. grants anon column-level SELECT on the cache column — the options are public BY
--      CONSTRUCTION (labels + dollar prices, no recipe/internal-build text; the extractor drops
--      the .25oz/.5oz/.75oz internal fractional builds), mirroring the long_blurb (0048) and
--      pos_visible (0034) column grants so signage can read the cache directly as anon.
-- Additive only — never edits an applied migration.

-- ── Column ──────────────────────────────────────────────────────────────────
-- price_options: jsonb array of {label,price}, ascending by price. null when the item has no
-- size/tier/pour group or none of its options carry a meaningful (> 0) price.
alter table public.toast_menu_cache
  add column if not exists price_options jsonb;

-- anon holds only column-level SELECTs on this cache since 0015 (raw description is revoked).
-- price_options is sanitized-public by construction — grant it, mirroring 0048's long_blurb and
-- 0034's pos_visible. authenticated keeps its 0011 table-wide SELECT, which already covers it.
grant select (price_options) on public.toast_menu_cache to anon;

-- ── public_menu — expose price_options ───────────────────────────────────────
-- Recreated per 0049's shape EXACTLY (short public_blurb + long_blurb, the `★ SCREENS` filter,
-- and — critically — the `and pos_visible` POS-visibility gate 0049 restored), with the ONLY
-- change being price_options APPENDED last (a view column can only be added at the end without a
-- DROP). No delimiter re-parse anywhere — the write-side sync is the single enforcement point
-- (the 0040 double-filter lesson). Every existing consumer keeps its columns unchanged.
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
    price_options
  from public.toast_menu_cache
  where coalesce(menu_group, '') <> '★ SCREENS'
    and pos_visible;

-- Re-assert the anon/authenticated SELECT grant (relation-level covers the new column) and
-- strip the TRIGGER-privilege residue CREATE OR REPLACE can resurrect (0040 NOTE-2 house
-- pattern — public views hold SELECT only).
grant select on public.public_menu to anon, authenticated;
revoke trigger on public.public_menu from public, anon, authenticated;
