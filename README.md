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
| `https://os.bunkerokc.com/signage/s/portrait-main` | signage slot — portrait |
| `https://os.bunkerokc.com/signage/s/landscape-bar` | signage slot — landscape |
| `/drinks` | legacy standalone Top Sellers board — back-compat / docs/03 pilot only, **not** the recommended TV target |

**Point every TV at the clean `/signage/s/{slug}` URL above — one URL per screen.**
The system decides what shows: trivia goes live → the leaderboard takes over;
otherwise the rotation cycles **Top Sellers · drink promos · events · broadcasts**.
**Top Sellers now rotates INSIDE signage** (a `top_sellers` rotation item), so you no
longer point a TV at the separate `/drinks` address — that route stays only for
back-compat and the docs/03 drinks-first pilot. Pace each slide with the per-item
SECONDS control in **EDIT ROTATION** (Top Sellers usually wants a longer dwell than a
quick promo). `?preview=1` is a STAFF-ONLY preview that renders the rotation *without*
takeovers or game mode, so never use a `?preview=1` link on a TV. The `/signage` admin
(each slot card) has a COPY button for the clean URL.

Per-physical-screen slot inventory (terminal #, location, inset) is recorded here
as screens are calibrated in Phase 5.

**VIDEO SOUND ON TVs (trivia A/V rounds):** browsers block *unmuted* autoplay
without a gesture, so an inter-round video always boots **muted** and shows a
"⚠ AUDIO CHANNEL SEALED — TAP TO OPEN COMMS" prompt; one tap on the screen unmutes
it and arms sound for the rest of the session. For hands-off audio on a kiosk TV,
allow unmuted autoplay in the browser once: **Chrome** — launch with
`--autoplay-policy=no-user-gesture-required`, or Site Settings → Sound → **Allow**
for `os.bunkerokc.com`; **Firefox** — site permission **Autoplay → Allow Audio and
Video**. Then videos play with sound and no prompt appears.

**★ SCREENS visibility caveat (Toast):** the featured drink rotation is driven by
the **★ SCREENS** menu group in Toast, gated on POS visibility (0034). If you ever
delete and re-create that group, its **group** visibility must include **POS** — a
channel-hidden group cascades `pos_visible = false` onto every item inside it, and
the featured rotation goes empty with no error. When in doubt, confirm ★ SCREENS
shows on the POS view in Toast.

## What Claude needs from you (Phase 0 gate)

1. **New Supabase project:** URL, anon key, service role key, direct `DATABASE_URL`. Supabase **Pro** tier enabled (daily backups + PITR; no free-tier pausing).
2. **Legacy OptiDev:** the anon key from the legacy apps' config, and confirmation of the gateway URL (`https://cdgdxfichpikapawnnth.supabase.co`).
3. **Hosting + domain:** Vercel Pro or Cloudflare Pages, and the custom domain (e.g. `os.bunkerclub.bar`) configured BEFORE any QR codes are printed.
4. **venue_staff seed emails:** Stephen (admin) + Ronnie (host) — after each signs in once via OTP, run `pnpm seed:staff`.
5. **Restore-drill sign-off:** a scratch project to test the restore into.

Nothing here has been run against live services yet.
