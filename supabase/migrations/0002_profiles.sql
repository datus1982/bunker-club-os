-- 0002 — Profiles (1:1 with auth.users) + auto-insert trigger
-- Source: docs/02 (Core / tenancy).

create table if not exists public.profiles (
  id                uuid primary key references auth.users on delete cascade,
  display_name      text,
  email             text,
  phone             text,
  marketing_opt_in  boolean not null default false,
  created_at        timestamptz default now()
);

-- Insert a profile row whenever an auth user is created (email OTP players +
-- staff both flow through here). display_name/email seeded from the auth row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
