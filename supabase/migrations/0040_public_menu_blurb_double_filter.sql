-- 0040 — public_menu blurb double-filter fix (+ TRIGGER-grant strip, PR #21 NOTE-2)
--
-- THE BUG (found live 2026-07-14, the owner's first real description paste):
-- toast-menu-sync ALREADY applies the docs/09 description-safety rule at write time
-- (menuText.publicBlurb: text before `---`, or '' with no delimiter) — the cache's
-- `description` column NEVER contains private text. 0015's view then demanded the
-- `---` delimiter AGAIN on that already-stripped text, so the moment the sync
-- sanitized a real description, public_blurb went permanently NULL. Two safety
-- layers from two phases, never both exercised until descriptions existed.
--
-- FIX: the view exposes the sanitized cache text directly. The write-side filter
-- (unit-tested, `pnpm test:menutext`) remains the single enforcement point of the
-- `public --- private` convention. Column list/order/types unchanged (CREATE OR
-- REPLACE keeps grants).
create or replace view public.public_menu as
  select
    guid,
    venue_id,
    menu_group        as "group",
    name,
    nullif(trim(description), '') as public_blurb,
    price,
    coalesce(image_storage_path, image_url) as image,
    not out_of_stock  as in_stock
  from public.toast_menu_cache
  where coalesce(menu_group, '') <> '★ SCREENS';

-- PR #21 review NOTE-2: 0035's default-privilege strip omitted TRIGGER. Not
-- exploitable via PostgREST, but the public views should hold SELECT only.
revoke trigger on public.public_menu from public, anon, authenticated;
revoke trigger on public.public_events from public, anon, authenticated;
revoke trigger on public.signage_events_live from public, anon, authenticated;
revoke trigger on public.teams_public from public, anon, authenticated;
