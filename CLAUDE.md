# Bunker Club OS

Venue platform for Bunker Club (OKC). Docs in `/docs` are authoritative — read 00, 01, 02 before any work. Read a module doc when its phase begins; open the matching mockup in `/docs` when building its module.

## Current state

**Phase: 1 (Trivia port) — IN PROGRESS, ~90% done. Everything ported + verified EXCEPT the Scoring console (the one remaining item). Branch `phase-1-trivia` (10 commits, pushed).**
Live modules: none yet (app deployed, screens not repointed). Legacy (OptiDev) still serving production Wednesday trivia — do NOT write to it; cutover is a deliberate later act (docs/03).

**Phase 1 — done + verified (all pushed to `phase-1-trivia`):** migrations 0015 (public website), 0016 `game_scoreboard(game_id)` (QUAL-4, wildcard ×2), 0017 (storage write policies). Displays (realtime, `DisplayCanvas`, `?calibrate`, no 5s polling): `Leaderboard.tsx` (portrait) + `GameDisplay.tsx` (landscape) + `VideoPlayer.tsx`. Host tools (all verified end-to-end as an authenticated host): `History.tsx`, `GameSetup.tsx`, `QuestionEntry.tsx`, `VideoEntry.tsx`, `BulkImport.tsx`. Minimal staff `Login.tsx` (`/login`, email+password). `analyze-image` edge fn DEPLOYED + Gemini-tested on the real deck. RLS gate proven (anon writes → 401). Shared: `shared/log.ts` (DEV-gated). Deps added: `qrcode.react`, `jszip`. Fixes applied: ARCH-1, QUAL-1/4, PERF-1 (see commit log for the rest).

**Route map (docs/14 change, applied):** public website owns the root — `/`, `/menu`, `/events`, `/trivia`, `/visit`, `/about` (Phase 3.5 placeholders in `modules/website/`, no auth). Internal dashboard moved to `/dashboard` (staff+). Verified in-browser: `/` renders public HOME with no gate; `/dashboard` redirects unauth → checkin.

### ▶ Next session — START HERE
1. Auto-loaded: this file. `git checkout phase-1-trivia` (10 commits, all pushed). Read docs/04 (Phase 1 spec) — esp. the ARCH-2 decomposition + the parity checklist. Skim the ported files under `apps/web/src/modules/trivia/` to see the established patterns (terminal-theme inline styles, one-realtime-channel hooks, `shared/log.ts`).
2. **THE ONE REMAINING TASK: port `Scoring.tsx`** (legacy `src/pages/Scoring.tsx`, 3285 lines — the live scoring console at `/scoring`, host+). This is the highest-regression-risk work (docs/04 ARCH-2). Decompose into `RoundGrid` / `QuestionPanel` (wraps `QuestionDisplay`) / `VideoControls` / `LeaderboardToggle` / `TeamEditorDialog` + hooks `useActiveGame` / `useGameScores` / `useDisplayState`. **Behavior-identical — structure only.** It drives `game_display_state` (question nav, show_answer, show_video, show_game_over) that the already-ported GameDisplay/Leaderboard render, and writes `scores`. Keep the docs/04 parity checklist open the whole time. Legacy source: re-unzip `trivia-scoreboard-32575-main.zip` if the scratchpad extraction is gone.
3. **Then close the Phase 1 GATE:** run the full docs/04 parity checklist end-to-end on a HOST-CREATED game (create → BulkImport Ronnie's deck → score a round → watch GameDisplay + Leaderboard sync → History), and generate the host+staff runbooks (docs/12). Anon-write RLS rejection is already ✅ tested (games insert → 401).
4. Deferred (not blockers): bonus-round badges on Leaderboard; History Load/Duplicate/Delete; the "Scoring in Progress" interstitial (no `rounds.scoring_in_progress` col); wiring Dashboard as a host landing page (host-tool nav is currently by direct URL only).

### Testing host tools (no full auth until Phase 2)
- **Sign in via `/login`** with the synthetic QA host account: `qa-host@bunker.test` (creds in gitignored `.env` as `QA_HOST_EMAIL`/`QA_HOST_PASSWORD`; `venue_staff` host role, profile `b5649f79-…`). Session persists in browser localStorage across dev-server restarts. **Owner cleanup: DELETE this QA account before production cutover.** Real seeded staff (stephentyler/trashtvronnie) have NO passwords — set one in Supabase dashboard → Auth → Users to log in as them.
- **Fixture pattern:** create test games via service-role SQL through the Management API (bypasses RLS) with a recognizable id like `fa11face-0000-4000-8000-0000000000NN`; DELETE when done. Real display test game: `bb00eca3-…-3cad42e` (2026-03-18, 17 teams, wildcards+tiebreakers). Default `/leaderboard` (no `?game=`) resolves to the highest-priority non-completed game (currently the real 2026-07-08 `active` import) — pass `?game=<id>` to pin one.
- **Edge fns** deploy via Management API multipart: `POST /v1/projects/{ref}/functions/deploy?slug=<name>` with `metadata` + `file` parts (see the `analyze-image` deploy in git history). Secrets via `POST /v1/projects/{ref}/secrets`.
- **`GEMINI_API_KEY`** is in root `.env` (gitignored) + set as an edge-fn secret. It was pasted in chat 2026-07-12 — owner may want to rotate it after Phase 1. Ronnie's real deck is at `docs/powerpoint 10903.pptx` (14MB, left UNTRACKED in git — don't commit without deciding).

