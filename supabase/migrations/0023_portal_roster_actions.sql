-- 0023 — Portal roster actions (docs/07): captain-only remove member
--
-- team_members has no captain-scoped DELETE policy (0011/0018 give only staff manage +
-- self/staff insert). The portal needs a captain to remove a teammate, so expose it as a
-- SECURITY DEFINER RPC with an explicit captain-or-staff check. Guard against orphaning the
-- team (never remove the last captain). Add-member-by-email is a separate edge fn (needs to
-- mint a claimable auth user); PIN set/reset already exists (set_team_pin, 0019).

create or replace function public.remove_team_member(p_team_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_is_staff  boolean := public.venue_role_at_least(public.team_venue(p_team_id), 'staff');
  v_is_captain boolean;
  v_target_role text;
  v_captain_count int;
begin
  if v_uid is null then raise exception 'must be signed in'; end if;

  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.profile_id = v_uid and tm.role = 'captain'
  ) into v_is_captain;

  if not (v_is_captain or v_is_staff) then
    raise exception 'only the team captain (or venue staff) can remove members';
  end if;

  select role into v_target_role from public.team_members
  where team_id = p_team_id and profile_id = p_profile_id;
  if v_target_role is null then
    raise exception 'that person is not on this team';
  end if;

  -- Never leave the team without a captain.
  if v_target_role = 'captain' then
    select count(*) into v_captain_count from public.team_members
    where team_id = p_team_id and role = 'captain';
    if v_captain_count <= 1 then
      raise exception 'cannot remove the only captain — transfer the captain role first';
    end if;
  end if;

  delete from public.team_members where team_id = p_team_id and profile_id = p_profile_id;
end;
$$;

revoke execute on function public.remove_team_member(uuid, uuid) from public, anon;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;
