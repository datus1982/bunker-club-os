-- 0030 — Operating-hours config alignment (Phase 3.5)
--
-- Owner-confirmed (2026-07-12): Bunker Club is open 4 PM – 2 AM, seven days a week.
-- The drinks leaderboard sync window (venue_settings 'drinks_sync_window') was seeded
-- in 0020 as 16:00–02:30. 0020 is merged history (never edit an applied migration), so
-- realign the live value here. This governs:
--   • toast-sync edge fn — only hits Toast within the window (self-gates each run).
--   • useDashboard freshness gating — a stale sales_cache reads as "idle" (not alarm)
--     outside operating hours.
-- Both consumers already interpret the window as midnight-spanning (close < open:
-- cur >= open OR cur < close), so 16:00–02:00 correctly covers the overnight close.
--
-- NON-DESTRUCTIVE: only rewrites the one key; no schema change. Idempotent (re-running
-- sets the same value).

update public.venue_settings
   set value = '{ "open": "16:00", "close": "02:00" }'::jsonb
 where venue_id = '11111111-1111-1111-1111-111111111111'
   and key = 'drinks_sync_window';
