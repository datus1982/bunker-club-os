# Bunker Club OS

Self-hosted venue platform for **Bunker Club** (OKC) — an atomic-era themed bar.
Consolidates all interactive/digital systems (trivia, registration, drinks
leaderboard, seasons, signage, events) under one terminal-themed OS, replacing two
apps previously trapped in OptiDev. `/docs` is authoritative.

## Stack

React 19 · Vite · TypeScript (strict) · Tailwind 3 · shadcn/ui · React Router v7 ·
TanStack Query v5 · Supabase (Postgres/Auth/Realtime/Storage/Edge Functions) ·
pnpm monorepo. Hosting: Vercel Pro **or** Cloudflare Pages (SPA static — pick one).

## Layout

```
apps/web/            the single SPA (all modules as role-gated routes)
  src/shared/        supabaseClient, DisplayCanvas, useRole, guards, queryClient
  src/theme/         terminal-theme.css (green phosphor CRT)
  src/modules/       trivia · registration · leaderboard · seasons · portal · signage
supabase/migrations/ complete DDL (docs/02) — numbered 0001–0014
supabase/functions/  parse-powerpoint · analyze-image · toast-sync · verify-team-pin · toast-menu-sync
scripts/             export-legacy · import-legacy · seed-staff · backup
docs/                the 14 spec docs + 4 mockups (authoritative)
```

## Local setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env      # fill VITE_SUPABASE_URL / ANON_KEY / VENUE_ID
cp .env.example .env                        # fill SUPABASE_* + LEGACY_* for scripts
pnpm dev                                     # http://localhost:5173
```

Apply the schema to the owned Supabase project:

```bash
supabase link --project-ref <ref>
supabase db push
```

## Legacy migration (docs/03, path B — read-only)

```bash
pnpm export:legacy    # reads legacy project via anon key → ./legacy-export/  (NEVER writes to legacy)
pnpm import:legacy    # maps into the new schema, idempotent, verifies old vs new counts
```

## Backups & restore drill (docs/12)

`pnpm backup` writes a gzip'd `pg_dump` + all storage objects to `BACKUP_DIR`.
In CI (GitHub Actions cron), the artifacts are pushed off-platform (R2/S3/Drive).

**Restore drill (do once in Phase 0, into a scratch project):**

```bash
gunzip -c backups/db-<stamp>.sql.gz | psql "$SCRATCH_DATABASE_URL"
# then re-upload backups/storage-<stamp>/<bucket>/* with a short supabase-js loop
```

## Display / slot URLs

Public display routes render zero-auth through `DisplayCanvas` and are safe on an
unattended screen. Append `?calibrate` to any of them for the install test pattern.

| URL | Screen |
|---|---|
| `/leaderboard` | trivia leaderboard (portrait) |
| `/game-display` | audience Q&A (landscape) |
| `/drinks` | Toast top sellers (portrait) |
| `/signage/s/{slug}` | signage slot (per-slot orientation) |

Per-physical-screen slot inventory (terminal #, location, inset) is recorded here
as screens are calibrated in Phase 5.

## What Claude needs from you (Phase 0 gate)

1. **New Supabase project:** URL, anon key, service role key, direct `DATABASE_URL`. Supabase **Pro** tier enabled (daily backups + PITR; no free-tier pausing).
2. **Legacy OptiDev:** the anon key from the legacy apps' config, and confirmation of the gateway URL (`https://cdgdxfichpikapawnnth.supabase.co`).
3. **Hosting + domain:** Vercel Pro or Cloudflare Pages, and the custom domain (e.g. `os.bunkerclub.bar`) configured BEFORE any QR codes are printed.
4. **venue_staff seed emails:** Stephen (admin) + Ronnie (host) — after each signs in once via OTP, run `pnpm seed:staff`.
5. **Restore-drill sign-off:** a scratch project to test the restore into.

Nothing here has been run against live services yet.
