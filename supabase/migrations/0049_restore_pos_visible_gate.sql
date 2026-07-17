-- 0049 — restore the POS-visibility gate on public_menu (+ anon/auth grant strip)
--
-- ── WARN-1: the pos_visible gate went missing (regression story) ──────────────
-- 0034 added the owner's POS-visibility gate to public_menu: `... and pos_visible`
-- in the WHERE, enforcing the ratified principle (PR #11, owner verbatim) — "never
-- advertise anything not active on the POS view." A POS-hidden group (e.g. the 10
-- "Winter Cocktails" items the owner hid in Toast) must never reach the public menu.
--
-- 0040 (the blurb double-filter fix) recreated public_menu to expose the sanitized
-- cache text directly — but CREATE OR REPLACE rewrote the WHOLE view body and the
-- recreation ACCIDENTALLY DROPPED the `and pos_visible` clause. From 0040 onward the
-- gate was gone: POS-hidden rows became view-reachable again.
-- 0048 (long-form blurb) copied 0040's view shape verbatim and so PERPETUATED the
-- omission. Net live consequence caught in this branch's review: the 10 POS-hidden
-- Winter Cocktails rows are reachable through public_menu and showing on the website
-- menu — exactly the thing the owner principle forbids.
--
-- 0049 restores the gate: the view is byte-identical to 0048's body EXCEPT the WHERE
-- regains `and pos_visible`. long_blurb (0048) and the short public_blurb (0040) are
-- otherwise untouched. Additive; never edits an applied migration.
--
-- ── NOTE-3: strip anon/authenticated default-privilege residue on the cache ──────
-- Live grant dump (2026-07-16) shows anon holds table-level INSERT/UPDATE/DELETE/
-- TRUNCATE/REFERENCES/TRIGGER and authenticated holds the same PLUS its legitimate
-- table-wide SELECT (0011). toast_menu_cache has EXACTLY ONE RLS policy — public_read
-- (SELECT, anon+authenticated); there is NO write policy for either role. The cache
-- is written ONLY by the service-role toast-menu-sync edge fn (bypasses RLS), so every
-- non-SELECT grant on both roles is pure default-privilege residue: RLS already denies
-- the writes, but the house pattern removes the grant itself. NOTE-3 named INSERT/
-- UPDATE/REFERENCES; the live dump revealed DELETE/TRUNCATE/TRIGGER are equally residue,
-- so the full non-SELECT set is stripped from both roles. SELECT is preserved:
-- authenticated keeps its table-wide SELECT; anon keeps its column-level SELECT grants
-- on pos_visible (0034) and long_blurb (0048), which are separate and unaffected.

-- ── public_menu — restore the POS-visibility gate ────────────────────────────
-- Recreated per 0048's shape EXACTLY (short public_blurb + appended long_blurb, no
-- delimiter re-parse — the write-side sync is the single enforcement point), with the
-- ONLY change being the WHERE regaining `and pos_visible` from 0034. Column list/order
-- preserved so CREATE OR REPLACE keeps the relation grants.
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
  where coalesce(menu_group, '') <> '★ SCREENS'
    and pos_visible;

-- Re-assert the anon/authenticated SELECT grant (relation-level) and strip the
-- TRIGGER-privilege residue CREATE OR REPLACE can resurrect (0040 NOTE-2 house
-- pattern — public views hold SELECT only).
grant select on public.public_menu to anon, authenticated;
revoke trigger on public.public_menu from public, anon, authenticated;

-- ── NOTE-3 — strip the toast_menu_cache non-SELECT residue from anon + auth ──────
-- Keeps authenticated's table-wide SELECT and anon's column-level SELECTs; removes
-- every write/DDL grant (all residue — no write policy exists; service-role writes).
revoke insert, update, delete, truncate, references, trigger
  on public.toast_menu_cache from anon, authenticated;
