-- 0017 — Storage write policies for staff (docs/04 BulkImport, docs/09 signage)
-- The picture-rounds + logos + signage buckets are public-READ (bucket.public=true),
-- but writes are RLS default-deny on storage.objects. The legacy import wrote via the
-- service role (bypasses RLS); the app writes as an authenticated staff member and so
-- needs explicit INSERT/UPDATE policies. Single-venue: any venue_staff member may
-- write to these asset buckets. Reads stay public (served via the public CDN path).

do $$
declare b text;
begin
  foreach b in array array['picture-rounds', 'logos', 'signage'] loop
    execute format('drop policy if exists %I on storage.objects', b || '_staff_insert');
    execute format($f$create policy %I on storage.objects
      for insert to authenticated
      with check (bucket_id = %L and exists (
        select 1 from public.venue_staff vs where vs.profile_id = auth.uid()))$f$,
      b || '_staff_insert', b);

    execute format('drop policy if exists %I on storage.objects', b || '_staff_update');
    execute format($f$create policy %I on storage.objects
      for update to authenticated
      using (bucket_id = %L and exists (
        select 1 from public.venue_staff vs where vs.profile_id = auth.uid()))$f$,
      b || '_staff_update', b);
  end loop;
end $$;
