-- 0063_seed_signage_exclusion_groups.sql
--
-- Seed the two DISPLAY-EXCLUSION levers (PR #92 / PR #93) so a project rebuilt from
-- migrations carries them — until now both keys existed only as live data changes
-- (PR #93 reviewer NOTE-2, owner-ratified). Both are display semantics only: they gate
-- what may be ADVERTISED (NOW POURING ticker / ranked sales surfaces), never what is
-- tallied (sales_history, event counters, and cross-ring credits are untouched).
--
--   signage_rung_excluded_groups (PR #92) — menu groups barred from the NOW POURING
--     ticker: "NOW POURING: Hot Dog" is wrong on a drinks ticker, a rung soda water is
--     not a pour. Read by toast-sync via lastRung.parseExcludedGroups.
--   signage_rank_excluded_groups (PR #93) — menu groups barred from RANKED surfaces
--     (sales_cache write gate + CHAMPION/UNDERDOGS read gates). DELIBERATELY a smaller
--     set: Food is barred from the ticker but MUST still rank — the owner's Hot Dog
--     champion ruling (PR #39). Two keys, two intents; never collapse them.
--
-- IDEMPOTENT + verified no-op against live data: at authoring time (2026-08-22) the
-- live rows for venue 11111111-… already carried exactly these values, so the upsert
-- changes nothing. `do update set value = excluded.value` (the 0056/0057 upsert form)
-- is deliberate and owner-ratified for these two keys — the seeds ARE the ratified
-- config; a future re-apply re-asserts it. updated_at is intentionally NOT touched so
-- a no-op apply leaves the rows' timestamps honest.
--
-- venue_settings is already anon-readable via the 0011 public_read policy; no new
-- surface, no new grant.

insert into public.venue_settings (venue_id, key, value) values

  ('11111111-1111-1111-1111-111111111111', 'signage_rung_excluded_groups',
   '["Food","Merch","Soft Drinks"]'::jsonb),

  ('11111111-1111-1111-1111-111111111111', 'signage_rank_excluded_groups',
   '["Soft Drinks"]'::jsonb)

on conflict (venue_id, key) do update set value = excluded.value;
