-- 0043 — Per-day sales history + SMART TOAST slides (owner ask: "always rotate the
-- bottom 3 selling drinks over the last 7 days of a menu group" + "top selling drink of
-- last month, with tonight's top 3 beneath").
--
-- The Top Sellers slide (0036) only ever knows TODAY (sales_cache is a same-day snapshot,
-- overwritten each sync). To answer "last 7 days" / "last month" the display needs a
-- durable per-(day, item) sales log. `sales_history` is that log — the scheduled toast-sync
-- (0020, AUTH-1 b: the ONLY thing that talks to Toast) upserts each day's per-item counts
-- into it every run, and a one-time backfill sweeps ~92 past business dates so "last month"
-- is truthful from day one. The new `smart_toast` signage template reads it with the anon key.
--
-- Sales counts are ALREADY public via sales_cache (the TVs read them), so anon/authenticated
-- may SELECT here too. Writes are service-role ONLY (the sync owns the table — no staff/anon
-- write policy). No realtime: the slide polls at 60s (within the display-rules fallback-poll
-- allowance); realtime would mean adding it to the publication for no benefit.

-- ── sales_history ─────────────────────────────────────────────────────────────
-- One row per (venue, business date, Toast item). `quantity` is that item's units sold on
-- that business date, computed the SAME way toast-sync computes sales_cache counts (skip
-- excessFood orders + voided selections) so a charting item's history quantity reconciles
-- exactly with its sales_cache.sales_count for the same day.
create table if not exists public.sales_history (
  venue_id      uuid    not null references public.venues on delete cascade,
  business_date text    not null,             -- 'YYYYMMDD' (venue TZ + closeout), like sales_cache
  toast_guid    text    not null,             -- Toast item guid
  name          text,                         -- displayName at time of sale (fallback label)
  menu_group    text,                         -- Toast item-group name (informational; joins are by guid)
  quantity      int     not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (venue_id, business_date, toast_guid)
);
-- The smart slides scan a date-range window per venue, then aggregate by guid.
create index if not exists idx_sales_history_window on public.sales_history(venue_id, business_date);

alter table public.sales_history enable row level security;

-- Reset Supabase's default-privilege grab on the new table (0011/0020/0042 pattern), then
-- grant ONLY select to anon/authenticated. Writes go through the service-role sync (bypasses
-- RLS); there is deliberately NO write policy — the table is sync-owned. (Grant residue on a
-- new public table has been a merge BLOCKER before — PR #13 F1; strip it here and verify via
-- information_schema.role_table_grants after apply.)
revoke all on public.sales_history from anon, authenticated;
grant select on public.sales_history to anon, authenticated;

drop policy if exists sales_history_public_read on public.sales_history;
create policy sales_history_public_read on public.sales_history
  for select to anon, authenticated using (true);

-- ── signage_items template constraint: add 'smart_toast' (same idiom as 0036/0042) ──
-- Idempotent: drop the current CHECK and re-add it with 'smart_toast' included (keeping every
-- existing member — drink_special/event/announcement/image_only/celebration/top_sellers/instagram).
alter table public.signage_items
  drop constraint if exists signage_items_template_check;
alter table public.signage_items
  add constraint signage_items_template_check
  check (template in ('drink_special','event','announcement','image_only','celebration','top_sellers','instagram','smart_toast'));

-- ── NOTE-5 (PR #34): harden the Instagram Vault token wrappers ────────────────
-- The reviewer asked that the next migration touching this area recreate
-- instagram_token_get/set with `set search_path = ''` + fully-qualified names (defense in
-- depth for SECURITY DEFINER functions — an empty search_path can't be shadowed by a
-- caller-controlled schema on the path). Behavior is IDENTICAL to 0042: every reference was
-- already vault-qualified, so pinning the path to '' changes nothing at runtime. Grants are
-- re-asserted (service_role-only execute) so neither anon nor authenticated can read the token.
create or replace function public.instagram_token_get()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'instagram_token' limit 1;
$$;

create or replace function public.instagram_token_set(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'instagram_token' limit 1;
  if v_id is null then
    perform vault.create_secret(p_token, 'instagram_token');
  else
    perform vault.update_secret(v_id, p_token);
  end if;
end;
$$;

revoke all on function public.instagram_token_get()      from public, anon, authenticated;
revoke all on function public.instagram_token_set(text)  from public, anon, authenticated;
grant execute on function public.instagram_token_get()     to service_role;
grant execute on function public.instagram_token_set(text) to service_role;
