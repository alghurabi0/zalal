-- unattached_media(folder, limit, after_created_at, after_name) (spec §7
-- Storage): the files in order-media that the cleanup job (Edge Function
-- media-cleanup) may delete, oldest first, at most p_limit, starting after
-- the cursor. A file is never listed while an order_media row
-- has its path.
-- customer/<user id>/…: uploaded more than 72 hours ago. create_order()
-- refuses uploads older than 48 hours, so a listed file can't be booked.
-- crew/<crew id>/<order id>/…: uploaded more than 48 hours ago, and the order
-- no longer takes media from that crew: it isn't assigned to it, or isn't
-- arrived or in progress, or was completed more than 48 hours ago
-- (attach_job_media stops at 24 hours). An open job keeps its files however
-- old they are, so the crew's phone queue can still attach them.
-- Other folders are never listed. Only the service role may call it.
begin;
\ir _helpers.psql

select plan(32);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647801111112');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.crew1_user() returns uuid language sql stable
as $$ select tests.user_id('+9647703333333') $$;

-- Starts from an empty bucket, whatever the database held before.
delete from public.order_media;
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'order-media';
reset storage.allow_delete_query;

-- A finished upload, made p_age ago.
create function tests.upload(p_name text, p_owner uuid, p_age interval) returns void
language plpgsql
as $$
begin
  perform tests.create_object('order-media', p_name, p_owner);
  update storage.objects
  set created_at = now() - p_age, updated_at = now() - p_age
  where bucket_id = 'order-media' and name = p_name;
end;
$$;

-- Customer folder --------------------------------------------------------------------

insert into tests.ids values ('booked', tests.create_order(tests.a()));
select tests.upload('customer/' || tests.a() || '/new.jpg', tests.a(), '71 hours');
select tests.upload('customer/' || tests.a() || '/old.jpg', tests.a(), '73 hours');
select tests.upload('customer/' || tests.a() || '/older.jpg', tests.a(), '10 days');
select tests.upload('customer/' || tests.a() || '/booked.jpg', tests.a(), '30 days');
select tests.upload(
  'customer/' || tests.user_id('+9647801111112') || '/b.jpg', tests.user_id('+9647801111112'), '5 days'
);
insert into public.order_media (order_id, kind, media_type, path, bytes, uploaded_by)
values (
  tests.id('booked'), 'customer', 'photo', 'customer/' || tests.a() || '/booked.jpg', 1000, tests.a()
);
-- Not the job's folders.
select tests.upload('elsewhere/' || tests.a() || '/x.jpg', tests.a(), '30 days');
select tests.upload('customer.jpg', tests.a(), '30 days');
-- Another bucket.
select tests.create_object('chat-media', 'customer/' || tests.a() || '/x.jpg', tests.a());
update storage.objects set created_at = now() - interval '30 days' where bucket_id = 'chat-media';

select tests.authenticate_as_service_role();

select is(
  array(select name from public.unattached_media('customer')),
  array[
    'customer/' || tests.a() || '/older.jpg',
    'customer/' || tests.user_id('+9647801111112') || '/b.jpg',
    'customer/' || tests.a() || '/old.jpg'
  ],
  'customer: unattached files over 72 hours old, oldest first'
);
select ok(
  not ('customer/' || tests.a() || '/new.jpg' = any (array(select name from public.unattached_media('customer')))),
  'customer: a 71-hour-old file stays'
);
select ok(
  not ('customer/' || tests.a() || '/booked.jpg' = any (array(select name from public.unattached_media('customer')))),
  'customer: an attached file stays, however old'
);
select is(
  array(select name from public.unattached_media('customer', 2)),
  array[
    'customer/' || tests.a() || '/older.jpg',
    'customer/' || tests.user_id('+9647801111112') || '/b.jpg'
  ],
  'customer: at most p_limit names'
);
select is(
  array(
    select name from public.unattached_media(
      'customer', 2,
      (select o.created_at from storage.objects as o
       where o.bucket_id = 'order-media'
         and o.name = 'customer/' || tests.user_id('+9647801111112') || '/b.jpg'),
      'customer/' || tests.user_id('+9647801111112') || '/b.jpg'
    )
  ),
  array['customer/' || tests.a() || '/old.jpg'],
  'customer: the next page starts after the last row of the one before'
);

select tests.clear_authentication();

-- Crew folder ------------------------------------------------------------------------

