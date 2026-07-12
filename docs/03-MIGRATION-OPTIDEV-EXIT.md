# 03 — OptiDev Exit: Migration Plan

## What OptiDev actually is (from source audit)

Both apps are standard React/Vite/Supabase projects. "OptiDev Cloud" = a managed Supabase project fronted by OptiDev's HMAC gateway. The underlying project URL leaked in `rls-policies.sql`: `https://cdgdxfichpikapawnnth.supabase.co`.

OptiDev coupling points (identical in both apps):
1. `src/lib/supabaseClient.ts` — ~200 lines of gateway session/HMAC/WebSocket signing. Replace with 5-line standard client (see 01).
2. `src/lib/env.ts` — `window.__ENV__` runtime injection. Delete; use Vite env.
3. `.optidev/` Vite plugins + vite.config references. Delete; simplify vite.config (keep alias, react-swc, tailwind; drop injectSource/visualEditor/errorOverlay plugins and WORKSPACE_HOST logic).
4. Edge functions check an OptiDev gateway JWT (`OPTIDEV_SUPABASE_GATEWAY_PUBLIC_KEY` in toast-sync). Replace with standard Supabase function auth (verify JWT or shared secret header for cron).
5. **The data lives in THEIR Supabase project.**

## Data export (decision gate)

**Question for Stephen (unresolved):** can you log into `cdgdxfichpikapawnnth.supabase.co` dashboard directly, or only through OptiDev?

**Path A — dashboard access exists:** Settings → Database → connection string → `pg_dump --schema=public --no-owner --no-privileges` for schema + data. Download storage buckets (`picture-rounds`, `logos`) via dashboard or a script listing/downloading objects with service key.

**Path B — no direct access:** the anon key + open RLS means every table is readable through the API (ironically the security hole is the escape hatch). Write a one-off export script (supabase-js, paginate all tables to JSON/CSV; storage objects are public — walk and download). Schema reconstructed from: the 9 migration files in-repo + CLAUDE.md schema notes + introspection of exported rows. NOTE: base tables (teams, games, rounds, scores, game_teams, theme_settings) predate the migrations folder — their exact DDL must be reconstructed; the target schema in 02 supersedes it anyway, so export DATA, map into new schema.

Either way: export is read-only; OptiDev system keeps running untouched.

## Data mapping (old → new)

| Old | New |
|---|---|
| teams (contact_first/last/email, pin_code) | teams (+ pin_hash) ; contact → profiles + team_members(captain) where email present |
| games | games (+ venue_id, season_id null, game_date derived from created_at/start_time) |
| game_teams | game_teams (+ checked_in_by null) |
| rounds / scores / questions / game_display_state | unchanged (+ FK integrity check) |
| theme_settings | venue_settings |
| storage: picture-rounds, logos | same bucket names in new project |

Write the import as an idempotent script (`scripts/import-legacy.ts`) run once against the new project with service key.

## Cutover sequence

1. New Supabase project + repo scaffold + migrations applied (Phase 0).
2. Port apps (Phases 1, 3). Deploy to Vercel at new URLs.
3. Legacy data import. Verify counts per table old vs new.
4. **Parallel run one full Wednesday:** OptiSigns keeps pointing at OptiDev URLs; Ronnie also opens the new /scoring on a second tab; new /game-display on a spare screen. Score the night in BOTH (or score in old, shadow-read in new).
5. If clean: repoint OptiSigns schedules to new URLs, print new QR code, Ronnie bookmarks new host URL. Re-run data import delta (that night's game) or accept starting fresh from cutover.
6. Leave OptiDev alive but unused for 30 days, then close.

## Rollback

OptiSigns URL schedule is the only integration point — rollback = repoint URLs back. Keep the old QR code sign until 30 days post-cutover.
