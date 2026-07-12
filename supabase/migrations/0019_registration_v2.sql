-- 0019 — Registration v2 (docs/05): player self-service + PIN join + join requests
--
-- Everything a walk-up player does that touches the teams/team_members tables goes
-- through SECURITY DEFINER RPCs here, so venue_id + pin_hash stay server-controlled
-- (0011 deliberately gives authenticated users NO direct INSERT path into teams).
-- pin_hash is bcrypt via pgcrypto (crypt/gen_salt('bf'), already enabled in 0001) and
-- is NEVER read back to any client — set/verify happen only inside these functions and
-- the verify-team-pin edge fn (service role).
--
-- RLS note (ref 0018): the join-requests policies below use the SECURITY DEFINER
-- helpers is_team_member(team_id) / team_venue(team_id) — never a subquery that
-- re-enters team_members/teams under RLS, which is what caused the 42P17 recursion.

-- ── check_in_team: add editable display_name (mockup's "table name tonight") ──
-- 0012 shipped a 2-arg version that always used the team's canonical name. docs/05
-- + the SHELTER ACCESS PASS ticket require a per-night editable display name. Drop
-- the 2-arg version and recreate with an optional p_display_name (defaults to the
-- team name so existing/host call sites keep working). Everything else is unchanged:
-- security definer, member-OR-staff-OR-service auth, checked_in_by = auth.uid(),
-- atomic zero-score backfill for already-complete rounds.
drop function if exists public.check_in_team(uuid, uuid);

create or replace function public.check_in_team(
  p_game_id uuid,
  p_team_id uuid,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_venue uuid;
  v_team_venue uuid;
  v_is_member  boolean;
  v_is_staff   boolean;
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_name       text;
  v_gt_id      uuid;
begin
  select venue_id into v_game_venue from public.games where id = p_game_id;
  select venue_id into v_team_venue from public.teams where id = p_team_id;

  if v_game_venue is null then raise exception 'game not found'; end if;
  if v_team_venue is null then raise exception 'team not found'; end if;
  if v_game_venue <> v_team_venue then
    raise exception 'team and game belong to different venues';
  end if;

  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.profile_id = auth.uid()
  ) into v_is_member;
  v_is_staff := public.venue_role_at_least(v_game_venue, 'host');

  if not (v_is_member or v_is_staff or v_is_service) then
    raise exception 'not authorized to check in this team';
  end if;

  -- Editable display name; fall back to the team's canonical name. Trim/blank -> name.
  select coalesce(nullif(btrim(p_display_name), ''), t.name)
    into v_name
  from public.teams t where t.id = p_team_id;

  -- Idempotent game_teams insert.
  insert into public.game_teams (game_id, team_id, display_name, checked_in_by)
  select p_game_id, p_team_id, v_name, auth.uid()
  where not exists (
    select 1 from public.game_teams gt
    where gt.game_id = p_game_id and gt.team_id = p_team_id
  )
  returning id into v_gt_id;

  if v_gt_id is null then
    -- Already checked in: keep the original ledger row, but honor an explicit rename.
    select id into v_gt_id from public.game_teams
    where game_id = p_game_id and team_id = p_team_id;
    if nullif(btrim(p_display_name), '') is not null then
      update public.game_teams set display_name = v_name where id = v_gt_id;
    end if;
  end if;

  -- Zero-score backfill: a team joining mid-game gets 0 for rounds already scored.
  insert into public.scores (game_id, round_id, team_id, points)
  select p_game_id, r.id, p_team_id, 0
  from public.rounds r
  where r.game_id = p_game_id
    and r.is_complete = true
    and not exists (
      select 1 from public.scores s
      where s.round_id = r.id and s.team_id = p_team_id
    );

  return v_gt_id;
end;
$$;

grant execute on function public.check_in_team(uuid, uuid, text) to authenticated, service_role;

-- ── create_team_with_captain: player founds a team, becomes captain ──────────
-- NEW_PLAYER "Start a new team". Runs as definer so it can INSERT into teams
-- (players have no direct teams INSERT under 0011) and set venue_id server-side.
-- venue_id is passed by the client but validated to be a real venue — it's not a
-- security boundary (which venue you're standing in is public), only pin_hash /
-- is_regular are, and neither is settable here.
create or replace function public.create_team_with_captain(
  p_venue_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_name      text := btrim(p_name);
  v_team_id   uuid;
begin
  if v_uid is null then raise exception 'must be signed in'; end if;
  if v_name = '' then raise exception 'team name required'; end if;
  if not exists (select 1 from public.venues where id = p_venue_id) then
    raise exception 'unknown venue';
  end if;

  -- Reuse an existing same-name team at this venue if the caller is already on it
  -- (idempotent-ish for a fat-fingered double submit); otherwise create fresh.
  select id into v_team_id from public.teams
  where venue_id = p_venue_id and lower(name) = lower(v_name) and archived = false;

  if v_team_id is not null then
    if not exists (
      select 1 from public.team_members
      where team_id = v_team_id and profile_id = v_uid
    ) then
      raise exception 'a team named "%" already exists here — join it with its PIN', v_name
        using errcode = 'unique_violation';
    end if;
    return v_team_id;
  end if;

  insert into public.teams (venue_id, name, is_regular)
  values (p_venue_id, v_name, false)
  returning id into v_team_id;

  insert into public.team_members (team_id, profile_id, role, added_by)
  values (v_team_id, v_uid, 'captain', v_uid);

  return v_team_id;
end;
$$;

grant execute on function public.create_team_with_captain(uuid, text) to authenticated;

-- ── set_team_pin: captain sets/resets the join PIN (never displays it) ────────
-- Hashed with bcrypt (pgcrypto). Captain-only. p_pin null/'' clears the PIN.
create or replace function public.set_team_pin(
  p_team_id uuid,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pin text := nullif(btrim(coalesce(p_pin, '')), '');
begin
  if v_uid is null then raise exception 'must be signed in'; end if;

  -- Captain of the team, or venue staff (host+) as an escape hatch.
  if not (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = p_team_id and tm.profile_id = v_uid and tm.role = 'captain'
    )
    or public.venue_role_at_least(public.team_venue(p_team_id), 'host')
  ) then
    raise exception 'only the team captain (or venue staff) can set the PIN';
  end if;

  if v_pin is not null and v_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4–6 digits';
  end if;

  -- pgcrypto (crypt/gen_salt) lives in the `extensions` schema on Supabase; this
  -- definer function pins search_path=public, so schema-qualify the bcrypt calls.
  update public.teams
    set pin_hash = case when v_pin is null then null else extensions.crypt(v_pin, extensions.gen_salt('bf')) end
  where id = p_team_id;
end;
$$;

grant execute on function public.set_team_pin(uuid, text) to authenticated;

-- ── redeem_team_pin: service-role-only PIN compare + membership grant ─────────
-- Called ONLY by the verify-team-pin edge fn (service role) after it has rate-limited
-- the caller by IP+team. The plaintext PIN never touches a client SELECT and pin_hash
-- never leaves the DB — the bcrypt compare happens here. p_profile_id is the verified
-- caller (the edge fn derives it from the JWT; service role has no auth.uid()).
create or replace function public.redeem_team_pin(
  p_team_id uuid,
  p_pin text,
  p_profile_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'redeem_team_pin is service-role only';
  end if;

  select pin_hash into v_hash from public.teams where id = p_team_id and archived = false;
  if v_hash is null then
    return false; -- no team, or no PIN set → cannot join by PIN
  end if;

  if extensions.crypt(coalesce(p_pin, ''), v_hash) <> v_hash then
    return false;
  end if;

  insert into public.team_members (team_id, profile_id, role, added_by)
  values (p_team_id, p_profile_id, 'member', p_profile_id)
  on conflict (team_id, profile_id) do nothing;

  return true;
end;
$$;

grant execute on function public.redeem_team_pin(uuid, text, uuid) to service_role;

-- ── pin_attempts: IP+team rate-limit ledger for the edge fn (service role) ────
create table if not exists public.pin_attempts (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams on delete cascade,
  ip         text not null,
  succeeded  boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_pin_attempts_team_ip_time
  on public.pin_attempts (team_id, ip, created_at desc);

alter table public.pin_attempts enable row level security;
-- No anon/authenticated policy: only the service role (edge fn) reads/writes this.
-- Supabase's default privileges grant new public tables to anon+authenticated; strip
-- them so this ledger is service-role-only in privilege as well as in policy (0011 pattern).
revoke all on public.pin_attempts from anon, authenticated;

-- ── team_join_requests: NEW_PLAYER "ask a teammate to add you" (approval path) ─
-- DECISION (docs/05 path a): Phase 2 records the pending request + provides the
-- approve RPC; the captain-facing approval UI lives in the portal (docs/07, Phase 4)
-- because it needs the portal's pending-list / notifications. PIN join (path b) is
-- the fully-wired Phase 2 join and the acceptance gate.
create table if not exists public.team_join_requests (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams on delete cascade,
  profile_id uuid not null references public.profiles on delete cascade,
  status     text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles,
  unique (team_id, profile_id)
);
create index if not exists idx_join_requests_team on public.team_join_requests(team_id);

alter table public.team_join_requests enable row level security;
-- Reset Supabase's default-privilege grab, then grant only what the policies use:
-- authenticated reads (RLS-gated) + inserts its own pending row. No anon; no direct
-- UPDATE/DELETE (approve/decline go through approve_join_request). service_role bypasses.
revoke all on public.team_join_requests from anon, authenticated;
grant select, insert on public.team_join_requests to authenticated;

-- Requester sees their own requests; existing team members + venue staff see the
-- team's incoming requests. Helpers = no recursion (0018).
drop policy if exists join_requests_select on public.team_join_requests;
create policy join_requests_select on public.team_join_requests
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_team_member(team_id)
    or public.venue_role_at_least(public.team_venue(team_id), 'staff')
  );

-- A signed-in player may only create a pending request for themselves.
drop policy if exists join_requests_insert_self on public.team_join_requests;
create policy join_requests_insert_self on public.team_join_requests
  for insert to authenticated
  with check (profile_id = auth.uid() and status = 'pending');

-- request_team_join: create/refresh my pending request to join a team by name search.
create or replace function public.request_team_join(p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'must be signed in'; end if;
  if not exists (select 1 from public.teams where id = p_team_id and archived = false) then
    raise exception 'team not found';
  end if;
  if public.is_team_member(p_team_id) then
    raise exception 'you are already on this team';
  end if;

  insert into public.team_join_requests (team_id, profile_id, status)
  values (p_team_id, v_uid, 'pending')
  on conflict (team_id, profile_id)
    do update set status = 'pending', created_at = now(), decided_at = null, decided_by = null
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.request_team_join(uuid) to authenticated;

-- approve_join_request: an existing team member accepts a pending request. Portal
-- (Phase 4) is the UI; the RPC exists now so the model is complete + atomic.
create or replace function public.approve_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.team_join_requests%rowtype;
begin
  if v_uid is null then raise exception 'must be signed in'; end if;
  select * into v_req from public.team_join_requests where id = p_request_id;
  if v_req.id is null then raise exception 'request not found'; end if;

  if not (
    public.is_team_member(v_req.team_id)
    or public.venue_role_at_least(public.team_venue(v_req.team_id), 'staff')
  ) then
    raise exception 'only a team member (or venue staff) can approve';
  end if;

  insert into public.team_members (team_id, profile_id, role, added_by)
  values (v_req.team_id, v_req.profile_id, 'member', v_uid)
  on conflict (team_id, profile_id) do nothing;

  update public.team_join_requests
    set status = 'approved', decided_at = now(), decided_by = v_uid
  where id = p_request_id;
end;
$$;

grant execute on function public.approve_join_request(uuid) to authenticated;

-- ── team_has_pin: does this team have a join PIN? (boolean only — never the hash) ─
-- Lets the captain/staff editor show "PIN: SET / NOT SET" without exposing pin_hash,
-- which stays locked out of every client SELECT (0011).
create or replace function public.team_has_pin(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select pin_hash is not null from public.teams where id = p_team_id;
$$;

grant execute on function public.team_has_pin(uuid) to authenticated;

-- ── team_roster: membership visible to team members + venue staff ─────────────
-- profiles_select_own (0011) only lets a user read their OWN profile, so staff can't
-- join team_members→profiles to see who's on a team. This definer RPC returns the
-- roster (name/email/role) to members and staff only. No pin_hash, no cross-team leak.
create or replace function public.team_roster(p_team_id uuid)
returns table (
  profile_id   uuid,
  display_name text,
  email        text,
  role         text,
  joined_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.is_team_member(p_team_id)
    or public.venue_role_at_least(public.team_venue(p_team_id), 'staff')
  ) then
    raise exception 'not authorized to view this roster';
  end if;

  return query
    select tm.profile_id, p.display_name, p.email, tm.role, tm.created_at
    from public.team_members tm
    join public.profiles p on p.id = tm.profile_id
    where tm.team_id = p_team_id
    order by (tm.role = 'captain') desc, tm.created_at;
end;
$$;

grant execute on function public.team_roster(uuid) to authenticated;
