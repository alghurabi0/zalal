-- Storage rules for the order-media bucket (spec §5.10, §7).
--
-- Booking step 2 uploads photos and videos before the order exists, so a
-- customer uploads to their own folder, customer/<user id>/<file>, and
-- create_order() attaches the files (order_media rows) when they book. Until
-- then the customer may delete a file (the × on Upload). Once attached, a
-- file is read by whoever may read its order: the customer, the assigned crew
-- and admins (through the order_media policy). Signed URLs are made with the
-- caller's session, so these rules decide who gets one.
--
-- Not yet: crew uploads of before/after photos and clips (Phase 3, crew app),
-- and cleaning up files that were uploaded but never booked. That cleanup
-- has to go through the Storage API (direct deletes from storage.objects are
-- refused), so it will be a scheduled job outside Postgres.

create policy "Customers upload booking media to their own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'order-media'
  and cardinality(storage.foldername(name)) = 2
  and (storage.foldername(name))[1] = 'customer'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (select private.current_user_role()) = 'customer'
);

create policy "Customers read their uploads; media is read with its order"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'order-media'
  and (
    (
      (storage.foldername(name))[1] = 'customer'
      and (storage.foldername(name))[2] = (select auth.uid())::text
    )
    or exists (select 1 from public.order_media as m where m.path = objects.name)
  )
);

create policy "Customers delete their uploads until they are attached"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'order-media'
  and (storage.foldername(name))[1] = 'customer'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and not exists (select 1 from public.order_media as m where m.path = objects.name)
);
