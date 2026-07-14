-- 0039_public_events_blurb.sql
--
-- Fix: public_events.blurb surfaced only fields->>'blurb', but the EVENTS & PROMOS
-- console (useEventsAdmin.buildFields) writes the body line under fields.body (and
-- mirrors it into fields.directive for MOMENTs) — never fields.blurb. So a
-- console-created, website-flagged event surfaced on the site title-only, with no
-- tease copy. Read the first present of blurb / body / directive instead.
--
-- CREATE OR REPLACE (the view is NOT dropped) so existing grants are preserved
-- byte-for-byte: SELECT only for anon + authenticated, no write grants (PR #13
-- hardening). Every other column, the WHERE clause, and the tease-copy-only
-- character are unchanged from 0015 — only the blurb expression differs.

create or replace view public_events as
  select
    id,
    venue_id,
    name,
    skin,
    fire_at,
    fields ->> 'title'  as title,
    coalesce(fields ->> 'blurb', fields ->> 'body', fields ->> 'directive') as blurb
  from scheduled_events
  where show_on_website = true
    and status = any (array['scheduled', 'running']);
