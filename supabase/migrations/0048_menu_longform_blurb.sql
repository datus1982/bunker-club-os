-- 0048 — long-form menu description (docs/09 extension, owner ask 2026-07-16)
--
-- The owner's Toast item descriptions now follow a THREE-part format:
--     <short public blurb>  ---  <recipe>  |  <long-form description with character>
-- (~230 items updated in Toast on 2026-07-16). The segment AFTER the first `|`
-- FOLLOWING the `---` is public BY CONSTRUCTION — he authored it for display. The
-- recipe (between `---` and that `|`) stays PRIVATE and never leaves the edge fn.
--
-- Parsing lives ENTIRELY in the WRITE side (toast-menu-sync menuText.publicLongform,
-- unit-tested via `pnpm test:menutext`) — the single enforcement point of the
-- convention, exactly like publicBlurb (the 0040 lesson: the view must NOT re-parse
-- delimiters or it double-filters and strands real content). This migration only:
--   1. adds toast_menu_cache.long_blurb (holds the already-sanitized long-form text);
--   2. exposes it through public_menu, as-is (nullif-trimmed, no delimiter re-parse);
--   3. grants anon column-level SELECT on the cache column (signage reads the cache
--      directly as anon; the text is sanitized-public by construction).
-- Additive only — never edits an applied migration.

-- ── Column ──────────────────────────────────────────────────────────────────
-- long_blurb: the owner-authored long-form, ALREADY stripped of the recipe by the
-- sync (publicLongform). "" / null when no long-form was authored (or no `---`).
alter table public.toast_menu_cache
  add column if not exists long_blurb text;

-- anon lost the table-wide grant in 0015 (per-column grants since). The public
-- signage slot page reads toast_menu_cache directly (anon) — grant it long_blurb
-- so a future template CAN render the long-form. Mirrors the 0034 pos_visible grant.
-- long_blurb is sanitized-public by construction (never carries recipe text), so —
-- unlike the raw `description` column (0015) — it is safe for anon. authenticated
-- keeps its 0011 table-wide SELECT, which already covers the new column.
grant select (long_blurb) on public.toast_menu_cache to anon;

-- ── public_menu — expose long_blurb ─────────────────────────────────────────
-- Recreated per 0040's shape EXACTLY (the double-filter fix): the view exposes the
-- sanitized cache text directly, nullif-trimmed, with NO delimiter re-parse — the
-- write-side filter is the single enforcement point. Column list/order preserved so
-- CREATE OR REPLACE keeps the relation grants; long_blurb is APPENDED last (a view
-- column can only be added at the end without a DROP). public_blurb (short) is
-- unchanged — long_blurb is purely additive; every existing consumer keeps reading
-- the short blurb.
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
    nullif(trim(long_blurb), '')  as long_blurb
  from public.toast_menu_cache
  where coalesce(menu_group, '') <> '★ SCREENS';

-- Re-assert the anon/authenticated SELECT grant (relation-level covers the new
-- column) and strip the TRIGGER-privilege residue (0040 NOTE-2 house pattern —
-- public views hold SELECT only).
grant select on public.public_menu to anon, authenticated;
revoke trigger on public.public_menu from public, anon, authenticated;
