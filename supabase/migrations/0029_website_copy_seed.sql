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
-- ── site_hero_sub + site_about REWRITTEN 2026-07-12 (Phase 3.5 task 3): copy is
--    CLAUDE-DRAFTED from sourced, verified history in docs/brand-archive-draft.md
--    (founders Hailey & Ian McDermid of The Pump Bar; opened April 2 2017 at Open
--    Streets OKC; "post war atomic era dive bar" concept; Tower Theater jewel-box
--    storefront w/ restored green Vitrolite glass; local artists Mind Bender Tattoo
--    + Fraidy Cat Signs / Tanner Fraidy; the founders' "ode" philosophy quoted
--    verbatim; 2023 handover; today's Atomic Pub Trivia + BUNKER UNIFIED OS screens).
--    ONLY facts flagged verified in the archive are used — nothing UNVERIFIED, no
--    invented detail. DRAFT for owner walkthrough review; edit freely.
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
      "Bunker Club opened April 2, 2017, on NW 23rd Street — its doors first swinging wide during Open Streets OKC. It was the work of Hailey and Ian McDermid, the couple behind The Pump Bar just up the block, who took a long-shuttered jewel-box storefront in the Tower Theater building and gave it new life. Its rare green Vitrolite glass, freshly restored, still catches the light out front.",
      "The idea, in Ian's words, was a post-war atomic-era dive bar — design elements and sounds borrowed from the Cold War, and most of it built by hand. Local artists gave the room its character: the painters at Mind Bender Tattoo, and the murals and hand-lettering of Tanner Fraidy at Fraidy Cat Signs. The result is warm and dim and lush rather than stark — an immersive place, and never a museum.",
      "The founders were always clear about what the theme meant. It was never politics; it was an affection for a moment in time. As they put it: \"It's an ode to the preparedness, it's an ode to the propaganda, it's an ode to the art, the fear of what's to come, the hope of a future, and what that inspired in the daily lives of people.\"",
      "In 2023 the Bunker passed to the crew who run it now, who restocked the bar and widened the calendar without losing the room's original spirit. Today the heart of the week is Wednesday — Atomic Pub Trivia, teams squaring off across the season on the BUNKER UNIFIED OS screens overhead. The lights are still low and the drinks still honest: an atomic age high-dive on 23rd, same as ever."
    ]$$::jsonb)

on conflict (venue_id, key) do nothing;
