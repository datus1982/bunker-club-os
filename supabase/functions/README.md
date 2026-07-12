# Edge Functions

Deno edge functions (deployed with `supabase functions deploy <name>`). Directories
are scaffolded in Phase 0; each is implemented in its phase. Secrets live ONLY in
Supabase function secrets, never in the repo (docs/12).

| Function | Purpose | Phase | Secrets |
|---|---|---|---|
| `parse-powerpoint` | Ronnie's .pptx decks → questions/answers/images | 1 (docs/04) | `GEMINI_API_KEY` |
| `analyze-image` | picture-round image analysis | 1 (docs/04) | `GEMINI_API_KEY` |
| `verify-team-pin` | server-side PIN verification (hashes/compares `pin_hash`) | 2 (docs/05) | service role |
| `toast-sync` | Toast POS order pull → sales_cache / event counters | 3 (docs/08) | `TOAST_*` |
| `toast-menu-sync` | Toast Menus V2 + Stock → `toast_menu_cache` (POS as CMS) | 5 (docs/09) | `TOAST_*` |

## docs/03 porting note (parse-powerpoint, analyze-image, toast-sync)
The legacy versions check an **OptiDev gateway JWT**
(`OPTIDEV_SUPABASE_GATEWAY_PUBLIC_KEY`). Replace with standard Supabase function
auth: verify the Supabase JWT, or a shared-secret header for pg_cron-invoked jobs.
No OptiDev gateway code survives the port.
