-- 0013 — Realtime publication
-- Source: docs/01 realtime strategy. Subscribe to postgres_changes on these tables;
-- invalidate TanStack Query keys on event; ONE slow (30–60s) poll as a safety net.
-- Idempotent: skip tables already in the publication.

do $$
declare t text;
begin
  foreach t in array array[
    'games','game_teams','scores','rounds','questions','game_display_state',
    'seasons','signage_slots','signage_items','screen_takeovers',
    'scheduled_events','toast_menu_cache'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