insert into tests.ids values
  ('arrived', tests.create_order(tests.a(), 'arrived', p_crew_id => tests.id('crew1'))),
  ('working', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('done_47h', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('done_49h', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('done_no_event', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('cancelled', tests.create_order(tests.a(), 'cancelled', p_crew_id => tests.id('crew1'))),
  ('no_show', tests.create_order(tests.a(), 'no_show', p_crew_id => tests.id('crew1'))),
  ('reassigned', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew2'))),
  ('attached', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1')));
insert into public.order_events (order_id, from_status, to_status, actor_role, created_at)
values
  (tests.id('done_47h'), 'in_progress', 'completed', 'crew', now() - interval '47 hours'),
  (tests.id('done_49h'), 'in_progress', 'completed', 'crew', now() - interval '49 hours'),
  (tests.id('attached'), 'in_progress', 'completed', 'crew', now() - interval '30 days');

create function tests.p(p_crew text, p_order text, p_file text) returns text language sql stable
as $$ select 'crew/' || tests.id(p_crew) || '/' || tests.id(p_order) || '/' || p_file $$;

select tests.upload(tests.p('crew1', 'arrived', 'a.jpg'), tests.crew1_user(), '30 days');
select tests.upload(tests.p('crew1', 'working', 'w.jpg'), tests.crew1_user(), '30 days');
select tests.upload(tests.p('crew1', 'done_47h', 'd.jpg'), tests.crew1_user(), '3 days');
select tests.upload(tests.p('crew1', 'done_49h', 'd.jpg'), tests.crew1_user(), '3 days');
select tests.upload(tests.p('crew1', 'done_no_event', 'd.jpg'), tests.crew1_user(), '3 days');
select tests.upload(tests.p('crew1', 'cancelled', 'c.jpg'), tests.crew1_user(), '49 hours');
select tests.upload(tests.p('crew1', 'cancelled', 'fresh.jpg'), tests.crew1_user(), '47 hours');
select tests.upload(tests.p('crew1', 'no_show', 'n.jpg'), tests.crew1_user(), '4 days');
-- crew1's file on a job that now belongs to crew2: crew1 can't attach it.
select tests.upload(tests.p('crew1', 'reassigned', 'r.jpg'), tests.crew1_user(), '5 days');
-- crew2's file on its own open job.
select tests.upload(tests.p('crew2', 'reassigned', 'r.jpg'), tests.user_id('+9647703333334'), '5 days');
select tests.upload(tests.p('crew1', 'attached', 'kept.jpg'), tests.crew1_user(), '31 days');
insert into public.order_media (order_id, kind, media_type, path, bytes, uploaded_by)
values (
  tests.id('attached'), 'after', 'photo', tests.p('crew1', 'attached', 'kept.jpg'), 1000,
  tests.crew1_user()
);
-- An order that no longer exists, and paths no order can match.
select tests.upload(
  'crew/' || tests.id('crew1') || '/' || gen_random_uuid() || '/gone.jpg', tests.crew1_user(), '6 days'
);
select tests.upload('crew/' || tests.id('crew1') || '/not-an-order/x.jpg', tests.crew1_user(), '7 days');
select tests.upload('crew/stray.jpg', tests.crew1_user(), '8 days');

create function tests.crew_list() returns text[] language sql
as $$ select array(select name from public.unattached_media('crew')) $$;

select tests.authenticate_as_service_role();

select ok(not (tests.p('crew1', 'arrived', 'a.jpg') = any (tests.crew_list())), 'crew: an arrived job keeps its files');
select ok(not (tests.p('crew1', 'working', 'w.jpg') = any (tests.crew_list())), 'crew: a job in progress keeps its files');
select ok(not (tests.p('crew1', 'done_47h', 'd.jpg') = any (tests.crew_list())), 'crew: completed 47 hours ago keeps its files');
select ok(tests.p('crew1', 'done_49h', 'd.jpg') = any (tests.crew_list()), 'crew: completed 49 hours ago is listed');
select ok(tests.p('crew1', 'done_no_event', 'd.jpg') = any (tests.crew_list()), 'crew: completed with no completion event is listed');
select ok(tests.p('crew1', 'cancelled', 'c.jpg') = any (tests.crew_list()), 'crew: a cancelled job''s file over 48 hours old is listed');
select ok(not (tests.p('crew1', 'cancelled', 'fresh.jpg') = any (tests.crew_list())), 'crew: a file under 48 hours old stays');
select ok(tests.p('crew1', 'no_show', 'n.jpg') = any (tests.crew_list()), 'crew: a no-show''s file is listed');
select ok(tests.p('crew1', 'reassigned', 'r.jpg') = any (tests.crew_list()), 'crew: the old crew''s file on a reassigned job is listed');
select ok(not (tests.p('crew2', 'reassigned', 'r.jpg') = any (tests.crew_list())), 'crew: the new crew''s file stays');
select ok(not (tests.p('crew1', 'attached', 'kept.jpg') = any (tests.crew_list())), 'crew: an attached file stays, however old');
select ok(
  exists (select 1 from unnest(tests.crew_list()) as n where n like '%/gone.jpg'),
  'crew: a file for an order that no longer exists is listed'
);
select ok(
  ('crew/' || tests.id('crew1') || '/not-an-order/x.jpg') = any (tests.crew_list()),
  'crew: a path with no order id is listed'
);
select ok('crew/stray.jpg' = any (tests.crew_list()), 'crew: a file outside any crew folder is listed');
select is(cardinality(tests.crew_list()), 8, 'crew: eight files in all');
select is(
  (tests.crew_list())[1], 'crew/stray.jpg', 'crew: oldest first'
);
select ok(
  not exists (select 1 from unnest(tests.crew_list()) as n where not starts_with(n, 'crew/')),
  'crew: only the crew folder'
);

select throws_ok(
  $$ select name from public.unattached_media('elsewhere') $$,
  '22023', 'invalid_folder', 'another folder is refused'
);
select throws_ok(
  $$ select name from public.unattached_media('customer', 0) $$,
  '22023', 'invalid_limit', 'a limit under 1 is refused'
);
select throws_ok(
  $$ select name from public.unattached_media('customer', 1001) $$,
  '22023', 'invalid_limit', 'a limit over 1000 is refused'
);
select throws_ok(
  $$ select name from public.unattached_media('customer', 10, now(), null) $$,
  '22023', 'invalid_cursor', 'half a cursor is refused'
);

select tests.clear_authentication();

-- The crew rule against attach_job_media's own (private.job_takes_media): no
-- file it would still take is listed, at any status or time since completion.
-- Fails if either window changes without the other.
do $$
declare
  v_status text;
  v_hours int;
  v_order uuid;
begin
  foreach v_status in array array[
    'pending_confirmation', 'confirmed', 'on_the_way', 'arrived', 'in_progress', 'no_show', 'cancelled'
  ] loop
    v_order := tests.create_order(tests.a(), v_status, p_crew_id => tests.id('crew1'));
    perform tests.upload(
      'crew/' || tests.id('crew1') || '/' || v_order || '/w.jpg', tests.crew1_user(), '30 days'
    );
  end loop;
  foreach v_hours in array array[1, 23, 24, 25, 47, 49, 71, 73, 168] loop
    v_order := tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'));
    insert into public.order_events (order_id, from_status, to_status, actor_role, created_at)
    values (v_order, 'in_progress', 'completed', 'crew', now() - make_interval(hours => v_hours));
    perform tests.upload(
      'crew/' || tests.id('crew1') || '/' || v_order || '/w.jpg', tests.crew1_user(), '30 days'
    );
  end loop;
end;
$$;
select is_empty(
  $$
    select l.name
    from public.unattached_media('crew', 1000) as l
    join public.orders as o on o.id::text = split_part(l.name, '/', 3)
    where o.crew_id::text = split_part(l.name, '/', 2)
      and private.job_takes_media(o.id, o.status)
  $$,
  'crew: no file attach_job_media would still take is listed'
);

-- Who may call it ----------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select name from public.unattached_media('customer') $$, '42501', null, 'anon may not call it');
select tests.authenticate_as(tests.a());
select throws_ok($$ select name from public.unattached_media('customer') $$, '42501', null, 'a customer may not call it');
select tests.authenticate_as(tests.user_id('+9647801111112'));
select throws_ok($$ select name from public.unattached_media('customer') $$, '42501', null, 'another customer may not call it');
select tests.authenticate_as(tests.crew1_user());
select throws_ok($$ select name from public.unattached_media('crew') $$, '42501', null, 'a crew may not call it');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok($$ select name from public.unattached_media('crew') $$, '42501', null, 'an admin may not call it');
select tests.clear_authentication();

select * from finish();
rollback;
