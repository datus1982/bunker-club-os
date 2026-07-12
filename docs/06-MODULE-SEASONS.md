# 06 — Module: Seasons / Tournaments

## Concept
Time-boxed competition windows ("Summer 2026 Wasteland Circuit"). Zero signup friction: any team that plays a game dated inside the window is automatically enrolled and ranked. Optionally culminates in a finals/playoff night for the top N.

## Admin (Stephen) — /admin/seasons
- Create season: name, start/end dates, scoring mode, params, playoff size. Overlap prevented by DB constraint (02).
- Season detail: live standings, games list, per-team drill-down.
- "Create finals night" action when season ends: creates a game flagged `is_playoff`, pre-checks-in top N teams, stamps `finals_game_id`.
- Complete season: locks standings, crowns champion (winner of finals game if playoff, else #1 standings).

## Scoring modes (all computed by ONE SQL function `season_leaderboard(season_id)` — 02)
- **cumulative** — sum all game points. Simple; punishes missed weeks.
- **placement** — points by finishing position per night (configurable array, e.g. 10/7/5/3/2/1). Keeps nights meaningful regardless of question difficulty variance.
- **best_n** — sum each team's best N nightly scores (e.g. best 8 of 12 weeks). RECOMMENDED DEFAULT: rewards showing up without punishing a vacation. Ties broken by: wins, then games_played (fewer = better), then head-to-head final round, then tiebreaker question at finals.

Playoff games (`is_playoff = true`) are EXCLUDED from standings math (they decide the champion directly).

## Surfaces
- **Trivia leaderboard display:** during an active season, a rotating panel/footer: "SEASON STANDINGS — TOP 5" cycling with tonight's scores. Terminal-theme marquee.
- **Portal (07):** team's rank, points breakdown per game, games remaining, "what do we need to make playoffs" (nice-to-have v2).
- **Check-in DONE screen:** rank teaser (05).
- **GameDisplay:** end-of-night slide after Game Over: "SEASON IMPACT — tonight moved you from #5 → #3."

## In-world flavor (copy/skin only, not logic)
Seasons render as "Campaigns." Rank tiers optionally labeled (New Recruit → Wasteland Legend) via a cosmetic mapping table in venue_settings. Keep ALL such strings in config so other venues (SaaS) can re-skin.
