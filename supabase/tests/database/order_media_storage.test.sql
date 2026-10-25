-- Storage rules for the order-media bucket (spec §5.10, §7). A customer
-- uploads booking photos and videos to their own folder,
-- customer/<user id>/, before the order exists; create_order() then attaches
-- them. A customer reads their own folder; they may delete a file there until
-- it is attached. Attached files are read by whoever may read the order (the
-- customer, the assigned crew, admins). Nobody else reads or writes. Crew
-- uploads (before/after photos and clips) come with the crew app in Phase 3.
begin;
\ir _helpers.psql

select plan(16);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));
insert into tests.ids values (
  'order_a', tests.create_order(tests.user_id('+9647801111111'), 'confirmed', p_crew_id => tests.id('crew1'))
);

create function tests.a_path(p_file text) returns text language sql stable
as $$ select 'customer/' || tests.user_id('+9647801111111') || '/' || p_file $$;
grant execute on function tests.a_path(text) to anon, authenticated;

select tests.create_object('order-media', tests.a_path('attached.jpg'), tests.user_id('+9647801111111'));
select tests.create_object('order-media', tests.a_path('draft.jpg'), tests.user_id('+9647801111111'));
insert into public.order_media (order_id, kind, media_type, path, bytes, uploaded_by)
values (tests.id('order_a'), 'customer', 'photo', tests.a_path('attached.jpg'), 1000, tests.user_id('+9647801111111'));

-- Uploads ------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('order-media', tests.a_path('new.jpg'), auth.uid()::text) $$,
  'a customer uploads to their own folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('order-media', 'customer/' || tests.user_id('+9647802222222') || '/x.jpg', auth.uid()::text) $$,
  '42501', null, 'a customer cannot upload to someone else''s folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('order-media', 'orders/x.jpg', auth.uid()::text) $$,
  '42501', null, 'a customer cannot upload outside their folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('chat-media', tests.a_path('x.jpg'), auth.uid()::text) $$,
  '42501', null, 'these rules cover only order-media'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('order-media', 'customer/' || auth.uid() || '/x.jpg', auth.uid()::text) $$,
  '42501', null, 'a crew cannot upload booking media'
);

select tests.authenticate_as_anon();
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('order-media', 'customer/x/x.jpg') $$,
  '42501', null, 'a guest cannot upload'
);

-- Reads ------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));
select results_eq(
  $$ select name from storage.objects where bucket_id = 'order-media' order by name $$,
  $$ values (tests.a_path('attached.jpg')), (tests.a_path('draft.jpg')), (tests.a_path('new.jpg')) $$,
  'a customer reads their own uploads'
);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty(
  $$ select * from storage.objects where bucket_id = 'order-media' $$,
  'another customer reads none of them'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select results_eq(
  $$ select name from storage.objects where bucket_id = 'order-media' $$,
  $$ values (tests.a_path('attached.jpg')) $$,
  'the assigned crew reads the files attached to its order, not drafts'
);

select tests.authenticate_as(tests.user_id('+9647703333334'));
select is_empty(
  $$ select * from storage.objects where bucket_id = 'order-media' $$,
  'another crew reads none of them'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select results_eq(
  $$ select name from storage.objects where bucket_id = 'order-media' $$,
  $$ values (tests.a_path('attached.jpg')) $$,
  'an admin reads files attached to orders'
);

-- Changes and deletes --------------------------------------------------------------

-- The Storage API deletes with this setting on and the caller's role, so RLS
-- decides.
set local storage.allow_delete_query = 'true';

select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty(
  $$ delete from storage.objects where name = tests.a_path('draft.jpg') returning 1 $$,
  'another customer cannot delete the upload'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty(
  $$ update storage.objects set name = tests.a_path('renamed.jpg')
     where name = tests.a_path('draft.jpg') returning 1 $$,
  'a customer cannot change an upload'
);
select is_empty(
  $$ delete from storage.objects where name = tests.a_path('attached.jpg') returning 1 $$,
  'a customer cannot delete a file attached to an order'
);
select lives_ok(
  $$ delete from storage.objects where name = tests.a_path('draft.jpg') $$,
  'a customer deletes an upload they removed before booking'
);
select is_empty(
  $$ select * from storage.objects where name = tests.a_path('draft.jpg') $$,
  'the upload is gone'
);

select * from finish();
rollback;
