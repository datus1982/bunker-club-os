# 07 — Module: Player Portal (/portal)

Authenticated (player OTP session — same identity as check-in). Mobile-first; players will only ever open this on phones. Terminal theme, but readability > gimmick (limit glow on body text).

## Pages
- **/portal** (home): my teams (cards: name, logo, member count, current-season rank badge). If checked in tonight: live "tonight" card with current score/place, links to /leaderboard view.
- **/portal/team/:id**: 
  - Header: name, logo, season rank + points.
  - Members: list; add by email/phone (invite), remove (captain), captain transfer, team PIN set/reset (captain; writes via edge fn).
  - History: table of games played — date, points, place that night, season it counted toward. From `game_results` CTE exposed as a view.
  - Season section: standings position, per-game points sparkline (recharts — already a dependency), streak badge ("6-week streak").
- **/portal/profile**: display name, email/phone, marketing opt-in toggle (this is the bar's mailing-list gold — default OFF, honest copy).

## Notes
- Read models: everything via the standings function + a `team_history(team_id)` view; no client-side aggregation.
- Empty states matter: new player with no teams → funnel to /checkin.
- No notifications system v1. "Pending join approvals" (05) shows as a badge on team page when captain visits.
- Public share teaser (v2, optional): read-only `/s/:teamSlug` card for social bragging.

## Design decisions (validated via mockup — see portal-mockup.html)
- **Color state:** amber base (personal/ambient surface); ALL live values render green per the system color language — season rank during an active game, and especially the Tonight card (live score, current place, gap to leader, pulsing LIVE pill) which appears on /portal home only while the team is checked into an active game.
- **Navigation:** two-tab bottom bar (TEAMS / PROFILE); team detail is a drill-in from the team card with a back link. No hamburger, no deep nav.
- **Team dossier layout:** rank/points/wins stat row → streak badge → strategic context line ("best 8 of 13 — 2 more scores can still improve your total; #2 is 11 pts ahead") → per-game sparkline (latest point green) → roster (captain tag, pending-join approvals inline with green WANTS TO JOIN tag) → PIN reset row → history table with a COUNTS? column showing which nights make the best-N cut.
- **History COUNTS? column** is the best_n mode made legible — players see exactly which nights are in their top-8.
- **Profile privacy copy** is explicit and plain: what's stored, honest opt-in framing, deletion on request. Marketing opt-in default OFF.
- Check-in funnel: "+ Start or join another team" routes to /checkin.
