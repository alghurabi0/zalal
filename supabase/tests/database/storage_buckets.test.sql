-- Buckets from spec §7. Until a phase adds storage policies for its bucket,
-- only the service role may read or write any of them.
begin;
\ir _helpers.psql

select plan(18);

-- Shape ------------------------------------------------------------------

select results_eq(
  $$ select id, public, file_size_limit
     from storage.buckets order by id $$,
  $$ values
       ('certificates'::text,  false, 10485760::bigint),
       ('chat-media',          false, 104857600),
       ('order-media',         false, 104857600),
       ('public-content',      true,  5242880),
       ('ticket-media',        false, 104857600) $$,
  'the five spec buckets exist with the right visibility and size caps'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'order-media'),
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm'
  ],
  'order-media accepts phone photos and videos only'
);

select ok(
  (select bool_and(allowed_mime_types = (select allowed_mime_types from storage.buckets where id = 'order-media'))
   from storage.buckets where id in ('chat-media', 'ticket-media')),
  'chat-media and ticket-media use the same file types as order-media'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'certificates'),
  array['application/pdf'],
  'certificates accepts PDFs only'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'public-content'),
  array['image/jpeg', 'image/png', 'image/webp'],
  'public-content accepts images only'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'RLS is on for storage.objects'
);

-- Fails as soon as someone adds a storage policy, so that each new policy
-- comes with its own allow and deny tests (CLAUDE.md). The order-media ones
-- are tested in order_media_storage.test.sql.
select policies_are(
  'storage', 'objects',
  array[
    'Customers upload booking media to their own folder',
    'Customers read their uploads; media is read with its order',
    'Customers delete their uploads until they are attached'
  ]::name[],
  'storage.objects has only the order-media policies'
);

-- One file in every bucket, written the way the server would write it.
insert into storage.objects (bucket_id, name)
select id, 'seed/test.jpg' from storage.buckets;

-- Guest --------------------------------------------------------------------

select tests.authenticate_as_anon();

select is_empty(
  'select 1 from storage.objects',
  'a guest sees no files in any bucket'
);

select is_empty(
  'select 1 from storage.buckets',
  'a guest cannot list buckets'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('public-content', 'anon.jpg') $$,
  '42501', null,
  'a guest cannot upload to public-content'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('order-media', 'anon.jpg') $$,
  '42501', null,
  'a guest cannot upload to order-media'
);

-- Logged-in user -------------------------------------------------------------

select tests.clear_authentication();
select tests.authenticate_as(tests.create_user('+9647801234567'));

select is_empty(
  'select 1 from storage.objects',
  'a logged-in user sees no files in any bucket'
);

select is_empty(
  'select 1 from storage.buckets',
  'a logged-in user cannot list buckets'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('order-media', 'mine.jpg', auth.uid()::text) $$,
  '42501', null,
  'a logged-in user cannot upload to order-media'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'mine.jpg', auth.uid()::text) $$,
  '42501', null,
  'a logged-in user cannot upload to public-content'
);

select is_empty(
  $$ update storage.objects set name = name || '.moved' returning 1 $$,
  'a logged-in user cannot rename files'
);

-- Storage blocks every direct SQL delete unless this flag is set (the Storage
-- API sets it). Setting it here means RLS is what this test checks.
select set_config('storage.allow_delete_query', 'true', true);

select is_empty(
  $$ delete from storage.objects returning 1 $$,
  'a logged-in user cannot delete files'
);

-- Server -------------------------------------------------------------------

select tests.clear_authentication();
select tests.authenticate_as_service_role();

select is(
  (select count(*)::int from storage.objects where name = 'seed/test.jpg'),
  5,
  'the service role sees the files in every bucket'
);

select * from finish();
rollback;
