-- 0046 — drop the signage item→slot binding (SIGNAGE HUB CONSOLIDATION, CONTRACT step)
--
-- ⚠⚠ APPLY ONLY AFTER the hub-consolidation PR is merged and the production deploy is
-- green. ⚠⚠ Until that bundle ships, the DEPLOYED code still reads/writes
-- signage_items.slot_id and would blank the bar's live TVs the moment this runs. This is
-- the CONTRACT half of the 0045 expand/contract — do NOT apply it during development.
--
-- After the new bundle is live, every signage_items reader/writer resolves a screen's
-- assets through slot_queue (0045). signage_items.slot_id and .duration_seconds are then
-- dead columns. NOTE: signage_items.sort_order is NOT dropped — the public WEBSITE readers
-- (modules/website/useThisWeek.ts + useEvents.ts) still `.order("sort_order")` on
-- show_on_website items; per-screen order now lives in slot_queue.position, but the
-- website's own ordering column stays. (Follow-up, out of this phase's scope: give the
-- website its own ordering source so sort_order can retire too.)
--
-- Idempotent: re-runs the straggler backfill, then guards each drop with IF EXISTS.

-- ── 1) Straggler backfill ────────────────────────────────────────────────────
-- The pre-merge deployed bundle keeps INSERTing signage_items.slot_id right up until the
-- new code ships, so a few items created between 0045 and this migration may have a slot_id
-- but no slot_queue row yet. Re-run the 0045 backfill for them (idempotent) so nothing on a
-- screen is lost when slot_id disappears.
insert into public.slot_queue (slot_id, item_id, position, duration_seconds, active)
select slot_id, id, sort_order, duration_seconds, true
from public.signage_items
where slot_id is not null
on conflict (slot_id, item_id) do nothing;

-- ── 2) Drop the dead item→slot binding + the now-unused per-item dwell ────────
-- idx_signage_items_slot references slot_id → drop it first (drop column would drop it too,
-- but be explicit). No RLS policy on signage_items references slot_id or duration_seconds
-- (they gate on venue_id), so no policy changes are needed.
drop index if exists public.idx_signage_items_slot;

alter table public.signage_items drop column if exists slot_id;
alter table public.signage_items drop column if exists duration_seconds;

-- sort_order intentionally retained (see header note — website readers still order by it).
