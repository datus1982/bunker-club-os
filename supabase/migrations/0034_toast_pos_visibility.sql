-- 0034 — Toast POS-visibility gate (site-refinement-3)
--
-- Owner principle (verbatim): "I never want any product advertised unless it's
-- active on the POS view. Toast has multiple places for visibility for online
-- ordering etc." We previously synced only stock (86) status; POS visibility was
-- not synced, so a group the owner HID in Toast (e.g. "Winter Cocktails") still
-- sat in our cache as in-stock and surfaced on the public /menu (interim-hidden
-- by explicit guid in 0033 until this migration).
--
-- ── Toast payload finding (Menus V2 /menus/v2/menus, live 2026-07-13) ─────────
-- Every menu / menuGroup / menuItem carries a `visibility` ARRAY of channel
-- strings, e.g. ["ORDERING_PARTNERS","TOAST_ONLINE_ORDERING","POS","KIOSK"].
-- "POS" present = the entity is active on the register (the POS view). The owner
-- hid "Winter Cocktails" at the GROUP level: its group `visibility` is [] (empty
-- — hidden on every channel), EVEN THOUGH each Winter item still lists
-- ["POS","KIOSK"] on its own. So item-level visibility alone would NOT catch it —
-- the hidden state lives on the GROUP and must cascade to its items. Healthy
-- groups always contain "POS" (many are POS-only: Classics/Shots/etc. = ["POS"]).
--
--   ⇒ pos_visible (advertisable) = "POS" ∈ group.visibility  AND  "POS" ∈ item.visibility,
--     with the group test cascading through nested sub-groups. (The sync computes
--     this; see supabase/functions/toast-menu-sync/index.ts.)
--
-- This migration is additive: it adds the columns + folds `pos_visible` into the
-- public_menu view. The sync (deployed separately) populates the columns.

-- ── Columns ─────────────────────────────────────────────────────────────────
-- pos_visible: the semantic gate — TRUE means "visible/active on the POS view",
--   i.e. advertisable per the owner's principle. Defaults TRUE so a schema
--   surprise or a not-yet-synced row never wrongly vanishes (matches the sync's
--   default-in-stock philosophy); the sync flips hidden rows to FALSE.
-- visibility: the item's raw Toast channel array, kept as jsonb for future
--   per-channel granularity (e.g. a separate online-ordering surface). Not
--   granted to anon (like description) — staff/authenticated read it table-wide.
alter table public.toast_menu_cache
  add column if not exists pos_visible boolean not null default true;
alter table public.toast_menu_cache
  add column if not exists visibility jsonb;

-- anon lost the table-wide grant in 0015 (per-column grant). The public signage
-- slot page reads toast_menu_cache directly (anon) and needs pos_visible to gate
-- ★ SCREENS materialization + drink_special auto-hide. Grant that ONE column;
-- `visibility` stays authenticated-only. authenticated keeps its 0011 table-wide
-- grant, which already covers both new columns.
grant select (pos_visible) on public.toast_menu_cache to anon;

-- ── public_menu — add the POS-visibility gate ───────────────────────────────
-- Recreated per 0015's pattern: DEFINER view, public_blurb = text BEFORE `---`
-- (else null), ★ SCREENS group excluded, in_stock exposed. NEW: `and pos_visible`
-- so a POS-hidden item (e.g. all of Winter Cocktails) can never reach the public
-- menu — the interim guid list in 0033 no longer has to carry it.
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
  where coalesce(menu_group, '') <> '★ SCREENS'
    and pos_visible;

grant select on public.public_menu to anon, authenticated;
