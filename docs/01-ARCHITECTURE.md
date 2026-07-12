# 01 — Architecture

## Stack (mirrors owner's existing Mission Control workflow at VOX)

- **Frontend:** React 19, Vite, TypeScript (strict), Tailwind CSS 3, shadcn/ui, React Router v7, TanStack Query v5. Single-page app.
- **Backend:** Supabase (owned project): Postgres, Auth, Realtime, Storage, Edge Functions (Deno).
- **Hosting:** Vercel (static SPA + SPA rewrite). Supabase hosts everything server-side.
- **Repo:** GitHub, single monorepo.
- **Package manager:** pnpm. Delete any stray yarn.lock (the OptiDev exports contain BOTH pnpm-lock.yaml and yarn.lock — pick pnpm, remove yarn).

## Repo layout

```
bunker-club-os/
  CLAUDE.md                 # repo guide for Claude Code (see 10 for contents)
  apps/
    web/                    # the single SPA (all modules as routes)
      src/
        modules/
          trivia/           # pages + components from port
          registration/
          leaderboard/      # toast drinks leaderboard
          seasons/
          portal/
          signage/
        shared/             # supabaseClient, auth hooks, layout, guards
        theme/              # terminal theme css + tokens
  packages/                 # only if extraction becomes necessary; start empty
  supabase/
    migrations/             # NUMBERED, complete DDL from 02
    functions/
      parse-powerpoint/
      analyze-image/
      toast-sync/
      verify-team-pin/      # new (05)
  docs/                     # these documents
```

Rationale: one app, role-gated routes. Splitting into multiple deployables adds ops burden with zero benefit at this scale. Extract packages only when a second app actually exists.

## Route map (top level)

| Route | Module | Access |
|---|---|---|
| `/`, `/menu`, `/events`, `/trivia`, `/visit`, `/about` | public website (doc 14) | public |
| `/dashboard` | Dashboard | staff+ |
| `/scoring`, `/game/*`, `/teams`, `/history`, `/settings` | trivia host tools | host+ |
| `/leaderboard` | trivia leaderboard display | public (display) |
| `/game-display` | audience Q&A display | public (display) |
| `/checkin` | registration v2 | public (player auth) |
| `/portal/*` | player portal | player auth |
| `/drinks` | toast drinks display | public (display) |
| `/signage/*` | ad templater admin + rendered ad pages | staff+ / public (display) |
| `/admin/seasons` | season management | admin |

Public display routes must render with zero auth and be safe to leave on an unattended screen (read-only data only).

## Auth & roles

Supabase Auth. Two populations, one auth system:
- **Players:** email OTP (free, built-in) now; phone OTP via Twilio later (config flag). Session persists on device ("remembers you" check-in).
- **Staff:** email+password or OTP. Identity in `venue_staff` table (NOT app_metadata — keeps it venue-scoped for SaaS). Role labels (`admin`, `host`, `staff`) are **titles only** — they carry no automatic module access. Module access is controlled by `venue_staff.modules text[] not null default '{}'` — explicit per-staff grants; keys: `trivia`, `seasons`, `drinks`, `signage`, `website`, `events`. The check is SECURITY DEFINER `has_module(p_venue, p_module)`: true if the caller is the venue's admin, or the named module is in their grants. **Admin implies all modules** (no explicit grants needed); host and staff imply nothing — grants must be set explicitly. Two exceptions stayed rank-based: seasons management is admin-only; `team_roster` staff email visibility uses `venue_role_at_least`.

Route guards: `useRole()` hook reads `venue_staff` for the current venue, returning `{ role, modules, can() }` + `hasModule()` helper. `<RequireRole>` enforces rank (admin/host/staff); `<RequireModule>` enforces module grants. Both wrap routes in App.tsx.

## Realtime strategy (fixes the OptiDev mess)

One pattern everywhere: subscribe to postgres_changes on the relevant tables, invalidate TanStack Query keys on event, and keep ONE slow polling fallback (30–60s refetchInterval) purely as a safety net for dropped websockets. Never 5s polling; never triple-redundant sync (see audit 04 for what we're replacing).

## Environment variables

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```
That's it for the frontend. Standard Vite env — the OptiDev `window.__ENV__` runtime-injection helper (`src/lib/env.ts`) is deleted. `supabaseClient.ts` becomes:

```ts
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
);
```

Edge function secrets (Supabase dashboard, never in repo): `GEMINI_API_KEY`, `TOAST_CLIENT_ID`, `TOAST_CLIENT_SECRET`, `TOAST_RESTAURANT_GUID`, later `TWILIO_*`.

## Display canvas system (ALL display routes — non-negotiable)
Mixed fleet reality: 16:9 screens in both orientations, 1080p and 4K, TV browsers reporting inconsistent viewports/DPR. Solution: **fixed design canvas + scale-to-fit**. Display routes NEVER use responsive design — no media queries, no breakpoints, no vw/vh font sizing.

- Two logical canvases: landscape **1920×1080**, portrait **1080×1920**. Every display layout (signage slots, /leaderboard, /game-display, /drinks, takeovers, events) is designed in absolute px against its canvas.
- A shared `<DisplayCanvas orientation>` wrapper measures the real viewport, computes `scale = min(vw/W, vh/H)`, applies a single `transform: scale()` with `transform-origin: top left`, centers via offset, letterboxes any remainder in black. Recompute on resize. Browsers rasterize transformed text at device resolution → 4K renders sharper, never blurrier.
- Kiosk viewport meta: width=device-width, user-scalable=no.
- **Overscan handling:** setup runbook (doc 12) requires enabling the TV's 'Just Scan'/'1:1'/'Fit' picture mode per screen. Backstop: `signage_slots.overscan_inset_pct numeric default 0` and `scale_adjust numeric default 1.0` applied by DisplayCanvas for stubborn TVs.
- **Calibration mode:** every slot/display URL accepts `?calibrate` → test pattern: edge markers at 0% and at the slot's inset, corner targets, VT323/Share Tech Mono size ladder, live readout of reported viewport, devicePixelRatio, and computed scale. Install procedure: stand at each screen once, confirm edges + crispness, set inset if needed. 

## Design system

`terminal-theme.css` already exists in the drinks-leaderboard export (root of that repo) with its own README. Green phosphor (#00ff41), scanlines, VT323 + Share Tech Mono, CRT flicker. Move it to `apps/web/src/theme/`, make it the base layer, and extend with amber (#ffb000) and blue (#46a4ff) variants as CSS custom-property themes — useful for distinguishing signage types.

**Perf rule for displays:** the infinite flicker animation must be OPT-IN per route, and OFF on all always-on display routes (`/leaderboard`, `/game-display`, `/drinks`, `/signage/*`). The old app ran flicker on the trivia leaderboard 24/7 (App.tsx only excluded /game-display) — cheap signage hardware doesn't love infinite CSS animations.
