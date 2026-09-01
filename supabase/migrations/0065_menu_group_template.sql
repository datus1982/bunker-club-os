-- 0065 — MENU GROUP signage template (owner ask 2026-09-01).
-- Date: 2026-09-01. Branch: phase-menu-group-slide.
--
-- The owner wants ONE Toast menu group listed full-screen as a rotation slide — "the Tiki
-- Tuesday menu … similarly to how it is on the website, and rotating as a full screen slide.
-- It should dynamically adjust row height to fill the screen and make the images as large as
-- possible."
--
-- This is a pure PRESENTATION addition: the slide is a render-time reader of the SAME anon-safe
-- surfaces the board already reads (toast_menu_cache for name/price/photo/stock/POS-visibility,
-- public_menu for the description-safe short blurb, venue_settings.site_menu_hidden_guids for
-- the website's POS-convenience suppression list). No new table, no new column, no RLS or grant
-- change — every read path it uses was already proven anon-readable by an earlier phase.
--
-- So the ONLY schema change is admitting the new template key into the signage_items CHECK,
-- exactly the idiom 0036 (top_sellers) / 0042 (instagram) / 0043 (smart_toast) / 0055
-- (now_playing) used. Idempotent (drop-then-add), and every existing member is preserved —
-- dropping one would orphan live rows on the bar's running TVs.

alter table public.signage_items
  drop constraint if exists signage_items_template_check;
alter table public.signage_items
  add constraint signage_items_template_check
  check (template in ('drink_special','event','announcement','image_only','celebration','top_sellers','instagram','smart_toast','now_playing','menu_group'));
