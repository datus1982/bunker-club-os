# 10 — Build Plan & Execution Guide for Opus

## How to work this plan (read first)

- Work phases in order; each has acceptance criteria. Do not start a phase until the previous one's criteria pass (Phase 3 may run parallel to Phase 2 — no shared surface).
- Every phase = its own branch + PR, even solo — the PR description is the changelog.
- After each phase, update the repo CLAUDE.md "current state" section.
- When a spec is ambiguous, prefer: (1) match existing OptiDev behavior, (2) the simpler option, (3) leave a `// DECISION:` comment and note it in the PR. Do not invent features.
- Wednesday is sacred (03). Nothing in these phases touches the live OptiDev system.

## Phase 0 — Foundation (est. 1 session)
- New Supabase project (owner creates, provides URL + anon key + service key as env/secrets).
- Repo `bunker-club-os` scaffolded per 01 layout; Vite app boots with terminal theme applied; Vercel connected, SPA rewrites configured.
- ALL migrations from 02 written and applied (including seasons — schema now, feature later). Seed: 1 venue row, venue_staff rows for Stephen (admin) + Ronnie (host).
- Legacy export executed per 03 (path A or B per owner's answer); `scripts/import-legacy.ts` written, run, row counts verified old vs new.
**Accept:** app deploys ON THE OWNER'S CUSTOM DOMAIN; Supabase Pro tier active; backup script runs and a restore into a scratch project succeeds (doc 12); `select count(*)` matches legacy for teams/games/rounds/scores/questions; storage objects present.

## Phase 1 — Trivia port (est. 3–5 sessions; the big one)
Port per 04. Order within phase: shared client/theme → read-only pages (History, Leaderboard, GameDisplay) → GameSetup/QuestionEntry/VideoEntry/BulkImport → Scoring decomposition LAST (highest risk, do with parity checklist open). Edge functions parse-powerpoint + analyze-image deployed w/ owner's GEMINI_API_KEY.
**Accept:** 04 parity checklist 100% on a fake game; RLS applied (anon writes rejected — test explicitly); no console noise; no 5s polling anywhere; host + staff runbooks generated per doc 12; /leaderboard and /game-display render via DisplayCanvas and look proportionally identical in a 1080p and a 4K browser window; ?calibrate mode works.

## Phase 2 — Registration v2 + Auth (est. 2–3 sessions)
Per 05. Supabase email OTP; profiles trigger; team_members; check_in_team RPC; verify-team-pin fn; /checkin flow; host walk-up check-in in Scoring; real QR component; legacy contact_email → invited profiles mapping.
**Accept:** new player scan→registered→checked-in <60s on a phone; returning device = 1 tap; PIN join works; PIN unreadable via API (test with anon key + curl); host can check in a phoneless team.

## Phase 3 — Drinks leaderboard port (est. 1–2 sessions, parallelizable with Phase 2)
Per 08: scheduled toast-sync writing sales_cache (option b), secrets moved, TZ fix, /drinks reads table via realtime.
**Accept:** 08 parity checklist; simulate 11:30pm CDT date handling in a test.

## Phase 3.5 — Public Website (est. 2 sessions)
Per 14. Pulls toast-menu-sync forward from Phase 5. Public routes at root (dashboard moves to /dashboard), public_menu/public_events views + RLS, show_on_website flags, SEO checklist, DNS migration per doc 14 (email/MX inventory FIRST; old webhost canceled only after 2 clean weeks).
**Accept:** menu page reflects a Toast menu edit within sync cadence; 86ing an item hides it; a screen promo with show_on_website=true appears on /events; Lighthouse mobile ≥90 perf/SEO/a11y; LocalBusiness JSON-LD validates; site live on the real domain with email confirmed unaffected.

## Phase 4 — Seasons + Portal (est. 2–3 sessions)
Per 06 + 07: season_leaderboard function w/ 3 modes + unit tests (SQL tests via pgTAP or a seed-and-assert script); admin/seasons; portal pages; leaderboard season panel; check-in rank teaser.
**Accept:** seeded 3-team 4-game season produces hand-verified standings in ALL modes; portal renders history correctly on mobile viewport; finals-night creation pre-checks-in top N.

## Phase 5 — Signage templater + screen OS (est. 2–3 sessions)
Per 09 (updated: self-scheduling slots, chrome, color-state system, takeovers, heartbeat, Toast-sourced content incl. toast-menu-sync fn, ★ SCREENS toggle group, description safety rule).
**Accept:** staff creates a drink special from a phone photo in <2 min (viewport treatment default); staff creates a birthday celebration with a 10 PM shout-out in <60s and the takeover fires on schedule then auto-resumes; an annually-recurring holiday item re-arms after completion; slot self-switches to live-game mode when a test game activates, with green re-theme + boot transition, and reverts on completion; takeover broadcast reaches two physical screens <2s; heartbeat shows a screen offline within 3 min of unplugging it; pilot on ONE physical screen's built-in browser for a full week before repointing the rest; every physical screen calibrated once via ?calibrate (edges visible, text crisp, inset recorded).

## Phase 6 — Solo Play-Along (est. 2 sessions)
Per 11. Anonymous auth entry, answer-slip phone page gated by game_display_state, grading function, solo scoreboard.
**Accept:** simulated game: submissions lock instantly on answer reveal (test server-side, not just UI); fuzzy grading passes a 20-case test list (typos, articles, punctuation); host can remove a rude display name from /scoring.

## Phase 7 — Scheduled Event Choreography (est. 2 sessions)
Per 13. Stage engine (derived from timestamps), launch + infestation skins, live counter via toast-sync event filter, FIRE NOW / ABORT controls, resolver priority integration.
**Accept:** a test event runs the full arc unattended on two screens (tease ticker → alert countdown → moment → window w/ counter incrementing from a test order → all-clear tally); ABORT drops all screens to normal <2s; event scheduled during a live game with interrupt_game=false stays ticker-only.

## Cutover (after 1 + 2 minimum; 3 whenever ready)
Parallel-run Wednesday per 03 → repoint OptiSigns → new QR on tables → monitor → decommission OptiDev after 30 days.

## Standing risks
- **Realtime on bar wifi:** the fallback poll (30–60s) is the safety net; test displays on the actual venue network before cutover.
- **Toast API quotas:** scheduled sync at 60s intervals only during operating hours (pg_cron schedule), not 24/7.
- **PowerPoint variance:** Ronnie's decks are the spec — test bulk import with 2–3 real ones.
- **Scoring decomposition regressions:** parity checklist is the gate; when in doubt, diff behavior against the running OptiDev app side by side.

## Repo CLAUDE.md (create at Phase 0 with this skeleton)
```md
# Bunker Club OS
Venue platform for Bunker Club (OKC). Docs in /docs are authoritative — read 00, 01, 02 before any work.
## Current state
Phase: 0 | Live modules: none | Legacy (OptiDev) still serving production.
## Commands
pnpm dev / pnpm build / pnpm typecheck / supabase db push / supabase functions deploy <name>
## Rules
- No OptiDev code patterns (gateway client, window.__ENV__).
- Displays: no infinite animations, no sub-30s polling, realtime-first.
- All season scoring logic lives ONLY in season_leaderboard() SQL.
- Venue-scope everything; no hardcoded 'Bunker Club' in logic.
- Update this file's Current state after each phase.
```
