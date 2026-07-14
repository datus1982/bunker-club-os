-- 0036 — Top Sellers rotation slide (Phase 8, ROTATION UNIFICATION)
--
-- Adds the 'top_sellers' signage template so the drinks leaderboard (previously a
-- separate /drinks screen URL) becomes ONE slide inside the signage rotation. A screen
-- is pointed at /signage/s/{slug} once; the system decides what shows — trivia goes live
-- → the leaderboard takes over, otherwise the rotation cycles Top Sellers · promos ·
-- events · broadcasts. See docs/signage-redesign-mockup.html views 3 (portrait) / 4
-- (landscape).
--
-- SCHEMA-ONLY: a top_sellers item needs NO new columns — it carries no fields (it is a
-- live slide sourced from sales_cache at render time) and reuses the existing
-- duration_seconds int (default 12, present since 0009 but never surfaced in any UI until
-- this phase's EDIT ROTATION seconds control).
--
-- Idempotent: drop the existing CHECK (whatever its current member set) and re-add it with
-- 'top_sellers' included. Safe to re-run.

alter table public.signage_items
  drop constraint if exists signage_items_template_check;

alter table public.signage_items
  add constraint signage_items_template_check
  check (template in ('drink_special','event','announcement','image_only','celebration','top_sellers'));
