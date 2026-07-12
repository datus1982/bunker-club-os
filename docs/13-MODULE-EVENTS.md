# 13 — Module: Scheduled Event Choreography (backlog — Phase 7)

## Concept
Scheduled, multi-stage theatrical events broadcast across all slots, tied to a Toast item (batch shots: Rocket Sauce, Green Tea). Distinct from takeovers (manual/instant): events are a timed ARC — tease → alert → moment → event window → all-clear — with a LIVE SALES COUNTER during the window (orders for the linked item, counted in near-real-time via the existing toast-sync order pull).

## Schema
```sql
create table scheduled_events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues not null,
  name text not null,                       -- 'Midnight Launch'
  skin text not null default 'launch' check (skin in ('launch','infestation','generic')),
  fields jsonb not null default '{}',       -- title, directive, cta, flavor lines
  toast_guid text references toast_menu_cache, -- linked product (price + counter source)
  fire_at timestamptz,                      -- next occurrence (recomputed on completion)
  recurrence jsonb,                         -- { daysOfWeek:['FR','SA'], time:'00:00' } | null = one-shot
  tease_minutes int not null default 60,
  alert_minutes int not null default 5,
  window_minutes int not null default 30,
  interrupt_game boolean not null default false,  -- trivia is sacred by default
  status text not null default 'scheduled' check (status in ('scheduled','running','completed','aborted','disabled'))
);
```
Stage is DERIVED from now() vs fire_at + durations (no stage column to desync). A pg_cron tick (1/min) flips status and recomputes next fire_at from recurrence on completion.

## Stages & slot behavior
| Stage | Window | Behavior |
|---|---|---|
| TEASE | fire_at − tease_min → alert | Ticker gains event lines; a 12s interstitial card joins the signage rotation every ~4 min. Amber. |
| ALERT | fire_at − alert_min → fire_at | Full-screen takeover-style countdown (T-MINUS clock), skin-framed. Inverse-video pulses in final 10s. |
| MOMENT | fire_at → +15s | Payoff animation (launch / outbreak), runs once. |
| EVENT | +15s → +window_min | CTA card holds: title, directive, linked item name + LIVE price (green), LIVE counter: units sold since fire_at ("FUEL CONSUMED: 23"). toast-sync runs at 60s cadence during the window. |
| ALL-CLEAR | +window → +2 min | Resolution card with final tally ("47 DWELLERS FUELED. THE FACILITY SURVIVES."). Then normal rotation. |

Slot resolver priority (updates 09): manual takeover > event ALERT/MOMENT/EVENT stages > live game (UNLESS interrupt_game) > event TEASE interstitials > signage rotation. During an active game with interrupt_game=false, event stages render only as ticker lines.

## Counter mechanics
Units = sum of quantities of the linked toast_guid in orders with openedDate within [fire_at, now], voids excluded — reuses toast-sync's order aggregation with an event-scoped filter, cached per-minute into the event row (fields.live_count) so displays read the row via realtime, not the function.

## Skins (template components; same engine)
- **launch:** T-MINUS framing, rocket iconography, 'LAUNCH WINDOW OPEN', 'FUEL UP'.
- **infestation:** hazard stripes, 'BIOLOGICAL ALERT', 'INOCULATION DIRECTIVE: 1 DOSE PER DWELLER', counter = 'DWELLERS INOCULATED'.
- **generic:** neutral alert chrome, all copy from fields.

## Controls (/signage events tab, staff role)
Schedule/edit; FIRE NOW (sets fire_at = now + alert_minutes, skipping tease); ABORT (status=aborted, screens drop to normal instantly); post-event stats line (total units, vs. same item's average non-event night — cheap lift readout for the owner).

## Backlog hook — audio
Venue runs QSYS DSP + Sonos. QSYS supports external control; a future integration fires an audio cue (klaxon / launch rumble) at ALERT start and MOMENT via a tiny relay service. Schema needs nothing now; note only.

## Guardrails
- interrupt_game defaults false; trivia nights untouched unless explicitly chosen.
- Max one event running per venue at a time (partial unique index on status='running').
- Counter shows only during EVENT/ALL-CLEAR; never implies per-person tracking.
