# 14 — Module: Public Website (bunkeokc.com) — Phase 3.5

## Concept
The venue's public marketing site, served by the same app, replacing the current paid auto-built webhost. Nearly all content is read-views over data the OS already maintains: live menu (toast_menu_cache), events/promotions (signage_items + scheduled_events with a publish flag), trivia/seasons (public standings). Canceling the old webhost offsets platform costs. Domain per owner: bunkeokc.com (VERIFY exact spelling/registrar with owner before DNS work).

## Routes (public site owns the root; internal dashboard moves to /dashboard)
| Route | Content |
|---|---|
| `/` | Home: hero, tonight/this-week strip (auto: trivia day, active promos, next event), hours, CTA to menu |
| `/menu` | Live menu from toast_menu_cache: public menu groups only, public blurb rule (text before `---` only), price, out_of_stock items hidden (or 'gone for now' badge), optional item photos (viewport treatment, restrained) |
| `/events` | Upcoming: scheduled_events + signage event/celebration items where show_on_website=true; weekly trivia standing block |
| `/trivia` | Atomic Pub Trivia marketing + PUBLIC current-season standings (season_leaderboard fn) + 'how it works' + check-in explainer |
| `/visit` | Hours, address, embedded map, parking notes, contact, socials |
| `/about` | The bar's story; venue_settings-driven copy |
ROUTE MAP CHANGE (updates 01): `/` dashboard → `/dashboard` (staff+). /checkin, /portal, display routes unchanged. Public QR URLs become bunkeokc.com/checkin etc.

## Data & flags
- `signage_items.show_on_website boolean default false` — one toggle publishes a screen promo/event/celebration to the site. Staff flow unchanged otherwise.
- `scheduled_events.show_on_website boolean default false` (tease copy only; no stage internals).
- Public-safe SQL views: `public_menu` (group, name, public_blurb [split on ---], price, image, in_stock), `public_events`. RLS: anon SELECT on views only — never raw description column.
- Site copy (hero text, about, hours, socials, parking) in venue_settings; editable via a simple admin form (staff role) in v1.1; seeded config in v1.

## Design
Same universe, marketing restraint: amber-warm palette, terminal type for headers (VT323 sparingly at large sizes), Share Tech Mono accents, body text in a highly readable stack; Civil Defense motifs as garnish not chrome. NO scanline overlays on body content, no boot transitions — a website, not a display. Mobile-first (bar traffic is phones). Lighthouse targets: 90+ performance/SEO/accessibility on mobile.

## SEO & launch checklist
- Per-route title/meta/OG (+ og:image per page); canonical tags; sitemap.xml + robots.txt.
- LocalBusiness (BarOrPub) JSON-LD: name, geo, address, hours, menu URL, sameAs socials.
- 301s from any known old-site URLs (inventory the current site's pages before cutover).
- Update Google Business Profile website link + menu link post-launch.
- **DNS migration procedure:** (1) inventory current DNS — ESPECIALLY MX/email and any subdomains on the old host; (2) point apex + www at new hosting, leave MX untouched; (3) parallel-verify old site still reachable via host preview URL; (4) confirm email flow; (5) cancel old webhost only after 2 clean weeks.

## Sequencing note
This phase PULLS toast-menu-sync FORWARD from Phase 5 (doc 09) — the sync ships here; Phase 5 then consumes it. If Phase 5 somehow lands first, the dependency inverts harmlessly.
