-- 0047 — media module M1 (docs/15): media library + playlists + slot programs.
-- Date: 2026-07-16. Branch: phase-media-m1.
--
-- Groundwork for the media module (docs/15 "Owner answers — RATIFIED"): the media PC
-- watches a local folder, and the `media-catalog-sync` edge fn (service role, device-token
-- gated) maintains these tables + thumbnails. The web app is a pure realtime READER of them
-- (TVs read anon), exactly like the drinks/signage boards. No cloud video storage — only the
-- lightweight metadata + a thumbnail syncs up.
--
-- Schema is verbatim from docs/15's schema block (media_playlists carries the ratified
-- per-playlist framed/fullbleed `presentation` toggle and NO audio column — audio is always
-- on at the shell, staff routes it at the QSYS/Sonos source). `signage_slots.program jsonb`
-- (null = today's rotation) is the new bottom tier of the slot mode ladder
-- (takeover > MOMENT > live game > PROGRAM).
--
-- ⚠ Grants: Supabase default-privileges GRANT ALL on new public tables to anon/authenticated.
-- This module has been burned by that residue before (0045 note) — every block below strips
-- it and re-grants precisely: anon + authenticated SELECT (unattended TVs read as anon), only
-- authenticated may write, and has_module('signage') gates WHICH rows.
--
-- Thumbnails: written by media-catalog-sync with the SERVICE ROLE (bypasses storage RLS) into
-- the existing PUBLIC `signage` bucket under media-thumbs/{venue_id}/{hash}.jpg. NO storage
-- bucket changes are needed — 0037 already set the signage bucket's allowed_mime_types to
-- include image/jpeg and a 5 MB size limit, which the small jpeg thumbs are well within.
--
-- Idempotent: create table if not exists / add column if not exists / re-runnable
-- grant + policy + publication blocks.

-- ── media_files (the synced library; one row per content-hashed file) ────────────
create table if not exists public.media_files (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid references public.venues not null,
  filename       text not null,             -- relative to the watched folder
  title          text,                      -- editable in the hub; defaults from filename
  hash           text not null,             -- content hash; the playback URL key
  duration_seconds numeric,
  width          int,
  height         int,
  size_bytes     bigint,
  thumb_path     text,                      -- signage bucket path (media-thumbs/{venue}/{hash}.jpg)
  status         text not null default 'present' check (status in ('present','missing','unsupported')),
  added_at       timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (venue_id, hash)
);

-- ── media_playlists (folder auto-playlists + hub-built custom playlists) ──────────
-- source='folder': one auto-playlist per watched subfolder (unique folder_path); folder name
--   = playlist name; ordered by filename; owned by the catalog sync.
-- source='custom': hub-built, folder_path null (SQL NULLs are distinct so many are allowed);
--   NEVER touched by the catalog sync.
-- presentation: ratified per-playlist framed|fullbleed (default framed) — chrome suits
--   archival/odd-ratio material, movies run full frame.
create table if not exists public.media_playlists (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid references public.venues not null,
  name           text not null,
  source         text not null default 'custom' check (source in ('custom','folder')),
  folder_path    text,                      -- for source='folder': the subfolder this mirrors
  presentation   text not null default 'framed' check (presentation in ('framed','fullbleed')),
  shuffle        boolean not null default false,
  created_at     timestamptz default now(),
  unique (venue_id, folder_path)            -- one auto-playlist per folder
);

-- ── media_playlist_items (ordered membership) ────────────────────────────────────
create table if not exists public.media_playlist_items (
  playlist_id    uuid references public.media_playlists on delete cascade not null,
  file_id        uuid references public.media_files on delete cascade not null,
  position       int not null default 0,
  primary key (playlist_id, file_id)
);
create index if not exists idx_media_playlist_items_file on public.media_playlist_items(file_id);

-- ── playlist_venue(playlist_id): the venue a playlist belongs to ─────────────────
-- SECURITY DEFINER so the media_playlist_items write policy can derive venue for has_module()
-- without recursing through media_playlists' own RLS (same idiom as slot_venue in 0045).
create or replace function public.playlist_venue(p_playlist_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select venue_id from public.media_playlists where id = p_playlist_id $$;

grant execute on function public.playlist_venue(uuid) to anon, authenticated;

-- ── RLS: mirror slot_queue (0045) exactly — anon SELECT, has_module('signage') manage ──

-- media_files
alter table public.media_files enable row level security;
revoke all on public.media_files from anon, authenticated;
grant select on public.media_files to anon, authenticated;
grant insert, update, delete on public.media_files to authenticated;

drop policy if exists public_read on public.media_files;
create policy public_read on public.media_files
  for select to anon, authenticated using (true);

drop policy if exists media_files_module_manage on public.media_files;
create policy media_files_module_manage on public.media_files
  for all to authenticated
  using (public.has_module(venue_id, 'signage'))
  with check (public.has_module(venue_id, 'signage'));

-- media_playlists
alter table public.media_playlists enable row level security;
revoke all on public.media_playlists from anon, authenticated;
grant select on public.media_playlists to anon, authenticated;
grant insert, update, delete on public.media_playlists to authenticated;

drop policy if exists public_read on public.media_playlists;
create policy public_read on public.media_playlists
  for select to anon, authenticated using (true);

drop policy if exists media_playlists_module_manage on public.media_playlists;
create policy media_playlists_module_manage on public.media_playlists
  for all to authenticated
  using (public.has_module(venue_id, 'signage'))
  with check (public.has_module(venue_id, 'signage'));

-- media_playlist_items (no venue_id column — derive via playlist_venue definer helper)
alter table public.media_playlist_items enable row level security;
revoke all on public.media_playlist_items from anon, authenticated;
grant select on public.media_playlist_items to anon, authenticated;
grant insert, update, delete on public.media_playlist_items to authenticated;

drop policy if exists public_read on public.media_playlist_items;
create policy public_read on public.media_playlist_items
  for select to anon, authenticated using (true);

drop policy if exists media_playlist_items_module_manage on public.media_playlist_items;
create policy media_playlist_items_module_manage on public.media_playlist_items
  for all to authenticated
  using (public.has_module(public.playlist_venue(playlist_id), 'signage'))
  with check (public.has_module(public.playlist_venue(playlist_id), 'signage'));

-- ── signage_slots.program (null = rotation, today's default) ─────────────────────
-- The programmable bottom tier of the slot mode ladder (docs/15 §Concept: PROGRAMS).
alter table public.signage_slots add column if not exists program jsonb;

-- ── Realtime: TVs live-update on library/playlist changes (same as slot_queue) ────
do $$
declare t text;
begin
  foreach t in array array['media_files', 'media_playlists', 'media_playlist_items']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
