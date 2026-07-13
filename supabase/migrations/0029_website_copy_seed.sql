-- 0029 — Public website copy seed (docs/14, Phase 3.5)
-- Seeds venue_settings rows that power the marketing site's static copy: hero,
-- hours, address, parking, socials, about. venue_settings is a (venue_id, key)
-- jsonb store already anon-readable via the 0011 `public_read` policy — the site
-- reads these keys directly; no new surface, no new grant.
--
-- IDEMPOTENT + NON-DESTRUCTIVE: `on conflict do nothing`. Re-running never
-- clobbers copy the owner has since edited (the v1.1 admin form / a manual edit).
-- Delete a row and re-run to reset it to the seed.
--
-- ── OWNER-CONFIRMED (2026-07-12): site_hours (4 PM–2 AM, 7 days), site_socials
--    (@bunkerclubokc), site_parking (lots south across the street + NW behind The
--    Rise). Remaining PLACEHOLDER copy to replace before launch:
--     site_hero_title                  → "BUNKER CLUB"
--     site_address                     → verify suite/zip (433 NW 23rd St from Toast)
--
-- ── site_hero_sub + site_about REWRITTEN 2026-07-12 (Phase 3.5 task 3), REVISED
--    2026-07-13 PER OWNER DIRECTION: founders/artists/Pump Bar names removed
--    (deliberate distance; some original art since removed), copy shifted from
--    what-it-was to what-it-is, with an explicit nod to the atomic-age pop-culture
--    lean ("fallout" only in its generic nuclear sense — NO third-party franchise
--    marks, principle 5). Retained verified facts: 2017 opening, Tower Theater
--    jewel-box storefront + green Vitrolite (docs/brand-archive-draft.md), the
--    original "ode" credo quoted verbatim (unattributed by name), owner-confirmed
--    hours + Wednesday 8 PM trivia.
--    NOTE: 0029 uses `on conflict do nothing`, so on a LIVE project that already
--    ran the old seed these new values were applied by a one-off UPDATE (kept in
--    sync with this file). A fresh rebuild seeds these values directly.

insert into public.venue_settings (venue_id, key, value) values

  ('11111111-1111-1111-1111-111111111111', 'site_hero_title',
   '"BUNKER CLUB"'::jsonb),

  ('11111111-1111-1111-1111-111111111111', 'site_hero_sub',
   '"An atomic age high-dive on NW 23rd — cold drinks, warm company, and Atomic Pub Trivia every Wednesday night."'::jsonb),

  -- Structured hours: per-day { open, close } in 24h "HH:MM"; null = CLOSED.
  -- OWNER-CONFIRMED (2026-07-12): 4 PM – 2 AM, seven days a week. Close is after
  -- midnight, so the site renderer / footer handle the past-midnight span.
  ('11111111-1111-1111-1111-111111111111', 'site_hours',
   '{
      "mon": { "open": "16:00", "close": "02:00" },
      "tue": { "open": "16:00", "close": "02:00" },
      "wed": { "open": "16:00", "close": "02:00" },
      "thu": { "open": "16:00", "close": "02:00" },
      "fri": { "open": "16:00", "close": "02:00" },
      "sat": { "open": "16:00", "close": "02:00" },
      "sun": { "open": "16:00", "close": "02:00" }
    }'::jsonb),

  ('11111111-1111-1111-1111-111111111111', 'site_address',
   '{
      "line1": "433 NW 23rd St",
      "city": "Oklahoma City",
      "state": "OK",
      "zip": "73103",
      "lat": 35.4926,
      "lng": -97.5227
    }'::jsonb),

  -- OWNER-CONFIRMED (2026-07-12): parking lots south across the street + northwest
  -- behind The Rise (the NW 23rd retail development). Kept byte-identical to the
  -- useSiteCopy FALLBACK. Applied to the live project by a one-off UPDATE (this seed
  -- uses `on conflict do nothing`, so it won't overwrite the existing live row on rerun).
  ('11111111-1111-1111-1111-111111111111', 'site_parking',
   '"Parking lots are just south across the street and to the northwest behind The Rise. Not sure where to land? Ask us and we''ll point you to the closest spot."'::jsonb),

  -- OWNER-CONFIRMED (2026-07-12): @bunkerclubokc across channels.
  ('11111111-1111-1111-1111-111111111111', 'site_socials',
   '{
      "instagram": "https://instagram.com/bunkerclubokc",
      "facebook": "https://facebook.com/bunkerclubokc",
      "tiktok": "https://tiktok.com/@bunkerclubokc"
    }'::jsonb),

  -- About: array of paragraph strings, rendered in order. CLAUDE-DRAFTED from the
  -- sourced history in docs/brand-archive-draft.md (see header note). Verified facts
  -- only; the ode line is quoted verbatim and attributed to the founders. DRAFT for
  -- owner walkthrough review.
  ('11111111-1111-1111-1111-111111111111', 'site_about',
   $$[
      "Bunker Club is an atomic age high-dive on NW 23rd — a Cold War fallout shelter of a bar tucked into a jewel-box storefront in the Tower Theater building, its rare green Vitrolite glass still catching the light out front. Inside it's warm, dim, and lush rather than stark: civil-defense signage, low light, and a proper drink while the end of the world stays safely out there.",
      "The room opened in 2017, built by hand as a post-war atomic-era dive — and built with a clear idea of what the theme meant. It was never politics; it was an affection for a moment in time. As the bar's original credo puts it: \"It's an ode to the preparedness, it's an ode to the propaganda, it's an ode to the art, the fear of what's to come, the hope of a future, and what that inspired in the daily lives of people.\"",
      "That ode keeps evolving. These days the Bunker leans into the pop culture the atomic age set off — the retro-future of blast doors and ray guns, duck-and-cover kitsch, the movies and games that turned fallout into a playground. Less time capsule, more clubhouse for everyone who grew up loving the bunker fantasy.",
      "It's still a neighborhood dive at heart: open 4 PM to 2 AM every single day, Atomic Pub Trivia every Wednesday at 8, and a bar that runs on its own screens — standings, specials, and the occasional all-screen birthday shout-out. The lights are low and the drinks are honest. The bunker's open."
    ]$$::jsonb)

on conflict (venue_id, key) do nothing;
