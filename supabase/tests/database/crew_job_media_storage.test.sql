-- Storage rules for the crew's job media in order-media (spec §7, §8.1 C3b).
-- A crew uploads before/after photos and clips to
-- crew/<crew id>/<order id>/<file>, only for an order assigned to it that is
-- arrived or in progress, or completed less than 24 hours ago (so a queue
-- that was offline at خلصنا still lands). It reads its own uploads while the
-- order is still assigned to it, and deletes them until they are attached.
-- Attached files are read with their order, like the customer's. Customers,
-- other crews, switched-off crews, admins and guests cannot upload there.
begin;
\ir _helpers.psql

select plan(29);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));
insert into tests.ids values ('crew_off', tests.create_crew('+9647703333335'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.crew1_user() returns uuid language sql stable
as $$ select tests.user_id('+9647703333333') $$;

insert into tests.ids values
  ('arrived', tests.create_order(tests.a(), 'arrived', p_crew_id => tests.id('crew1'))),
  ('working', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('confirmed', tests.create_order(tests.a(), 'confirmed', p_crew_id => tests.id('crew1'))),
  ('done_recent', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('done_old', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('other', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew2'))),
  ('moved', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew2'))),
  ('off_job', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew_off')));

insert into public.order_events (order_id, from_status, to_status, actor_role, created_at)
values
  (tests.id('done_recent'), 'in_progress', 'completed', 'crew', now() - interval '23 hours'),
  (tests.id('done_old'), 'in_progress', 'completed', 'crew', now() - interval '25 hours');
update public.crews set active = false where id = tests.id('crew_off');

-- crew/<crew>/<order>/<file>
create function tests.p(p_crew text, p_order text, p_file text) returns text language sql stable
as $$ select 'crew/' || tests.id(p_crew) || '/' || tests.id(p_order) || '/' || p_file $$;

create function tests.put(p_name text) returns void language sql
as $$ insert into storage.objects (bucket_id, name, owner_id) values ('order-media', p_name, auth.uid()::text) $$;

grant execute on all functions in schema tests to anon, authenticated;

-- Files already there: one attached, one not, and one in a folder whose order
-- has since moved to crew 2.
select tests.create_object('order-media', tests.p('crew1', 'working', 'attached.jpg'), tests.crew1_user());
select tests.create_object('order-media', tests.p('crew1', 'working', 'queued.jpg'), tests.crew1_user());
select tests.create_object('order-media', tests.p('crew1', 'moved', 'left.jpg'), tests.crew1_user());
insert into public.order_media (order_id, kind, media_type, path, bytes, uploaded_by)
values (tests.id('working'), 'before', 'photo', tests.p('crew1', 'working', 'attached.jpg'), 1000, tests.crew1_user());

-- Uploads ------------------------------------------------------------------------

select tests.authenticate_as(tests.crew1_user());

select lives_ok(
  $$ select tests.put(tests.p('crew1', 'arrived', 'a.jpg')) $$,
  'the crew uploads to an arrived job'
);
select lives_ok(
  $$ select tests.put(tests.p('crew1', 'working', 'b.jpg')) $$,
  'the crew uploads to a job in progress'
);
select lives_ok(
  $$ select tests.put(tests.p('crew1', 'done_recent', 'c.jpg')) $$,
  'the crew uploads to a job it completed less than 24 hours ago'
);
select throws_ok(
  $$ select tests.put(tests.p('crew1', 'confirmed', 'x.jpg')) $$,
  '42501', null, 'not before the crew arrives'
);
select throws_ok(
  $$ select tests.put(tests.p('crew1', 'done_old', 'x.jpg')) $$,
  '42501', null, 'not 24 hours after completion'
);
select throws_ok(
  $$ select tests.put('crew/' || tests.id('crew1') || '/' || tests.id('other') || '/x.jpg') $$,
  '42501', null, 'not for an order assigned to another crew'
);
select throws_ok(
  $$ select tests.put(tests.p('crew2', 'other', 'x.jpg')) $$,
  '42501', null, 'not into another crew''s folder'
);
select throws_ok(
  $$ select tests.put('crew/' || tests.id('crew1') || '/x.jpg') $$,
  '42501', null, 'only inside an order folder'
);
select throws_ok(
  $$ select tests.put('crew/' || tests.id('crew1') || '/not-a-uuid/x.jpg') $$,
  '42501', null, 'a folder that is not an order id is refused, not an error'
);
select throws_ok(
  $$ select tests.put('customer/' || auth.uid() || '/x.jpg') $$,
  '42501', null, 'a crew still cannot upload booking media'
);

select tests.authenticate_as(tests.user_id('+9647703333335'));
select throws_ok(
  $$ select tests.put(tests.p('crew_off', 'off_job', 'x.jpg')) $$,
  '42501', null, 'a switched-off crew cannot upload'
);

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select tests.put(tests.p('crew1', 'working', 'x.jpg')) $$,
  '42501', null, 'the customer cannot upload into the crew folder'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select tests.put(tests.p('crew1', 'working', 'x.jpg')) $$,
  '42501', null, 'an admin cannot upload job media'
);

select tests.authenticate_as_anon();
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('order-media', tests.p('crew1', 'working', 'x.jpg')) $$,
  '42501', null, 'a guest cannot upload'
);

-- Reads ------------------------------------------------------------------------

select tests.authenticate_as(tests.crew1_user());
select results_eq(
  $$ select name from storage.objects where name like 'crew/%' order by name $$,
  $$ select unnest(array[
       tests.p('crew1', 'arrived', 'a.jpg'),
       tests.p('crew1', 'done_recent', 'c.jpg'),
       tests.p('crew1', 'working', 'attached.jpg'),
       tests.p('crew1', 'working', 'b.jpg'),
       tests.p('crew1', 'working', 'queued.jpg')
     ]) order by 1 $$,
  'the crew reads its uploads for orders still assigned to it'
);

select tests.authenticate_as(tests.user_id('+9647703333334'));
select is_empty(
  $$ select 1 from storage.objects where name like 'crew/' || tests.id('crew1') || '/%' $$,
  'another crew reads none of them, even in a folder of its own order'
);

select tests.authenticate_as(tests.user_id('+9647703333335'));
select is_empty(
  $$ select 1 from storage.objects where name like 'crew/%' $$,
  'a switched-off crew reads nothing'
);

select tests.authenticate_as(tests.a());
select results_eq(
  $$ select name from storage.objects where name like 'crew/%' $$,
  $$ values (tests.p('crew1', 'working', 'attached.jpg')) $$,
  'the customer reads attached job media of their order, not queued uploads'
);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty(
  $$ select 1 from storage.objects where name like 'crew/%' $$,
  'another customer reads none'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select results_eq(
  $$ select name from storage.objects where name like 'crew/%' $$,
  $$ values (tests.p('crew1', 'working', 'attached.jpg')) $$,
  'an admin reads attached job media'
);

-- Changes and deletes --------------------------------------------------------------

set local storage.allow_delete_query = 'true';

select tests.authenticate_as(tests.user_id('+9647703333334'));
select is_empty(
  $$ delete from storage.objects where name = tests.p('crew1', 'working', 'queued.jpg') returning 1 $$,
  'another crew cannot delete the upload'
);

select tests.authenticate_as(tests.a());
select is_empty(
  $$ delete from storage.objects where name = tests.p('crew1', 'working', 'queued.jpg') returning 1 $$,
  'the customer cannot delete it'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is_empty(
  $$ delete from storage.objects where name = tests.p('crew1', 'working', 'queued.jpg') returning 1 $$,
  'an admin cannot delete it through the API'
);

select tests.authenticate_as(tests.crew1_user());
select is_empty(
  $$ update storage.objects set name = tests.p('crew1', 'working', 'renamed.jpg')
     where name = tests.p('crew1', 'working', 'queued.jpg') returning 1 $$,
  'the crew cannot change an upload'
);
select is_empty(
  $$ delete from storage.objects where name = tests.p('crew1', 'working', 'attached.jpg') returning 1 $$,
  'the crew cannot delete an attached file'
);
select lives_ok(
  $$ delete from storage.objects where name = tests.p('crew1', 'working', 'queued.jpg') $$,
  'the crew deletes an upload it removed from the queue'
);
select is_empty(
  $$ select 1 from storage.objects where name = tests.p('crew1', 'working', 'queued.jpg') $$,
  'the upload is gone'
);
select is_empty(
  $$ delete from storage.objects where name = tests.p('crew1', 'moved', 'left.jpg') returning 1 $$,
  'the crew cannot see or delete files of an order it lost'
);

select tests.clear_authentication();
select isnt_empty(
  $$ select 1 from storage.objects where name = tests.p('crew1', 'working', 'attached.jpg') $$,
  'the attached file is still there'
);

select * from finish();
rollback;
