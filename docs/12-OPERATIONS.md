# 12 — Operations: Backups, Domain, Costs, Resilience

## Backups (owner requirement from day one)
- **Supabase Pro tier from Phase 0** (~$25/mo): daily backups + point-in-time recovery, and removes free-tier project-pausing risk (unacceptable for always-on screens).
- **Off-platform copy:** weekly `pg_dump` of the full database pushed to owner-controlled storage (Supabase Storage bucket counts only as convenience; true off-platform = a GitHub-actions artifact, S3/R2, or even Google Drive via service account). Script in `scripts/backup.ts`, scheduled via GitHub Actions cron. Storage buckets (signage, picture-rounds, logos) included in the weekly job.
- Restore drill: document the restore procedure in README and TEST IT ONCE during Phase 0 (restore into a scratch project).

## Domain & printed artifacts
- App lives on an owner-controlled domain (e.g. `os.bunkerclub.bar`) configured in Phase 0, BEFORE any QR codes are printed. Printed QRs (table tents, coasters, host stand) must never encode a hosting-provider URL.
- `/checkin` QR URL is permanent; any future restructuring keeps a redirect.

## Hosting & cost expectations
- Vercel Hobby is non-commercial by ToS; a bar is commercial. Use Vercel Pro (~$20/mo, matches owner's existing workflow) OR Cloudflare Pages (free, commercial-permitted) — SPA static hosting is interchangeable; pick one in Phase 0.
- Expected run cost: Supabase Pro $25 + hosting $0–20 + Gemini API (pennies at picture-round volume) + optional Twilio SMS (~$0.01/msg). Total ≈ $25–50/mo.

## Display resilience
- **Nightly self-reload:** every display route reloads itself at 04:00 venue time (setTimeout to next 4am → location.reload()). Papers over TV-browser memory leaks and webview quirks fleet-wide.
- **Sync freshness on dashboard:** admin dashboard shows last-success timestamps for toast-sync and toast-menu-sync with amber/red staleness states (>15 min / >60 min). Silent integration failure must be visible at a glance.
- **Screen health:** heartbeat last_seen per slot (already in 09) surfaces on the same dashboard panel.

## Human runbooks (Phase 1 exit deliverable)
Opus generates two one-pagers into /docs/runbooks/ and keeps them current:
1. **Host night runbook (Ronnie):** open scoring URL, confirm displays are in game mode, walk-up team check-in path, what to do if a display desyncs (refresh it; realtime rejoins), end-of-night completion steps.
2. **Staff signage runbook:** create a special from a phone, the ★ SCREENS Quick-Edit toggle, sending a takeover broadcast, and "a screen looks frozen" (power cycle; it self-recovers via kiosk URL + nightly reload).
3. **Screen install checklist:** point browser at slot URL, set TV to Just Scan/1:1 picture mode, run ?calibrate, record inset. One page, lives with the runbooks.

## Access hygiene
- Supabase service key + Toast secrets live ONLY in edge function secrets and CI secrets. Never in repo, never in frontend env.
- Owner's GitHub + Supabase + registrar accounts get 2FA; recovery codes stored offline (this system is the bar's infrastructure now).

## CI/CD & deployment (`.github/workflows/deploy.yml`)
- **GitHub Actions is the deploy path.** Push to `main` → production deploy to Cloudflare Pages (`--branch=main`, serves `os.bunkerokc.com`). Push to a `phase-*` branch → preview deploy (`--branch=<branch>`), giving every phase a stable preview URL for review. Manual `wrangler` from a local `dist` is now only a fallback.
- **Build is baked at CI time:** `apps/web` is self-contained (own `package-lock.json`, no workspace deps) — the job runs `npm ci` + `npm run build` in `apps/web`, then `wrangler pages deploy apps/web/dist`. The public `VITE_*` values (Supabase URL, anon key, venue id) are repo secrets and are compiled into the bundle.
- **Repo secrets required:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VENUE_ID` (set via `gh secret set`; values in `.env` / `apps/web/.env`).
- **A phase is complete only when its PR is MERGED to `main` and this deploy workflow is green** — merging + a green production deploy is part of the phase, not a later owner chore.
- **Preview URL in the PR body:** every phase PR records its `phase-*` Cloudflare preview URL so reviewers can exercise the running app.

## Migrations: development vs. cutover
- **Until cutover** (legacy OptiDev still serving production trivia): migrations MAY be applied to the live owned project during development via the Management API (see the migration pattern in CLAUDE.md), so in-browser verification runs against real schema.
- **From cutover onward:** migrations apply ONLY from merged `main` — never ad-hoc against production. The merged migration files are the source of truth.
- **Every RLS migration** (any phase) is immediately followed by the anon + host smoke tests (anon writes must 401; a host read of the touched tables must 200) before the phase is called done — the 0018 `42P17` recursion bug was live in prod from Phase 0 precisely because a successful host read was never actually exercised.
