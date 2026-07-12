-- 0014 — Seed: the single venue (Bunker Club)
-- Source: docs/10 Phase 0 ("Seed: 1 venue row, venue_staff rows for Stephen (admin)
-- + Ronnie (host)"). venue_staff can't be seeded here — it references profiles,
-- which reference auth.users that don't exist until Stephen and Ronnie sign in
-- (email OTP). Seed venue_staff after they authenticate, via scripts/seed-staff.ts.
--
-- Fixed venue id so migrations, scripts, and env config can reference it stably.

insert into public.venues (id, name, slug, timezone)
values ('11111111-1111-1111-1111-111111111111', 'Bunker Club', 'bunker-club', 'America/Chicago')
on conflict (id) do nothing;
