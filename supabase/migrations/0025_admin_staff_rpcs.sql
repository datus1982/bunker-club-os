-- 0025 — Admin staff-management RPCs for the USERS tile (Phase 4b)
-- All SECURITY DEFINER + admin-gated. Definer so the page can (a) read staff emails
-- (auth.users isn't client-readable) and (b) write venue_staff without depending on
-- column grants — the admin check lives inside each function.

-- List every staffer at a venue with their email, role, grants, and a self flag.
create or replace function public.admin_list_staff(p_venue uuid)
returns table(profile_id uuid, email text, role text, modules text[], is_self boolean)
language sql
stable
security definer
set search_path = public
as $$
  select vs.profile_id, u.email::text, vs.role, vs.modules, (vs.profile_id = auth.uid())
  from public.venue_staff vs
  join auth.users u on u.id = vs.profile_id
  where vs.venue_id = p_venue
    and public.venue_role_at_least(p_venue, 'admin')
  order by (vs.role = 'admin') desc, u.email;
$$;

-- Add or update a staffer by email + role + module grants. The person must already
-- have an account (one OTP sign-in) — a cold-email claimable invite (edge fn, like
-- invite-team-member) is a follow-up. Idempotent on (venue, profile).
create or replace function public.admin_upsert_staff(
  p_venue uuid, p_email text, p_role text, p_modules text[]
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid;
begin
  if not public.venue_role_at_least(p_venue, 'admin') then
    raise exception 'not authorized';
  end if;
  if p_role not in ('admin','host','staff') then
    raise exception 'invalid role';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then
    raise exception 'No account for % yet — have them sign in once with an email code, then add them.', p_email;
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Account for % has no profile yet — have them finish signing in once first.', p_email;
  end if;
  insert into public.venue_staff (venue_id, profile_id, role, modules)
    values (p_venue, v_uid, p_role, coalesce(p_modules, '{}'))
    on conflict (venue_id, profile_id)
    do update set role = excluded.role, modules = excluded.modules;
  return v_uid::text;
end;
$$;

-- Remove a staffer. Admin-only; you cannot remove yourself (guards the last admin out).
create or replace function public.admin_remove_staff(p_venue uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.venue_role_at_least(p_venue, 'admin') then
    raise exception 'not authorized';
  end if;
  if p_profile = auth.uid() then
    raise exception 'you cannot remove yourself';
  end if;
  delete from public.venue_staff where venue_id = p_venue and profile_id = p_profile;
end;
$$;

revoke all on function public.admin_list_staff(uuid) from public, anon;
revoke all on function public.admin_upsert_staff(uuid, text, text, text[]) from public, anon;
revoke all on function public.admin_remove_staff(uuid, uuid) from public, anon;
grant execute on function public.admin_list_staff(uuid) to authenticated;
grant execute on function public.admin_upsert_staff(uuid, text, text, text[]) to authenticated;
grant execute on function public.admin_remove_staff(uuid, uuid) to authenticated;
