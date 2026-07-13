-- 0031 — CLUB RULES + menu group order (site-refinement-1, docs/14)
--
-- Two owner-driven venue_settings keys for the public website:
--
--   site_club_rules       — the house rules hand-lettered on the barroom wall,
--                           transcribed verbatim from the photo (IMG_4678) and
--                           owner-approved as brand voice. Rendered on /about,
--                           uppercased via CSS to match the wall (stored sentence
--                           case for a11y + editability). Array of strings.
--
--   site_menu_group_order — the section order for /menu. Listed groups render
--                           first, in this exact order; unlisted groups fall to
--                           the end alphabetically. Owner asked for cocktails
--                           first (2026-07-13); reordered again same day (19
--                           groups). "Winter Cocktails" is deliberately unlisted —
--                           it is POS-hidden in Toast (group visibility []), so the
--                           pos_visible gate (0034) keeps it off /menu regardless.
--                           Names are the exact `menu_group` strings in the live
--                           toast_menu_cache. Array of strings.
--
-- THREE-WAY INVARIANT: each array is byte-identical across (1) this seed, (2) the
-- FALLBACK in the consuming hook (site_club_rules → useSiteCopy.ts FALLBACK;
-- site_menu_group_order → useMenu.ts MENU_GROUP_ORDER_FALLBACK), and (3) the live
-- DB row. The fallback is also React Query placeholderData, so any drift reflows
-- the page and spikes CLS. Update all three together.
--
-- IDEMPOTENT + NON-DESTRUCTIVE: `on conflict do nothing` — never clobbers copy the
-- owner has since edited. venue_settings is already anon-readable via the 0011
-- `public_read` policy; no new surface, no new grant.

insert into public.venue_settings (venue_id, key, value) values

  -- Owner changed the wall 2026-07-13: candles → lamps, plus a NEW rule
  -- ("Don''t break or steal the lamps") inserted after the disfiguring rule → 8
  -- rules. The live row was edited directly; this seed + the useSiteCopy.ts
  -- FALLBACK are re-synced to byte-match it (three-way invariant above).
  ('11111111-1111-1111-1111-111111111111', 'site_club_rules',
   '[
     "Don''t start none, won''t be none",
     "Tipping makes you sexy",
     "Disfiguring the lamps will result in death!",
     "Don''t break or steal the lamps",
     "If you return empties to the bar, the staff will love you forever",
     "Waving cash at bar will not result in quicker service",
     "Anyone carrying two or more drinks has right-of-way",
     "If you are cut off, be happy we got you drunk in the first place"
   ]'::jsonb),

  ('11111111-1111-1111-1111-111111111111', 'site_menu_group_order',
   '[
     "Signature Cocktails",
     "Cocktail Features",
     "Mocktails",
     "Draft Beers",
     "Vodka",
     "Gin",
     "Rum",
     "Classics",
     "Shots",
     "N/A Beers",
     "Bottle / Cans",
     "Wine",
     "Whiskey / Bourbon / Rye",
     "Scotch",
     "Tequila",
     "Cordials",
     "Soft Drinks",
     "Food",
     "Merch"
   ]'::jsonb)

on conflict (venue_id, key) do nothing;
