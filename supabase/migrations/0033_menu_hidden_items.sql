-- 0033 — public /menu hidden items (site-refinement-1, docs/14)
--
-- One owner-driven venue_settings key:
--
--   site_menu_hidden_guids — a jsonb array of toast_menu_cache.guid strings that
--                            must NOT appear on the public /menu. Some Toast POS
--                            entries are register-convenience items (e.g. a
--                            "Sputnik 1/2 off" priced-down duplicate the bartender
--                            rings up) that are real menu rows but shouldn't be
--                            marketed to the public. The public_menu view can't
--                            distinguish them, so we hide them by explicit guid.
--
-- HOW TO ADD A GUID (until an admin UI exists): find the item's guid in
-- toast_menu_cache (or the drinks admin), then append it to the array in ALL
-- THREE places below — no partial edits.
--
-- THREE-WAY INVARIANT (mirrors 0031): this array is byte-identical across (1) this
-- seed, (2) the FALLBACK in the consuming hook (useMenu.ts MENU_HIDDEN_GUIDS_FALLBACK),
-- and (3) the live DB row. The fallback is the first-paint / key-missing / offline
-- value; if the three drift, an item can flicker onto the public menu. Update all
-- three together.
--
-- NOTE — this list governs ONLY the public /menu (useMenu.ts). The drinks display
-- board reads sales_cache top-sellers via a different path and does NOT consult
-- this list, so a hidden item that is also a top seller would still surface on the
-- drinks board. Extending suppression there is a future owner call, out of scope here.
--
-- IDEMPOTENT + NON-DESTRUCTIVE: `on conflict do nothing` — never clobbers a list the
-- owner has since edited. venue_settings is already anon-readable via the 0011
-- `public_read` policy; no new surface, no new grant.

insert into public.venue_settings (venue_id, key, value) values

  ('11111111-1111-1111-1111-111111111111', 'site_menu_hidden_guids',
   '[
     "fa3603be-0965-42d0-9cca-6e0708cce1f0"
   ]'::jsonb)

on conflict (venue_id, key) do nothing;
