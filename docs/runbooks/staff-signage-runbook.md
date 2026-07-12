# Staff Runbook — Screens & Signage

*Audience: floor staff. One page. Everything is on `os.bunkerokc.com`.*
*Phase 1 note: trivia displays are live now. The signage templater (specials, takeovers) lands in Phase 3 — the sections marked **(Phase 3)** are here so this page is ready, but those controls may not be wired yet.*

## Signing in

- `os.bunkerokc.com/login` with your staff email + password. You stay signed in on that device.
- Staff can view the dashboard and screens; hosts also run trivia scoring; admins manage teams/seasons/settings.

## The screens (what each TV shows)

| TV | URL | What it is |
|----|-----|-----------|
| Big landscape | `/game-display` | Trivia questions / answers / picture rounds / videos (driven by the host) |
| Standings | `/leaderboard` | Live team standings + the "scan to join" QR |
| Drinks board | `/drinks` | Top-selling drinks board |
| Signage slot | `/signage/s/<slug>` | A signage screen **(Phase 3)** |

All screens run themselves and **reload nightly at ~4 AM**. There is nothing to click on a screen.

## Everyday tasks

- **"A screen looks frozen / stuck / wrong."** Refresh that TV's browser (or power-cycle the TV). It reconnects and catches up on its own — you can't break anything by refreshing.
- **A screen is cropped or off-center.** Set the TV's picture mode to **Just Scan / 1:1 / Screen Fit** (not "16:9 zoom"), then reload. If it's still off, add `?calibrate` to that screen's URL and follow the on-screen insets (see the Screen Install Checklist).
- **Someone wants to join trivia.** Point them at the **SCAN TO JOIN** QR on the standings TV, or `os.bunkerokc.com/checkin`.

## Specials & takeovers **(Phase 3)**

- Create a special from your phone in the signage admin, toggle the **★ SCREENS** quick-edit to feature it, and send a takeover broadcast to push it to every screen for a set time. These controls arrive with the signage module.

## Escalation

- Trivia scoring problem during a game → hand it to the host (they drive `/scoring`).
- A screen won't recover after a refresh + power cycle → note which screen (its URL) and flag the admin; the dashboard shows each screen's last-seen heartbeat.
