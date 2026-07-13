-- 0027 — Make admin_list_staff reject non-admins consistently (Phase 4c review fix)
-- 0025's admin_upsert_staff / admin_remove_staff RAISE 'not authorized' when the caller
-- isn't a venue admin, but admin_list_staff (a pure-SQL function) instead silently
-- returned an empty set — an inconsistency (no data leak, but a confusing non-error).
-- Recreate it as plpgsql so it raises the same 'not authorized' error as its siblings.
-- Body is otherwise identical to 0025: same columns, same order, SECURITY DEFINER,
-- search_path=public, PUBLIC/anon execute revoked, authenticated-only.

create or replace function public.admin_list_staff(p_venue uuid)
returns table(profile_id uuid, email text, role text, modules text[], is_self boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.venue_role_at_least(p_venue, 'admin') then
    raise exception 'not authorized';
  end if;
  return query
    select vs.profile_id, u.email::text, vs.role, vs.modules, (vs.profile_id = auth.uid())
    from public.venue_staff vs
    join auth.users u on u.id = vs.profile_id
    where vs.venue_id = p_venue
    order by (vs.role = 'admin') desc, u.email;
end;
$$;

revoke all on function public.admin_list_staff(uuid) from public, anon;
grant execute on function public.admin_list_staff(uuid) to authenticated;
