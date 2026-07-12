# 09 — Module: Shelter-Terminal Signage Templater

## Problem
Static ads (drink specials, events) are hand-built and manually uploaded to OptiSigns — slow, inconsistent, staff-unfriendly. Goal: staff upload an image + a few fields; the system renders it inside a consistent atomic-era shelter-terminal frame at a stable URL; OptiSigns just points at URLs.

## Model
```sql
create table signage_slots (      -- a schedulable display surface
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues not null,
  name text not null,             -- 'Portrait Left', 'Landscape Bar TV'
  orientation text not null check (orientation in ('portrait','landscape')),
  slug text unique not null       -- public URL: /signage/s/{slug}
);

create table signage_items (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues not null,
  slot_id uuid references signage_slots,
  template text not null,          -- 'drink_special' | 'event' | 'announcement' | 'image_only'
  fields jsonb not null,           -- { title, subtitle, price, image_url, cta, ... }
  starts_at timestamptz, ends_at timestamptz,   -- null = evergreen
  sort_order int not null default 0,
  duration_seconds int not null default 12,
  active boolean not null default true,
  created_by uuid references profiles
);
```

## Rendering
`/signage/s/{slug}` — public route; fetches active items for slot (time-window filtered), renders a full-screen rotation (CSS crossfade), each item through its template component. Templates are React components in the terminal theme: green-phosphor frame, scanline overlay (static, not animated — PERF rule), VT323 headers, "CIVIL DEFENSE APPROVED" flair, boot-sequence transition between items (fast, <400ms). Subscribes to realtime on signage_items → updates without reloads (screens run for weeks).

Templates v1: `drink_special` (image, name, price, tagline), `event` (title, date/time, image, blurb), `announcement` (text-only terminal printout w/ typewriter effect on entry), `image_only` (letterboxed in frame), `celebration` (see below).

## Admin — /signage (staff role)
List per slot; add item: pick template → form (image upload → Storage `signage` bucket, client-resize to ≤1080px long edge) → live preview at exact aspect → schedule window → save. Drag to reorder. "Preview slot" opens the public URL.

## Celebrations & holiday recurrence
**`celebration` template:** skins `birthday | bachelor | bachelorette | anniversary | congrats` (copy/iconography variants over one component). Fields: honoree name, occasion line, optional message, optional photo (viewport treatment). In-world framing: 'DWELLER RECOGNITION PROTOCOL'. Staff flow must be <60s from a phone: occasion → name → date/tonight → optional shout-out time → save.

**Scheduled shout-out moment:** a celebration item may attach a timed takeover — screen_takeovers.starts_at is already future-schedulable; add `signage_item_id uuid references signage_items` to screen_takeovers so the celebration's admin card shows/edits its linked moment. At the chosen minute every slot flips to the shout-out ('RAISE A GLASS FOR DANA') for a configured 30–120s, then resumes. Priority: same tier as manual takeovers. Product note: 'your name on every screen at your minute' is a sellable party-package line item.

**Recurrence on signage_items:** add `recurrence jsonb` (same shape as scheduled_events: annual { month, day } or weekly { daysOfWeek }, plus time window). pg_cron re-arms the item's starts_at/ends_at on completion. Holidays are celebrations/announcements with annual recurrence — Halloween, New Year's, July 4th configured once, forever.

## Screens & scheduling — Bunker OS OWNS IT (decision: OptiSigns is phased out)
Venue screens have built-in browsers. Each physical screen is pointed at its slot URL ONCE, permanently, in kiosk/fullscreen mode. The slot page resolves its own mode, priority order:
1. **Takeover broadcast** (see below) — overrides everything.
2. **Scheduled event** ALERT/MOMENT/EVENT stages (doc 13) — unless a game is live and the event's interrupt_game=false.
3. **Live game**: if a game for this venue is status `active`/`paused`, the slot renders its game surface (portrait slots → trivia leaderboard; landscape → game display) automatically. No scheduler involved — the slot watches the games table via realtime.
4. **Event TEASE interstitials** interleaved with **scheduled signage rotation** — active signage_items in their time windows.
OptiSigns may remain during migration as a dumb URL loader; the acceptance test is that removing it changes nothing. Slot URL inventory documented in README.

Add to `signage_slots`: `terminal_number int`, `location_label text` ('Taproom East'), `last_seen timestamptz` (page heartbeats every 60s → admin dashboard shows screen health), `overscan_inset_pct numeric default 0`, `scale_adjust numeric default 1.0` (see Display canvas system, doc 01). All slot rendering goes through DisplayCanvas; templates are designed at the fixed canvas only.

## Takeover broadcasts
```sql
create table screen_takeovers (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues not null,
  message text not null, sub_message text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,                    -- null = until dismissed
  created_by uuid references profiles
);
```
All slot pages subscribe via realtime; an active takeover renders full-screen inverse-video (filled bars, current ink) with the double-border priority frame. Admin control: one screen in /signage — message, optional duration presets (2/5/10 min), send/dismiss. Staff role can send. Use cases: "TRIVIA BEGINS IN 10 MINUTES", "LAST CALL", "HAPPY BIRTHDAY DANA."

## Persistent chrome (the frame IS the OS)
Every display route (signage slots, /leaderboard, /game-display, /drinks) renders inside shared chrome:
- Header: venue mark + 'BUNKER UNIFIED OS v2.1' + TERMINAL {terminal_number} — {location_label} + live clock.
- Footer: status line ('■ ONLINE') + ticker that REPRINTS a new line every ~9s (no scroll animation — perf rule + terminal authenticity). Ticker sources, interleaved: manual lines (venue_settings), live season top-3 (green ink), live Toast top seller (green ink).
- Static scanline + vignette overlays. Typewriter/boot effects run once on content entry then idle; never infinite.

