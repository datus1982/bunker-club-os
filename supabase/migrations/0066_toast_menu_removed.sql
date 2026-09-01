-- 0066 — Toast is the SOLE source of truth: items that leave Toast leave the platform.
--
-- Owner ruling (2026-09-01, verbatim):
--   "Toast should be the sole source of truth. If it is in Toast, visible, in stock,
--    sellable, it should show up. If it's hidden, 86'd, deleted, etc it should be gone."
--
-- toast-menu-sync has always UPSERTED every item the Menus V2 payload contains, but it has
-- never handled the other direction — an item DELETED in Toast, or removed from every menu,
-- simply stopped being refreshed and sat in `toast_menu_cache` forever with its last-known
-- name/price and (crucially) its last-known pos_visible=true. 21 of 261 POS-visible rows on
-- the day this shipped were in exactly that state (Fireball Shot, Jägermeister Shot, Malört
-- Shot, Crown Apple Whiskey, Monopolowa Vodka, Hendrick's Grand Cabaret Gin, "Sputnik 1/2
-- off", …) — still renderable on bunkerokc.com/menu and still offerable in the signage
-- source picker, months after the owner deleted them.
--
-- This migration only STORES the fact. Like pos_visible (0034), long_blurb (0048),
-- price_options (0050) and group_position (0064), the DERIVATION lives entirely on the WRITE
-- side: toast-menu-sync v11 diffs the payload's guid set against the cache and flags the
-- absent rows (the 0040 lesson — one enforcement point, never a second filter at read time).
--
--   removed_at  null      = present in the last full Toast walk (the normal state)
--               timestamp = absent from Toast as of that moment
--
-- NO VIEW CHANGE IS NEEDED. The sync sets pos_visible=false alongside removed_at, and every
-- customer-facing surface is already gated on pos_visible:
--   • public_menu (0034/0049) — `and pos_visible` in the view's WHERE, so the website menu,
--     promoResolve and the What's-On dynamic cards all drop the row;
--   • ranked surfaces — rankFilter.ts (toast-sync) and rankGates.ts (signage) both treat
--     pos_visible === false as un-rankable, so top sellers / champion / underdogs close ranks;
--   • lastRung.ts — NOW POURING skips pos_visible=false;
--   • useSignage — drink_special auto-hide and the ★ SCREENS materialization both require
--     pos_visible.
-- removed_at exists so STAFF surfaces can say WHY ("REMOVED FROM TOAST" reads very
-- differently from "POS-HIDDEN": one is a dead reference, the other is a Toast toggle away
-- from coming back) and so a returning item is provably restored — the sync writes
-- removed_at = null on every present row, every pass.
--
-- Restoration is automatic: put the item back in Toast, publish, and the next sync (≤2 min)
-- upserts it with removed_at=null and its real pos_visible. Nothing is deleted here — the
-- row keeps its name/blurbs/photo/positions history so a return is byte-for-byte a restore.
--
-- DECISION: no anon column-level grant. anon's SELECT on this table is COLUMN-LEVEL (0015
-- revoked `description`), so a new column is invisible to anon unless granted — and the
-- public TV reader (useSignage) deliberately does NOT select it. Only the authenticated
-- staff hub reads removed_at, and `authenticated` holds a relation-level SELECT, so it picks
-- the column up automatically. Same stance as 0064's positions.
--
-- Additive only — never edits an applied migration.

alter table public.toast_menu_cache
  add column if not exists removed_at timestamptz;

comment on column public.toast_menu_cache.removed_at is
  'Set by toast-menu-sync (v11+) when a guid is absent from a NON-EMPTY Toast Menus V2 walk; '
  'null = present in Toast. Absent rows are also forced pos_visible=false, which is what '
  'actually removes them from every public surface. An empty/failed payload never prunes.';

-- Partial index: the only query shape is "show me what Toast dropped" (staff/ops), a handful
-- of rows out of ~320.
create index if not exists toast_menu_cache_removed_idx
  on public.toast_menu_cache (venue_id)
  where removed_at is not null;
