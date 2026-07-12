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
