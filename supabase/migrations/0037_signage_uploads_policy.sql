-- 0037 — Module-gated storage writes for custom signage/event image uploads.
--
-- Phase 8 (custom image upload for events + signage items). Staff pick a local file that
-- the client resizes/re-encodes (EXIF-stripped) and uploads to the PUBLIC-read `signage`
-- bucket under `uploads/{venue_id}/{uuid}.jpg`.
--
-- 0017 granted ANY `venue_staff` member INSERT/UPDATE across the whole `signage` bucket
-- (a coarse gate — a staffer with no signage/events grant could still write). The owner's
-- module-grant model (0024) wants least privilege: a manager handed ONLY the events module
-- must be able to upload an event image, and a staffer with neither module must not write
-- custom uploads. So this migration RE-SCOPES the signage bucket's two policies:
--
--   (a) signage_staff_insert/update — preserved for every path OUTSIDE `uploads/`
--       (`signage-items/…` mirror + the celebration/announcement/drink photos ItemEditor
--       already writes). Behaviour for those paths is unchanged: any venue_staff may write.
--   (b) signage_uploads_insert/update — NEW, for the `uploads/` prefix only, gated on
--       has_module(events) OR has_module(signage). The venue is derived FROM THE PATH
--       (`uploads/{venue_id}/…`) — no hardcoded venue id (venue-scope rule). has_module is
--       SECURITY DEFINER (0024), so it resolves the caller's grant inside the storage policy.
--
-- The `logos` and `picture-rounds` buckets keep their 0017 policies untouched. The Toast
-- image mirror (toast-menu-sync) writes via the service role and bypasses RLS entirely, so
-- it is unaffected by this re-scope.

-- Drop 0017's broad signage-bucket policies (recreated below, scoped). The loop in 0017
-- named them `signage_staff_insert` / `signage_staff_update`.
drop policy if exists signage_staff_insert on storage.objects;
drop policy if exists signage_staff_update on storage.objects;

-- (a) Preserve existing behaviour for every NON-uploads path in the signage bucket.
create policy signage_staff_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'signage'
    and coalesce((storage.foldername(name))[1], '') <> 'uploads'
    and exists (select 1 from public.venue_staff vs where vs.profile_id = auth.uid())
  );

create policy signage_staff_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'signage'
    and coalesce((storage.foldername(name))[1], '') <> 'uploads'
    and exists (select 1 from public.venue_staff vs where vs.profile_id = auth.uid())
  );

-- (b) Module-gated custom uploads under uploads/{venue_id}/… (events OR signage grant).
--     Venue derived from the second path segment — never hardcoded.
create policy signage_uploads_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'signage'
    and (storage.foldername(name))[1] = 'uploads'
    and (
      public.has_module(((storage.foldername(name))[2])::uuid, 'events')
      or public.has_module(((storage.foldername(name))[2])::uuid, 'signage')
    )
  );

create policy signage_uploads_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'signage'
    and (storage.foldername(name))[1] = 'uploads'
    and (
      public.has_module(((storage.foldername(name))[2])::uuid, 'events')
      or public.has_module(((storage.foldername(name))[2])::uuid, 'signage')
    )
  );
