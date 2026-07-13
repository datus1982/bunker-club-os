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
-- ── OWNER-CONFIRMED (2026-07-12): site_hours (4 PM–2 AM, 7 days) + site_socials
--    (@bunkerclubokc). Remaining PLACEHOLDER copy to replace before launch:
--     site_hero_title, site_hero_sub  → real tagline
--     site_address                     → verify suite/zip (433 NW 23rd St from Toast)
--     site_parking                     → real parking guidance
--     site_about                       → real bar story (invented flavor copy)

insert into public.venue_settings (venue_id, key, value) values

  ('11111111-1111-1111-1111-111111111111', 'site_hero_title',
   '"BUNKER CLUB"'::jsonb),

  ('11111111-1111-1111-1111-111111111111', 'site_hero_sub',
   '"A shelter for the thirsty on NW 23rd. Cold drinks, warm company, and Atomic Pub Trivia every Wednesday night."'::jsonb),

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

  ('11111111-1111-1111-1111-111111111111', 'site_parking',
   '"Street parking runs along NW 23rd and the side streets — free after hours. A public lot sits a short walk east. Ride-share drop-off is easiest right out front."'::jsonb),

  -- OWNER-CONFIRMED (2026-07-12): @bunkerclubokc across channels.
  ('11111111-1111-1111-1111-111111111111', 'site_socials',
   '{
      "instagram": "https://instagram.com/bunkerclubokc",
      "facebook": "https://facebook.com/bunkerclubokc",
      "tiktok": "https://tiktok.com/@bunkerclubokc"
    }'::jsonb),

  -- About: array of paragraph strings, rendered in order. PLACEHOLDER flavor copy.
  ('11111111-1111-1111-1111-111111111111', 'site_about',
   '[
      "Bunker Club is a neighborhood bar on NW 23rd Street in Oklahoma City — an easygoing shelter from whatever the day threw at you. We keep the lights low, the drinks honest, and the door open to regulars and first-timers alike.",
      "The heart of the week is Wednesday: Atomic Pub Trivia, where teams of regulars square off for bragging rights and a spot on the season leaderboard. Round up a crew, claim a table, and see how you stack up.",
      "Whether you are here for the trivia, a quiet drink at the bar, or a night out with friends, there is a seat for you. Come find your place in the Bunker."
    ]'::jsonb)

on conflict (venue_id, key) do nothing;
