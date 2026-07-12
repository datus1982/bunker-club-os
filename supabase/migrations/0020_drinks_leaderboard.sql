-- 0020 — Top-selling drinks leaderboard (docs/08, Phase 3)
--
-- Port of the legacy top-selling-drinks board, redesigned per AUTH-1 option (b):
-- a SCHEDULED edge function (toast-sync) is the ONLY thing that talks to Toast. It
-- writes sales_cache; the /drinks display is a pure realtime READER of the table and
-- never invokes the function. No unauthenticated function-invocation path exists, so
-- public screens can't trigger Toast API spam (the legacy bug).
--
-- SEC-3: Toast clientId/secret/restaurantGuid live ONLY in edge-fn secrets. The tables
-- here hold non-secret display config + cached results. Nothing here is a credential.

-- pg_cron schedules the sync; pg_net lets the cron job POST to the edge function.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── sales_cache: the board's data, one row per (group, rank), refreshed each sync ──
create table if not exists public.sales_cache (
  venue_id         uuid    not null references public.venues on delete cascade,
  menu_group_guid  text    not null,             -- Toast menu-group guid, or 'MAIN_MENU_ALL'
  business_date    text    not null,             -- YYYYMMDD the figures are for (venue TZ)
  rank             int     not null,             -- 1..5
  item_guid        text,
  item_name        text    not null,
  price            numeric not null default 0,
  sales_count      int     not null default 0,
  sales_percentage numeric not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (venue_id, menu_group_guid, rank)
);

-- ── drinks_menu_groups: which groups the display rotates through, and in what order ──
create table if not exists public.drinks_menu_groups (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references public.venues on delete cascade,
  toast_menu_guid text not null,                 -- group guid, or 'MAIN_MENU_ALL' for overall
  name           text not null,                  -- label shown on the board
  enabled        boolean not null default true,
  display_order  int not null default 0,
  created_at     timestamptz default now(),
  unique (venue_id, toast_menu_guid)
);
create index if not exists idx_drinks_groups_venue on public.drinks_menu_groups(venue_id, enabled, display_order);

-- ── drinks_available_groups: menu groups discovered from Toast (admin picks from these) ──
-- Written by the sync each run so the admin config page never has to call Toast directly.
create table if not exists public.drinks_available_groups (
  venue_id        uuid not null references public.venues on delete cascade,
  toast_menu_guid text not null,
  name            text not null,
  menu_name       text,
  updated_at      timestamptz default now(),
  primary key (venue_id, toast_menu_guid)
);

-- ── drinks_display_config: singleton per venue — header/footer/rotation prefs ──
create table if not exists public.drinks_display_config (
  venue_id           uuid primary key references public.venues on delete cascade,
  header_text        text not null default 'TODAY''S TOP DRINKS',
  footer_text        text not null default '■ ONLINE  ·  SHELTER AUTHORITY CERTIFIED',
  display_mode       text not null default 'rotate' check (display_mode in ('rotate','single')),
  auto_rotate_seconds int not null default 10,
  refresh_interval   int not null default 60,    -- sync cadence hint (display shows staleness)
  updated_at         timestamptz default now()
);

-- ── RLS: displays read (anon), staff manage config, only service role writes cache ──
alter table public.sales_cache            enable row level security;
alter table public.drinks_menu_groups     enable row level security;
alter table public.drinks_available_groups enable row level security;
alter table public.drinks_display_config  enable row level security;

-- Reset Supabase's default-privilege grab on the new tables (0011 pattern), then grant
-- exactly what each role needs.
revoke all on public.sales_cache            from anon, authenticated;
revoke all on public.drinks_menu_groups     from anon, authenticated;
revoke all on public.drinks_available_groups from anon, authenticated;
revoke all on public.drinks_display_config  from anon, authenticated;

-- Public display data: anon + authenticated may READ (safe on an unattended screen).
grant select on public.sales_cache           to anon, authenticated;
grant select on public.drinks_menu_groups    to anon, authenticated;
grant select on public.drinks_display_config to anon, authenticated;
-- Staff manage the display config (INSERT/UPDATE/DELETE via policies below).
grant insert, update, delete on public.drinks_menu_groups    to authenticated;
grant insert, update, delete on public.drinks_display_config to authenticated;
-- Available-groups picker is a staff-only surface.
grant select on public.drinks_available_groups to authenticated;

-- sales_cache + available_groups are written ONLY by the service-role sync (bypasses RLS);
-- no authenticated/anon write policy on purpose.
drop policy if exists sales_cache_public_read on public.sales_cache;
create policy sales_cache_public_read on public.sales_cache
  for select to anon, authenticated using (true);

drop policy if exists drinks_groups_public_read on public.drinks_menu_groups;
create policy drinks_groups_public_read on public.drinks_menu_groups
  for select to anon, authenticated using (true);

drop policy if exists drinks_groups_staff_manage on public.drinks_menu_groups;
create policy drinks_groups_staff_manage on public.drinks_menu_groups
  for all to authenticated
  using (public.venue_role_at_least(venue_id, 'staff'))
  with check (public.venue_role_at_least(venue_id, 'staff'));

drop policy if exists drinks_config_public_read on public.drinks_display_config;
create policy drinks_config_public_read on public.drinks_display_config
  for select to anon, authenticated using (true);

drop policy if exists drinks_config_staff_manage on public.drinks_display_config;
create policy drinks_config_staff_manage on public.drinks_display_config
  for all to authenticated
  using (public.venue_role_at_least(venue_id, 'staff'))
  with check (public.venue_role_at_least(venue_id, 'staff'));

drop policy if exists drinks_available_staff_read on public.drinks_available_groups;
create policy drinks_available_staff_read on public.drinks_available_groups
  for select to authenticated
  using (public.venue_role_at_least(venue_id, 'staff'));

-- ── Realtime: displays subscribe to sales_cache + config changes (no polling, ARCH-1) ──
do $$
begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if found then
    execute 'alter publication supabase_realtime add table public.sales_cache';
    execute 'alter publication supabase_realtime add table public.drinks_menu_groups';
    execute 'alter publication supabase_realtime add table public.drinks_display_config';
  end if;
exception when duplicate_object then null;
end $$;

-- ── Seed the singleton display config for the Bunker Club venue ──
insert into public.drinks_display_config (venue_id)
values ('11111111-1111-1111-1111-111111111111')
on conflict (venue_id) do nothing;
