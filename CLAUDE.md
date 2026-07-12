# Bunker Club OS

Venue platform for Bunker Club (OKC). Docs in `/docs` are authoritative — read 00, 01, 02 before any work. Read a module doc when its phase begins; open the matching mockup in `/docs` when building its module.

## Current state

**Phase: 0 (Foundation) — ✅ COMPLETE. All docs/10 acceptance gates pass. Docs-reconciliation (docs/14 + updated docs/09 Toast section) done. Phase 1 (trivia port) ready to begin.**
Live modules: none yet (app deployed, screens not repointed). Legacy (OptiDev) still serving production Wednesday trivia — do NOT write to it; cutover is a deliberate later act (docs/03).

**Route map (docs/14 change, applied):** public website owns the root — `/`, `/menu`, `/events`, `/trivia`, `/visit`, `/about` (Phase 3.5 placeholders in `modules/website/`, no auth). Internal dashboard moved to `/dashboard` (staff+). Verified in-browser: `/` renders public HOME with no gate; `/dashboard` redirects unauth → checkin.

### ▶ Next session — START HERE
1. Auto-loaded: this file. Then read docs/00, 01, 02 (authoritative) + docs/04 (Phase 1 spec).
2. **Phase 1 = trivia port (docs/04).** Branch `phase-1-trivia` off `main`. Order: read-only display pages first — **Leaderboard → GameDisplay → History** — then GameSetup/QuestionEntry/BulkImport/VideoEntry, **Scoring decomposition LAST** (highest regression risk; use the docs/04 parity checklist).
3. Branch `phase-1-trivia` is CREATED and checked out. Step 1 (shared client + theme) was already satisfied by Phase 0. **DONE this session:** `game_scoreboard(game_id)` SQL fn (docs/04 QUAL-4) — migration `0016_game_scoreboard.sql`, applied + verified (wildcard ×2 doubling matches legacy Leaderboard.tsx:270-309; hand-checked totals; anon RPC returns safe cols only, no PII). **NEXT:** port `Leaderboard.tsx` to render a real game's standings through `DisplayCanvas` consuming `game_scoreboard` via **realtime** (NOT 5s polling — ARCH-1). Legacy source unzipped to session scratchpad `legacy/trivia-scoreboard-32575-main/` (re-unzip `trivia-scoreboard-32575-main.zip` if gone) → `src/pages/Leaderboard.tsx` (1056 lines), `GameDisplay.tsx`, `History.tsx`. Port fixes: ARCH-1 (realtime), PERF-1 (no flicker on displays), QUAL-1 (strip console.log).
4. Real data is already in the DB — test the ported Leaderboard against game `bb00eca3-86a7-4393-b745-2bc3d3cad42e` (2026-03-18, 17 teams, wildcards + tiebreakers exercised).

### Operational notes a fresh session can't see
- **Secrets** live in `.env` + `apps/web/.env` (both gitignored, NOT in git): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` (migration PAT — may be revoked by owner; regenerate at supabase.com/dashboard/account/tokens), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID=838f6b1ba6d8bf9cc45185679950151b`, `LEGACY_SUPABASE_*` (read-only). Owned project ref: `ysrqvdutayirpoibdlbf`. Venue id: `11111111-1111-1111-1111-111111111111`.
- **Apply migrations:** no Supabase CLI installed — POST each file to `https://api.supabase.com/v1/projects/ysrqvdutayirpoibdlbf/database/query` with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`. Reusable pattern in prior scratchpad `apply-migrations.mjs` (session-local; re-create if gone).
- **Deploy:** `npm --prefix apps/web run build` then `npx wrangler pages deploy apps/web/dist --project-name=bunker-club-os --branch=main` (needs `CLOUDFLARE_*` in env). Manual until GitHub→Pages auto-deploy is wired.
- **Package manager:** repo standard is pnpm, but this env used `npm install` (no pnpm/corepack offline); no lockfile committed. `apps/web` deps install standalone.
- **Legacy zips** are in repo root; re-unzip to inspect (scratchpad extractions are session-local).
- **Dev server:** `npm --prefix apps/web run dev` (or preview_start "web"). Not running across sessions.
- **Owner cleanup pending:** delete `bunker-club-os-scratch` project; revoke migration + Cloudflare tokens; reset the DB password that appeared in a log.

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
