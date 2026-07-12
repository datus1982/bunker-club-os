# 08 — Module: Top-Selling Drinks Leaderboard (Toast POS)

Source: `top-selling-drinks-19180` export. Portrait display on two vertical screens; rotates top-selling beer / cocktail / overall pulled from Toast. A signature feature of the bar — do not regress it.

## Architecture (as-built, keep)
- One edge function `toast-sync` (571 lines) owns ALL Toast API interaction: machine-client auth → `GET /menus/v2/menus` (menu groups) → `GET /orders/v2/ordersBulk?businessDate=YYYYMMDD` → aggregate top items per configured menu group (or `MAIN_MENU_ALL` overall), skipping voided selections and excess-food orders → cache in `sales_cache`.
- Frontend `/drinks` (was /display) polls the function on `settings.refresh_interval` and rotates configured menu groups. Admin page configures Toast connection + groups + header/footer.

## Fixes required in port
**TZ-1 (bug, user-visible):** business date computed with hardcoded UTC-6 (toast-sync index.ts ~line 190, comment admits it). During CDT (Mar–Nov, UTC-5) the board queries the wrong business date from 11pm–midnight — late-night board goes stale/empty. → Compute business date with `Intl.DateTimeFormat('en-CA', { timeZone: venue.timezone })` (venue TZ from venues table / env). Also honor Toast's business-day rollover hour if configured (Toast business date typically rolls at ~4am, not midnight — verify against restaurant config endpoint; if accessible use Toast's own `businessDate` semantics).

**SEC-3:** Toast clientId/clientSecret stored in `toast_connection` DB table readable by the client. → Move to edge function secrets (`TOAST_CLIENT_ID/SECRET/RESTAURANT_GUID`). Keep the table only for non-secret config (selected groups, display prefs) or fold into venue_settings. Admin UI no longer collects secrets; document one-time setup in README.

**AUTH-1:** function validates OptiDev gateway JWT. → Replace: public displays call it unauthenticated is NOT acceptable (it can trigger Toast API spam). Options: (a) function requires Supabase anon JWT + per-IP rate limit + serve-from-cache-unless-stale logic (recommended: function returns cache if <refresh_interval old; only then hits Toast), or (b) pg_cron/scheduled invocation writes sales_cache and displays read the TABLE (realtime), never the function. **(b) is cleaner — recommended**: schedule every 60s during operating hours; /drinks subscribes to sales_cache changes. Displays become pure readers.

**Port hygiene:** same OptiDev deletions as trivia (client, env.ts, .optidev, lockfiles).

## Theme
This app is where `terminal-theme.css` lives — extract to shared theme (01). The drinks display already looks the part; keep visuals pixel-equivalent post-port (screenshot compare).

## Parity checklist
- [ ] Toast auth works with owner's credentials from secrets
- [ ] Top-5 per menu group matches OptiDev display for same business day (spot-check against Toast dashboard)
- [ ] Overall MAIN_MENU_ALL mode correct
- [ ] Rotation timing + portrait layout identical on the actual signage hardware
- [ ] Late-night (post-11pm) date handling correct on a CDT date
- [ ] Trivia-night schedule handoff: OptiSigns swaps /drinks → trivia /leaderboard and back without manual touch
