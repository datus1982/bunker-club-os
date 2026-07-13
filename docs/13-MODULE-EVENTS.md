# 13 — Module: Scheduled Events & Promos (Phase 7 — IN BUILD)

> **2026-07-13 amendment (owner-ratified, docs/ux-refinement-mockup.html view 5):** the module
> now covers THREE kinds of first-class scheduled object, not just choreographed moments.
> The manager test governs the UI: schedule a promo in minutes, it runs itself.

## Concept
First-class scheduled objects that put content on the screens without a human touching anything
at fire time. Three kinds, one engine (shared schedule/recurrence/status machinery):

- **WINDOW** — a calm recurring promo window. During the window a signage card quietly joins
  every rotation and a ticker line runs; at window end both vanish and recurrence re-arms.
  No takeover, no stages, never interrupts anything. Owner examples: happy hour daily 4–7 PM;
  free hot dogs with any drink, Mondays 4 PM–close; a watch party.
- **MESSAGE** — WINDOW mechanics, one-shot by default, message-styled card (no drink link
  required). Owner example: a birthday message July 26 4–6 PM. Distinct badge in the UI so a
  manager immediately sees "this is a one-time message," but it shares the WINDOW render path.
- **MOMENT** — the original choreographed arc: tease → alert → moment → event window →
  all-clear, with a LIVE SALES COUNTER during the window (orders for the linked Toast item,
  counted near-real-time via the existing toast-sync order pull). Batch-shot theatre
  (Rocket Sauce launches, infestation countdowns, last calls).

Distinct from takeovers (manual/instant): all three kinds are SCHEDULED and self-running.

## Schema (migration 0035 amends the Phase 0 table)
```sql
create table scheduled_events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues not null,
  name text not null,                       -- 'Midnight Launch', 'Happy Hour'
  kind text not null default 'moment' check (kind in ('window','message','moment')),  -- 0035
  skin text not null default 'launch' check (skin in ('launch','infestation','generic')),
  fields jsonb not null default '{}',       -- title, directive, cta, flavor lines
  toast_guid text references toast_menu_cache, -- linked product (live price + counter source; optional for window/message)
  fire_at timestamptz,                      -- next occurrence / window start (recomputed on completion)
  recurrence jsonb,                         -- { daysOfWeek:['FR','SA'], time:'00:00' } | null = one-shot
  tease_minutes int not null default 60,    -- moment only; 0 for window/message
  alert_minutes int not null default 5,     -- moment only; 0 for window/message
  window_minutes int not null default 30,   -- for window/message this IS the promo window length
  interrupt_game boolean not null default false,  -- trivia is sacred by default; window/message never interrupt
  status text not null default 'scheduled' check (status in ('scheduled','running','completed','aborted','disabled'))
);
```
Stage is DERIVED from now() vs fire_at + durations (no stage column to desync). A pg_cron tick
(1/min) flips status and recomputes next fire_at from recurrence on completion. WINDOW/MESSAGE
use the same tick: status running during [fire_at, fire_at + window_minutes), then completed +
re-arm (or disabled when one-shot and done).

**RLS tightening (0035, must land BEFORE real rows):** Phase 0's blanket anon `public_read` on
`scheduled_events` is revoked (review finding, PR #12 NOTE 8 — a birthday row would leak names
to anyone with the anon key). Displays are anon, so they read a SECURITY DEFINER view
`signage_events_live` that exposes a row ONLY inside its display horizon — from tease start
(moment) or window start (window/message) until all-clear/window end — and only the columns
displays render. Staff manage rows via `has_module('events')` (0024 already gates writes).
The website keeps using `public_events` (0015, show_on_website tease copy) — unchanged.

