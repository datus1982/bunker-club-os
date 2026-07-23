-- 0061_teams_name_partial_unique.sql
-- Team-name uniqueness must ignore ARCHIVED teams.
--
-- Motivation: the 2026-07-21 board-clear archived all 267 legacy teams
-- (27 regulars + 240 one-offs) so that every patron/host surface shows a clean
-- slate for the trivia cutover. But the original uniqueness — the table
-- constraint teams_venue_id_name_key = UNIQUE (venue_id, name) — counts
-- archived rows. So a host creating a returning regular's team tonight (e.g.
-- "Scampus Oktober", which still exists as an archived row) hits a
-- unique-violation surfaced as a cryptic error. The board-clear's intent was
-- that archived teams are FULLY out of the way, names included.
--
-- Fix: replace the full unique constraint with a PARTIAL unique index that
-- enforces one-active-team-per-name only among non-archived rows. A real active
-- duplicate still errors; archived teams no longer reserve their names, and
-- multiple archived rows may share a name (already true in the data — the
-- legacy import produced "Scampus Oktober (2)".."(6)").
--
-- Safe to build: verified against live data that there are ZERO currently-active
-- (archived=false) duplicate (venue_id, name) rows, so the partial index builds
-- without conflict (the old full constraint prevented active dups too).
--
-- teams_venue_id_name_key is a TABLE CONSTRAINT (pg_constraint contype='u'),
-- not a bare index, so it is dropped via ALTER TABLE ... DROP CONSTRAINT — which
-- also drops its backing index. No RLS changes, no data changes.

begin;

alter table public.teams
  drop constraint if exists teams_venue_id_name_key;

-- Defensive: if a bare index of the same name somehow survives (it shouldn't —
-- dropping the constraint drops its backing index), remove it before recreating.
drop index if exists public.teams_venue_id_name_key;

create unique index if not exists teams_venue_id_name_active_key
  on public.teams (venue_id, name)
  where archived = false;

commit;
