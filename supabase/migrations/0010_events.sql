-- 0010 — Scheduled Event Choreography
-- Source: docs/13. Schema ships now (Phase 0); the module builds in Phase 7.
-- Stage (TEASE/ALERT/MOMENT/EVENT/ALL-CLEAR) is DERIVED from now() vs fire_at +
-- durations — no stage column to desync. A pg_cron tick flips status and recomputes
-- fire_at from recurrence on completion (built in Phase 7).

create table if not exists public.scheduled_events (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references public.venues,
  name           text not null,                            -- 'Midnight Launch'
  skin           text not null default 'launch'
                   check (skin in ('launch','infestation','generic')),
  fields         jsonb not null default '{}',              -- title, directive, cta, flavor, live_count cache
  toast_guid     text references public.toast_menu_cache,  -- linked product (price + counter source)
  fire_at        timestamptz,                              -- next occurrence (recomputed on completion)
  recurrence     jsonb,                                    -- { daysOfWeek:['FR','SA'], time:'00:00' } | null = one-shot
  tease_minutes  int not null default 60,
  alert_minutes  int not null default 5,
  window_minutes int not null default 30,
  interrupt_game boolean not null default false,           -- trivia is sacred by default
  status         text not null default 'scheduled'
                   check (status in ('scheduled','running','completed','aborted','disabled')),
  created_at     timestamptz default now()
);
create index if not exists idx_scheduled_events_venue on public.scheduled_events(venue_id, status);

-- At most one event running per venue at a time (docs/13 guardrail).
create unique index if not exists uniq_one_running_event_per_venue
  on public.scheduled_events(venue_id)
  where status = 'running';
