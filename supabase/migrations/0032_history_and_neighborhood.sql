-- 0032 — /history intro + neighborhood-events feed (site-refinement-1, docs/14)
--
-- Two owner-editable venue_settings keys powering the new Route 66 history page
-- and the /events "Around the Neighborhood" section. The bulk of /history copy is
-- EDITORIAL and hardcoded in History.tsx (versioned in git); only these two small
-- keys are DB overrides.
--
--   site_history_intro       — one lead sentence for /history, overridable without
--                              a deploy. String.
--
--   site_neighborhood_events — curated external Route 66 / Uptown highlights shown
--                              on /events. Array of {title, date, url, blurb}. Past
--                              dates auto-hide client-side (useNeighborhoodEvents).
--                              Seeded from the Oklahoma Route 66 Association's 2026
--                              centennial calendar (docs/route66-history-research.md
--                              §3). Dates are plain calendar dates (YYYY-MM-DD).
--
-- THREE-WAY INVARIANT: each value is byte-identical across (1) this seed, (2) the
-- FALLBACK in the consuming hook (site_history_intro → useSiteCopy.ts FALLBACK;
-- site_neighborhood_events → useNeighborhoodEvents.ts FALLBACK), and (3) the live
-- DB row. The fallback doubles as React Query placeholderData, so any drift reflows
-- the page and spikes CLS. Update all three together.
--
-- IDEMPOTENT + NON-DESTRUCTIVE: `on conflict do nothing` — never clobbers copy the
-- owner has since edited. venue_settings is already anon-readable via the 0011
-- `public_read` policy; no new surface, no new grant.

insert into public.venue_settings (venue_id, key, value) values

  ('11111111-1111-1111-1111-111111111111', 'site_history_intro',
   '"For fifty-three years — from 1926 to 1979 — the asphalt outside 433 NW 23rd Street was U.S. Route 66. Bunker Club didn''t invent this corner; it inherited it."'::jsonb),

  ('11111111-1111-1111-1111-111111111111', 'site_neighborhood_events',
   '[
     {
       "title": "Oklahoma Route 66 Muralfest",
       "date": "2026-07-18",
       "url": "https://oklahomaroute66.com/centennial",
       "blurb": "Statewide mural celebration for the Mother Road''s 100th year — new roadside art commissioned up and down the route."
     },
     {
       "title": "Route 66 Hall of Fame Induction",
       "date": "2026-07-25",
       "url": "https://oklahomaroute66.com/centennial",
       "blurb": "The annual induction ceremony in Clinton, honoring the people and places that made Oklahoma''s stretch of 66."
     },
     {
       "title": "Route 66 Centennial Day",
       "date": "2026-11-11",
       "url": "https://oklahomaroute66.com/centennial",
       "blurb": "One hundred years to the day since Route 66 was commissioned on November 11, 1926. Statewide celebrations mark the milestone."
     }
   ]'::jsonb)

on conflict (venue_id, key) do nothing;