## Color-state system (design language — LOCKED)
Two inks with SEMANTIC meaning, implemented as CSS custom-property themes:
- **AMBER = ambient.** Default building state: signage, events, announcements.
- **GREEN = live.** Anything realtime renders green — including green elements INSIDE amber mode (ticker standings, NOW POURING from sales_cache). Green literally means 'live feed'.
- **Game-active re-theme:** when a game flips to active, every slot plays the boot-line transition and re-themes fully green ('GAME MODE ENGAGED'); reverts to amber on completion. This is an intentional room-wide theatrical moment.
- Takeovers: no third color — inverse video in the current ink signals priority as intensity.

## Toast-sourced content (POS as CMS)
Toast Menus V2 exposes per-item Image, description, price, ItemTag, Visibility, and Availability; the API also provides a metadata/staleness endpoint to detect menu changes cheaply. Stock (86) status is available via Toast's Stock API, and staff can flip it from any POS terminal via Quick Edit (hold item button → Inventory: In/Out of Stock) with NO publish delay. Design:

**New edge function `toast-menu-sync`** (sibling of toast-sync, same secrets): poll the menus metadata endpoint every ~2 min; on change, pull full menus and upsert:
```sql
create table toast_menu_cache (
  guid text primary key,
  venue_id uuid references venues not null,
  name text, description text, price numeric,
  image_url text,            -- Toast CDN original
  image_storage_path text,   -- OUR mirrored copy (bucket: signage) — screens never depend on Toast CDN
  menu_group text, item_tags text[],
  out_of_stock boolean not null default false,
  updated_at timestamptz default now()
);
```
Stock polled every ~60s (lightweight) into `out_of_stock`.

**Template integration:** drink_special (and event where relevant) gains `source_toast_guid`. When set, name/price/photo auto-fill from cache; any manually-entered field overrides. Live-sourced values render in GREEN ink even in amber mode (consistent with color-state language: green = live feed). Price changes in Toast propagate to screens automatically.

**Auto-hide rule:** any signage item whose source_toast_guid is out_of_stock is skipped by the rotation. 86 the keg, the ad disappears.

**Write-access reality (AMENDED Phase 3 — standard access is READ-ONLY):** the owner provisioned Toast **STANDARD API access**, which grants NO write scopes. `stock:write` requires a partner-tier integration and is NOT available to us. Toast menu STRUCTURE was already read-only; stock status is now **read-only too**. Therefore featured control is **POS-side-only** — stock status is the single source of truth, mutated exclusively at the POS; Bunker OS only READS it:
- POS side (the only control surface): Quick Edit In/Out of Stock (below).
- ~~Bunker OS side: 'Feature this' toggle writes stock via stock:write~~ — **REMOVED.** Standard access has no write scope. There is no "feature from Bunker OS admin" write path; a /signage "Feature this" button is not built in Phase 3. (If the owner ever upgrades to a partner-tier integration with `stock:write`, this direction can be restored — but do NOT design around it now.)
- Sync inbound: 60s stock polling (read). Toast's stock webhook is a possible future upgrade if the credential tier ever supports it.
- CREDENTIALS NOTE: owner-controlled Toast access scopes are **read-only**: `menus:read, config:read, orders:read, stock:read`. Creds live in edge-fn secrets only (`TOAST_CLIENT_ID/SECRET/RESTAURANT_GUID`) — never in the repo/frontend (SEC-3).
- ANTI-GOAL (unchanged): ★ SCREENS duplicates are NEVER sellable — selling through duplicates splits product reporting. Featured is presentation-layer only; real items remain the only sellable entities. Names/prices/photos/new items remain authored in Toast Web (slow-changing config; acceptable).

**Fingertip featured control — the ★ SCREENS toggle group (POS-side-only):** one-time setup in Toast Web: a menu group '★ SCREENS' (hidden from ordering channels via visibility) containing lightweight DUPLICATE items mirroring featured candidates (NOT the real sellable items — 86 status is global across menus, so real items must never be used as display toggles). Sync treats in-stock items in this group as 'featured': auto-materialized into the signage rotation (template defaults + toast fields). Staff workflow: manager passcode → hold button in ★ SCREENS → In Stock = on screens / Out of Stock = off. **This is the ONLY way to toggle featured** (standard access is read-only — no Bunker-OS-side write). No new tools, no training beyond one shift note.

**Description safety rule:** Toast descriptions may contain internal recipes. NEVER auto-display description text. Convention: only text BEFORE a `---` delimiter is public blurb; absent a delimiter, show nothing until a human fills the blurb override in item admin. (Owner should separately verify descriptions aren't already exposed on Toast online ordering.)

## Photo treatment
Default **VIEWPORT**: full-color photo inside a bordered 'OPTICAL FEED' window with light scanline/vignette pass; chrome stays terminal. Per-item optional **PHOSPHOR**: image tinted into the current ink (grayscale→sepia→hue-rotate) for atmosphere pieces. Toggle in item admin with live preview. Rule of thumb in admin helper text: selling it → viewport; setting a mood → phosphor.

Reference mockup: `signage-frame-mockup.html` (delivered during planning) demonstrates chrome, all four templates, both treatments, both inks, and takeover.
