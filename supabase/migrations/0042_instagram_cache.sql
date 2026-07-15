-- 0042 — Instagram rotation card (owner ask: "recent IG posts/stories on a slide,
-- how many recent posts, the caption, a QR to the post").
--
-- Sibling of the Toast mirror (0020/0034): an edge fn (instagram-sync) pulls the venue's
-- own @bunkerclubokc posts + active stories via the Instagram Graph API and mirrors the
-- (expiring) CDN images into our `signage` bucket, so the TVs never depend on Instagram's
-- CDN. This table is the cache the display reads; a new `instagram` signage template
-- renders one post per rotation pass with the caption + a QR to the permalink.
--
-- Content is ALREADY-PUBLIC Instagram content (captions, permalinks, photos) — so anon can
-- read the cache (mirrors the toast_menu_cache/public_menu precedent: the TVs read it with
-- the anon key). Writes are service-role ONLY (the sync owns the table — no staff write
-- policy). The access TOKEN is never in this table; it lives in Vault (see below).

-- ── instagram_cache ─────────────────────────────────────────────────────────
create table if not exists public.instagram_cache (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues on delete cascade,
  media_id      text not null unique,            -- Instagram media id (idempotent upsert key)
  media_type    text,                            -- IMAGE | VIDEO | CAROUSEL_ALBUM
  is_story      boolean not null default false,  -- true = an active story (expires in 24h)
  caption       text,                            -- post caption (null for stories)
  permalink     text not null,                   -- the QR target (public post URL)
  username      text,                            -- e.g. bunkerclubokc
  posted_at     timestamptz not null,            -- media timestamp
  storage_path  text,                            -- mirrored image path in the `signage` bucket
  expires_at    timestamptz,                     -- stories: posted_at + 24h; null for posts
  fetched_at    timestamptz not null default now()
);
create index if not exists idx_instagram_cache_venue on public.instagram_cache(venue_id, is_story, posted_at desc);

alter table public.instagram_cache enable row level security;

-- Reset Supabase's default-privilege grab on the new table (0011/0020 pattern), then grant
-- ONLY select to anon/authenticated. Writes go through the service-role sync (bypasses RLS);
-- there is deliberately NO write policy for anon/authenticated — the cache is sync-owned.
-- (Grant residue on a signage table was a past merge BLOCKER — PR #13 F1; strip it here.)
revoke all on public.instagram_cache from anon, authenticated;
grant select on public.instagram_cache to anon, authenticated;

drop policy if exists instagram_cache_public_read on public.instagram_cache;
create policy instagram_cache_public_read on public.instagram_cache
  for select to anon, authenticated using (true);

-- ── signage_items template constraint: add 'instagram' (same idiom as 0036) ──
-- Idempotent: drop the current CHECK and re-add it with 'instagram' included.
alter table public.signage_items
  drop constraint if exists signage_items_template_check;
alter table public.signage_items
  add constraint signage_items_template_check
  check (template in ('drink_special','event','announcement','image_only','celebration','top_sellers','instagram'));

-- ── Vault-backed token storage the edge fn can READ AND WRITE ────────────────
-- DECISION: the Instagram access token lives in Vault (secret name 'instagram_token'),
-- NOT in edge-fn secrets, because the refresh cron must WRITE the rotated 60-day token
-- back to storage — and an edge function cannot update its own secrets. Two SECURITY
-- DEFINER wrappers give the service-role sync a get/set path; execute is service_role-only
-- so neither anon nor authenticated (nor a leaked JWT) can ever read the token via PostgREST.
-- The secret VALUE is seeded out-of-band (never in this committed migration):
--   select vault.create_secret('<INSTAGRAM_ACCESS_TOKEN>', 'instagram_token');
create or replace function public.instagram_token_get()
returns text
language sql
security definer
set search_path = vault, public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'instagram_token' limit 1;
$$;

create or replace function public.instagram_token_set(p_token text)
returns void
language plpgsql
security definer
set search_path = vault, public
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

-- ── pg_cron schedule (Vault-read pattern, like toast-sync in 0020) ───────────
-- instagram-sync every 15 min. The command reads the shared CRON_SECRET from Vault by NAME
-- (no literal here — committable + reproducible). Populate it out-of-band (same value as the
-- CRON_SECRET edge-fn secret; already seeded for toast-sync):
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
do $$
declare fn_base text := 'https://ysrqvdutayirpoibdlbf.supabase.co/functions/v1';
begin
  perform cron.schedule('instagram-sync-15m', '*/15 * * * *', format($cmd$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
      body := '{}'::jsonb
    );
  $cmd$, fn_base || '/instagram-sync'));
exception when undefined_function or invalid_schema_name then
  raise notice 'pg_cron/pg_net not ready — schedule instagram-sync manually';
end $$;