### Operational notes a fresh session can't see
- **Secrets** live in `.env` + `apps/web/.env` (both gitignored, NOT in git): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` (migration PAT — may be revoked by owner; regenerate at supabase.com/dashboard/account/tokens), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID=838f6b1ba6d8bf9cc45185679950151b`, `LEGACY_SUPABASE_*` (read-only). Owned project ref: `ysrqvdutayirpoibdlbf`. Venue id: `11111111-1111-1111-1111-111111111111`.
- **Apply migrations:** no Supabase CLI installed — POST each file to `https://api.supabase.com/v1/projects/ysrqvdutayirpoibdlbf/database/query` with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`. Reusable pattern in prior scratchpad `apply-migrations.mjs` (session-local; re-create if gone).
- **Deploy:** `npm --prefix apps/web run build` then `npx wrangler pages deploy apps/web/dist --project-name=bunker-club-os --branch=main` (needs `CLOUDFLARE_*` in env). Manual until GitHub→Pages auto-deploy is wired.
- **Package manager:** repo standard is pnpm, but this env used `npm install` (no pnpm/corepack offline); no lockfile committed. `apps/web` deps install standalone.
- **Legacy zips** are in repo root; re-unzip to inspect (scratchpad extractions are session-local).
- **Dev server:** `npm --prefix apps/web run dev` (or preview_start "web"). Not running across sessions.
- **Owner cleanup pending:** delete `bunker-club-os-scratch` project; revoke migration + Cloudflare tokens; reset the DB password that appeared in a log; **delete the `qa-host@bunker.test` auth user (Phase 1 testing fixture)**; **rotate `GEMINI_API_KEY`** (pasted in chat 2026-07-12).

Phase 0 — completed work:
- Repo scaffolded per docs/01 (pnpm monorepo: `apps/web`, `packages/`, `supabase/`, `scripts/`). Git initialized.
- Vite + React 19 + TS(strict) + Tailwind 3 + Router v7 + TanStack Query v5 app shell. Boots with the terminal theme applied; full route map wired with role guards. Displays render through `DisplayCanvas` (fixed-canvas scale-to-fit + `?calibrate` + nightly 04:00 reload).
- Terminal theme moved to `apps/web/src/theme/terminal-theme.css`; third-party franchise wording stripped (principle 5); amber/blue color-state variants scaffolded.
- ALL migrations from docs/02 written (`supabase/migrations/0001–0015`), plus seasons, signage (calibration/recurrence/celebration), and events schema (docs/06/09/13). RLS default-deny with the public/player/staff split; `pin_hash` locked out of anon+authenticated (read AND write); `check_in_team` RPC; `season_leaderboard()` (3 modes). **APPLIED to the owned Supabase project (ref `ysrqvdutayirpoibdlbf`) via the Management API and verified: 18 tables all RLS-on, 36 policies, 5 views, realtime on 12 tables, seed venue present. Anon-key smoke test passed — public reads 200, anon writes + pin_hash reads rejected.**
- **Docs reconciliation (docs/14 public website + updated docs/09 Toast) — migration `0015_public_website.sql` written + APPLIED + verified:** `show_on_website` flag on `signage_items` + `scheduled_events`; public-safe views `public_menu` (blurb = text before `---` per docs/09 safety rule; excludes ★ SCREENS group; exposes in_stock) + `public_events` (tease copy only). Anon SELECT on `toast_menu_cache.description` REVOKED (column-level, mirrors pin_hash) — anon-key test confirms raw `description` → 401, `public_menu`/`public_events`/safe cols → 200. Toast write-access note logged for provisioning: menu STRUCTURE is read-only; only `stock:write` enables bidirectional featured control — request scopes `menus:read, config:read, orders:read, stock:read, stock:write`.
- `scripts/export-legacy.ts` (path B, read-only), `import-legacy.ts` (docs/03 mapping, idempotent, count-verified), `seed-staff.ts`, `backup.ts` (docs/12).
- **Legacy data EXPORTED + IMPORTED. Counts match legacy exactly: teams 265, games 27, rounds 220, scores 1826, questions 1525 (+ game_teams 247, game_display_state 24, venue_settings 49, storage: logos 4 + picture-rounds 31).** Notes: the raw project `cdgdxfichpikapawnnth.supabase.co` is directly readable with the publishable key (gateway bypassed). 22 duplicate team names disambiguated for `unique(venue_id,name)` (originals kept on `game_teams.display_name`); 23 team contacts saved to `legacy-export/unmapped-contacts.json` for Phase 2. Follow-ups for Stephen: 1 customer team name contains a franchise term ("Crawl out through the Fallout"); "Regulars" + that team have true-duplicate regular rows to merge.
- **App boots locally against the live DB; `tsc -b` clean; terminal theme + routing + DisplayCanvas (+`?calibrate`) verified in-browser.**
- **Staff seeded: stephentyler@mac.com (admin), trashtvronnie@gmail.com (host) — provisioned as confirmed auth users (no email sent) so roles are live before Phase 2 login.**
- **DEPLOYED to Cloudflare Pages: https://bunker-club-os.pages.dev (project `bunker-club-os`, auto-builds are NOT connected — deployed via wrangler from local `apps/web/dist`; env baked in at build). Prod smoke-test: deep-link `?calibrate` renders, queried live DB → 265 teams. Custom domain `os.bunkerokc.com` registered on the project; CNAME (os → bunker-club-os.pages.dev) added at Namecheap, propagating.**
- **Backups (docs/12): `backup.ts` runs password-free (service-key JSON of all 18 tables + storage) when `DATABASE_URL` unset, full `pg_dump` when set. Ran locally (4188 rows + 35 objects). Weekly GitHub Action `.github/workflows/backup.yml` proven green in CI; repo secrets SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set.**
- **RESTORE DRILL PASSED: rebuilt schema from migrations in a scratch project + loaded the backup; all checked table counts matched exactly (teams 265, games 27, rounds 220, scores 1826, questions 1525, …). Auth-dependent tables (profiles/venue_staff/team_members) are excluded from the JSON snapshot by design.**
- **Supabase Pro ACTIVE. Custom domain LIVE: https://os.bunkerokc.com serves the app over valid HTTPS (deep-links work).**

### Phase 0 acceptance (docs/10) — all pass
Custom domain ✅ · Supabase Pro ✅ · backup runs + restore drill ✅ · counts match legacy ✅ · storage present ✅.

Owner follow-ups (non-blocking): delete the `bunker-club-os-scratch` project; revoke the migration token (`sbp_…`) and optionally the Cloudflare token; reset the DB password that appeared in a log. Deploy is currently manual `wrangler` from `apps/web/dist` — wire GitHub→Pages auto-deploy (or a deploy workflow) when convenient.

## Commands

`pnpm dev` / `pnpm build` / `pnpm typecheck` · `supabase db push` · `supabase functions deploy <name>`
`pnpm export:legacy` · `pnpm import:legacy` · `pnpm seed:staff` · `pnpm backup`

## Rules

- No OptiDev code patterns (gateway client, `window.__ENV__`, `.optidev/` plugins).
- Displays: no infinite animations, no sub-30s polling, realtime-first (one 30–60s fallback poll).
- All season scoring logic lives ONLY in `season_leaderboard()` SQL.
- Venue-scope everything; no hardcoded 'Bunker Club' in logic (theme/config tables instead).
- Original in-world IP only (principle 5): Shelter Authority / BUNKER UNIFIED OS / Civil Defense. NO third-party franchise marks in any rendered output, generated copy, identifiers, or seed data — ever.
- Phases execute in order; acceptance criteria (docs/10) are gates. Each phase = its own branch + PR. When a spec is ambiguous: match legacy → simpler → leave a `// DECISION:` comment and note it in the PR.
- **Session handoff (do at the END of every working session, and after each phase):** update the "▶ Next session — START HERE" block + Current state to reflect reality, then `git commit` + `git push`. This file auto-loads next session — it IS the handoff. Keep the "Next session" block to the single most useful next action + any context not in the repo (running services, token state, cleanup owed).
- Durable owner facts/preferences go in the memory system (`memory/`), not here. Repo-derivable facts (schema, file layout, history) stay out of this file.
