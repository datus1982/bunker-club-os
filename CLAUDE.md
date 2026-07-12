# Bunker Club OS

Venue platform for Bunker Club (OKC). Docs in `/docs` are authoritative — read 00, 01, 02 before any work. Read a module doc when its phase begins; open the matching mockup in `/docs` when building its module.

## Current state

**Phase: 0 (Foundation) — ✅ COMPLETE. All docs/10 acceptance gates pass. Phase 1 (trivia port) ready to begin.**
Live modules: none yet (app deployed, screens not repointed). Legacy (OptiDev) still serving production Wednesday trivia — do NOT write to it; cutover is a deliberate later act (docs/03).

Done this session:
- Repo scaffolded per docs/01 (pnpm monorepo: `apps/web`, `packages/`, `supabase/`, `scripts/`). Git initialized.
- Vite + React 19 + TS(strict) + Tailwind 3 + Router v7 + TanStack Query v5 app shell. Boots with the terminal theme applied; full route map wired with role guards. Displays render through `DisplayCanvas` (fixed-canvas scale-to-fit + `?calibrate` + nightly 04:00 reload).
- Terminal theme moved to `apps/web/src/theme/terminal-theme.css`; third-party franchise wording stripped (principle 5); amber/blue color-state variants scaffolded.
- ALL migrations from docs/02 written (`supabase/migrations/0001–0014`), plus seasons, signage (calibration/recurrence/celebration), and events schema (docs/06/09/13). RLS default-deny with the public/player/staff split; `pin_hash` locked out of anon+authenticated (read AND write); `check_in_team` RPC; `season_leaderboard()` (3 modes). **APPLIED to the owned Supabase project (ref `ysrqvdutayirpoibdlbf`) via the Management API and verified: 18 tables all RLS-on, 36 policies, 3 views, realtime on 12 tables, seed venue present. Anon-key smoke test passed — public reads 200, anon writes + pin_hash reads rejected.**
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
- Update this file's Current state after each phase.