## WINDOW / MESSAGE slot behavior
During [fire_at, fire_at + window_minutes): a card materializes into every slot's rotation at
RENDER TIME (no signage_items rows — same technique as ★ SCREENS) and the ticker gains a line.
Card content from `fields` (title, body/directive, cta) + optional `toast_guid` (name + LIVE
price in green, subject to the standard OOS/POS-visibility auto-hide — a happy-hour card whose
linked item is 86'd hides exactly like any drink_special). MESSAGE renders the same card in
message styling (generic skin chrome, no price block unless linked). Outside the window:
nothing renders anywhere. WINDOW/MESSAGE never take over and never preempt a game.

## MOMENT stages & slot behavior
| Stage | Window | Behavior |
|---|---|---|
| TEASE | fire_at − tease_min → alert | Ticker gains event lines; a 12s interstitial card joins the signage rotation every ~4 min. Amber. |
| ALERT | fire_at − alert_min → fire_at | Full-screen takeover-style countdown (T-MINUS clock), skin-framed. Inverse-video pulses in final 10s. |
| MOMENT | fire_at → +15s | Payoff animation (launch / outbreak), runs once. |
| EVENT | +15s → +window_min | CTA card holds: title, directive, linked item name + LIVE price (green), LIVE counter: units sold since fire_at ("FUEL CONSUMED: 23"). toast-sync runs at 60s cadence during the window. |
| ALL-CLEAR | +window → +2 min | Resolution card with final tally ("47 DWELLERS FUELED. THE FACILITY SURVIVES."). Then normal rotation. |

Slot resolver priority (updates 09): manual takeover > MOMENT ALERT/MOMENT/EVENT stages >
live game (UNLESS interrupt_game) > MOMENT TEASE interstitials > signage rotation (which
includes any active WINDOW/MESSAGE cards and ★ SCREENS materialization). During an active game
with interrupt_game=false, MOMENT stages render only as ticker lines; WINDOW/MESSAGE cards are
rotation-level so they simply wait out game mode like every other rotation item.

## Counter mechanics
Units = sum of quantities of the linked toast_guid in orders with openedDate within [fire_at, now], voids excluded — reuses toast-sync's order aggregation with an event-scoped filter, cached per-minute into the event row (fields.live_count) so displays read the row via realtime, not the function.

## Skins (template components; same engine)
- **launch:** T-MINUS framing, rocket iconography, 'LAUNCH WINDOW OPEN', 'FUEL UP'.
- **infestation:** hazard stripes, 'BIOLOGICAL ALERT', 'INOCULATION DIRECTIVE: 1 DOSE PER DWELLER', counter = 'DWELLERS INOCULATED'.
- **generic:** neutral alert chrome, all copy from fields.

## Controls (`/signage/events` — EVENTS & PROMOS under BAR OPS, has_module('events'))
Per docs/ux-refinement-mockup.html view 5: list of all events (name, kind badge, schedule
phrase, status incl. ACTIVE NOW / next occurrence / DONE with stats line) + detail editor
(name, kind, window, what-shows fields, optional drink link with live price, interrupt_game
[moment only], status toggle). FIRE NOW (moment: fire_at = now + alert_minutes, skipping tease;
window/message: fire_at = now); ABORT (status=aborted, screens drop to normal instantly);
post-event stats line for toast-linked events (total units, vs. same item's average non-event
night — cheap lift readout for the owner). The Signage Hub's RUNNING & UPCOMING strip rows link
here, and the hub's SCHEDULE A MESSAGE quick action becomes "new MESSAGE event" (replacing the
wave-1 interim behavior of opening the announcement ItemEditor).

## Backlog hook — audio
Venue runs QSYS DSP + Sonos. QSYS supports external control; a future integration fires an audio cue (klaxon / launch rumble) at ALERT start and MOMENT via a tiny relay service. Schema needs nothing now; note only.

## Guardrails
- interrupt_game defaults false; trivia nights untouched unless explicitly chosen. WINDOW/MESSAGE can't interrupt at all.
- Max one MOMENT running per venue at a time (partial unique index on kind='moment' and status='running'). WINDOW/MESSAGE may overlap each other and a moment (they're rotation-level).
- Counter shows only during EVENT/ALL-CLEAR; never implies per-person tracking.
- POS-visibility principle applies: a toast-linked card auto-hides when the item is 86'd or off the POS view (same gate as drink_special).
- Recurrence text in the UI is a plain phrase ("daily · 4:00–7:00 PM", "Mondays 4 PM–close") — a manager must never read cron syntax.
