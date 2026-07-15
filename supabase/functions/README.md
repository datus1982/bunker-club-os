# Edge Functions

Deno edge functions (deployed with `supabase functions deploy <name>`). Directories
are scaffolded in Phase 0; each is implemented in its phase. Secrets live ONLY in
Supabase function secrets, never in the repo (docs/12).

| Function | Purpose | Phase | Secrets |
|---|---|---|---|
| `parse-powerpoint` | Ronnie's .pptx decks → questions/answers/images | 1 (docs/04) | `GEMINI_API_KEY` |
| `analyze-image` | picture-round image analysis | 1 (docs/04) | `GEMINI_API_KEY` |
| `verify-team-pin` | server-side PIN verification (hashes/compares `pin_hash`) | 2 (docs/05) | service role |
| `toast-sync` | Toast POS order pull → sales_cache / event counters / sales_history | 3 (docs/08) + 0043 | `TOAST_*` |
| `toast-menu-sync` | Toast Menus V2 + Stock → `toast_menu_cache` (POS as CMS) | 5 (docs/09) | `TOAST_*` |
| `instagram-sync` | @venue IG posts/stories → `instagram_cache` + image mirror (rotation card) | — (0042; `docs/runbooks/instagram-card.md`) | Vault `instagram_token` |

## docs/03 porting note (parse-powerpoint, analyze-image, toast-sync)
The legacy versions check an **OptiDev gateway JWT**
(`OPTIDEV_SUPABASE_GATEWAY_PUBLIC_KEY`). Replace with standard Supabase function
auth: verify the Supabase JWT, or a shared-secret header for pg_cron-invoked jobs.
No OptiDev gateway code survives the port.

## toast-sync: `sales_history` + the SMART TOAST backfill (0043)

`sales_history` (0043) is a durable per-`(venue, business_date, toast_guid)` log of units sold.
Every normal `toast-sync` run additively upserts **today's** per-item quantities into it (same
orders + same counting as `sales_cache`, no extra Toast call), so the `smart_toast` signage
slides can answer "last 7 days" (UNDERDOGS) and "last month" (CHAMPION). Anon/authenticated may
`SELECT` (sales counts are already public via `sales_cache`); writes are service-role only.

**One-time / occasional BACKFILL** — to make "last month" truthful immediately (or to repair a
gap), POST to the function *behind the CRON secret* with a `backfillDays` body. It sweeps that
many past business dates of Toast orders into `sales_history` and returns row counts **without**
touching `sales_cache`, events, or the ticker. The 60s cron never sets this (it posts `{}`).

```bash
# 92 days (≈ 3 months) in one call. x-cron-secret = the CRON_SECRET function secret.
curl -sS -X POST "https://<ref>.supabase.co/functions/v1/toast-sync" \
  -H "Content-Type: application/json" -H "x-cron-secret: $CRON_SECRET" \
  -d '{"backfillDays": 92}'
# Response: { ok, backfill:{days,offset}, results:[{ datesProcessed, rowsUpserted, from, to, sample }] }
```

- Gentle on the orders API: sequential day fetches with a 150 ms delay (~2 min for 92 days).
- If a very large sweep risks the edge wall-clock limit, **page** it with `backfillOffset`:
  `{"backfillDays":46}` then `{"backfillDays":46,"backfillOffset":46}` (max `backfillDays` 400).
- Idempotent: re-running a date overwrites that day's rows (running-total upsert), never dupes.

**History retention:** `sales_history` grows ~ (items sold/day) rows per business date
(≈ 30–60/day here → a few thousand rows per 90-day window). It is unbounded by design; there is
no auto-prune. If it ever needs trimming, delete old business dates directly, keeping at least
the longest window any live `smart_toast` CHAMPION slide requests (`fields.days`, default 30):
`delete from public.sales_history where business_date < '<YYYYMMDD>';` (service role). The
CHAMPION slide already states the TRUE window it has (`useSalesHistory.trueDays`), so trimming
only shortens what it can truthfully claim — it never shows a wrong number.

**MAIN_MENU_ALL depth:** `toast-sync` caches the overall bucket at **top-10** (per-group buckets
stay top-5) so the Top Sellers slide can auto-deepen; the legacy `/drinks` board slices to 5.
