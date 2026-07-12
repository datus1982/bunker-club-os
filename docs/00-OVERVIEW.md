# BUNKER CLUB OS — Master Plan

**Owner:** Stephen (Bunker Club, OKC)
**Executor:** Claude Opus via Claude Code
**Companion docs:** Read in numeric order. Each module doc is self-contained enough to execute, but 01 (Architecture) and 02 (Data Model) are prerequisites for everything.

## What this is

A self-hosted platform consolidating all of Bunker Club's interactive/digital systems under one roof, replacing two apps currently trapped in OptiDev (a third-party Claude-agent platform wrapping Supabase behind a proprietary gateway). The bar is atomic-era themed, leaning into a atomic-era retro-terminal aesthetic (fictional shelter-corporation styling, phosphor CRT). Every screen in the venue should feel like it runs on one fictional terminal OS.

## Modules (build order)

| # | Module | Status | Phase |
|---|--------|--------|-------|
| 1 | Atomic Pub Trivia (host tools, game display, trivia leaderboard) | Port from OptiDev + fixes | 1 |
| 2 | Team Registration v2 + Auth (OTP, members, check-in) | New | 2 |
| 3 | Top-Selling Drinks Leaderboard (Toast POS) | Port from OptiDev + fixes | 3 |
| 4 | Seasons / Tournaments + Player Portal | New | 4 |
| 5 | Shelter-Terminal Signage Templater (ad templates for OptiSigns) | New | 5 |
| 6 | Solo Play-Along (bar patrons answer on phones, parallel to team game) | New | 6 |
| 7 | Scheduled Event Choreography (midnight launches, infestation alerts, live sales counter) | New | 7 |
| 8 | Public Website (bunkeokc.com: home, live menu, events, trivia standings, visit) | New | 3.5 |
| 9 | Video curation / future modules | Backlog | 8+ |

## Non-negotiable principles

1. **Own everything.** Own Supabase project, own GitHub repos, Vercel deployment. No OptiDev dependencies survive the migration.
2. **Design for seasons + multi-venue NOW, build later.** `venue_id` on all top-level tables (single row: Bunker Club). Seasons schema ships in Phase 1 migrations even though the feature ships Phase 4.
3. **Don't break Wednesday.** Trivia runs every Wednesday with host Ronnie Meyer. The OptiDev system stays live until the new system has parallel-run one full trivia night successfully. Cutover is a deliberate act, not a side effect.
4. **Displays are dumb; the OS is smart.** Screens are kiosk browsers pointed permanently at one slot URL each; the page self-schedules (takeover > live game > signage rotation). OptiSigns is phased out entirely (screens have built-in browsers).
5. **Original in-world IP only.** The aesthetic is atomic-era retro-terminal (a style, freely usable); the fiction is Bunker Club's OWN: the Shelter Authority, BUNKER UNIFIED OS, Civil Defense motifs. NO third-party marks (Vault-Tec, RobCo, Pip-Boy, Nuka, Vault Boy, Brotherhood, etc.) may appear in any rendered output, generated copy, code identifiers, or seed data — important for the venue's commercial use and non-negotiable for any future SaaS distribution. Physical licensed merch displayed in the bar is unrelated to this rule.
6. **One aesthetic.** The fallout-terminal theme (already written — see 01) is the shared design system for every module.

## Prior art being replaced

- `trivia-scoreboard-32575` (OptiDev) — full audit and fix list in 04.
- `top-selling-drinks-19180` (OptiDev) — full audit and fix list in 08.
- Both are React 19 + Vite + TS + Tailwind + shadcn/ui + Supabase. High code reuse expected; this is a port-and-fix, not a rewrite, except registration (redesigned, see 05).

## The SaaS inkling (context only — do not build)

Long-shot future: sell this to other trivia nights/venues around OKC. Implications honored now: venue scoping in schema + RLS, no hardcoded "Bunker Club" strings in logic (theme/config tables instead), auth roles designed per-venue. Nothing else. No billing, no onboarding, no tenant admin UI.
