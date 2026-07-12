-- 0003 — venue_staff + role helper
-- Source: docs/02. Roles are venue-scoped in a table (NOT auth app_metadata) so
-- the model stays multi-venue for a future SaaS (docs/01 Auth & roles).

create table if not exists public.venue_staff (
  venue_id   uuid not null references public.venues,
  profile_id uuid not null references public.profiles,
  role       text not null check (role in ('admin','host','staff')),
  created_at timestamptz default now(),
  primary key (venue_id, profile_id)
);

-- Central role check used by every RLS policy. security definer so policies can
-- read venue_staff without granting anon/authenticated table access to it.
-- roles=null means "any staff role".
create or replace function public.has_venue_role(p_venue uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.venue_staff vs
    where vs.profile_id = auth.uid()
      and vs.venue_id = p_venue
      and (p_roles is null or vs.role = any (p_roles))
  );
$$;

-- Convenience: admin implies host implies staff for authorization purposes.
-- (Explicit rows are still the source of truth; this only expands a required
-- minimum role into the set that satisfies it.)
create or replace function public.venue_role_at_least(p_venue uuid, p_min_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_venue_role(
    p_venue,
    case p_min_role
      when 'staff' then array['staff','host','admin']
      when 'host'  then array['host','admin']
      when 'admin' then array['admin']
      else array[p_min_role]
    end
  );
$$;
