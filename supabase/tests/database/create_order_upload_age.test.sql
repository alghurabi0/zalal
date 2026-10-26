-- create_order() takes a booking upload only within 48 hours of it being
-- uploaded (spec §5.10, §7 Storage). The cleanup job deletes unattached
-- customer files after 72 hours, so it can never delete a file that is still
-- bookable. An older file is refused as ZL009 upload_not_found, and nothing is
-- booked; the customer adds the file again.
begin;
\ir _helpers.psql

select plan(4);

select tests.create_user('+9647801111111');

delete from public.service_areas;
insert into public.service_areas (name, area)
values ('Test Karbala', 'SRID=4326;MULTIPOLYGON(((43.9 32.5, 44.1 32.5, 44.1 32.7, 43.9 32.7, 43.9 32.5)))');
update public.slots set active = false;
delete from public.blocked_dates;
update public.settings set booking_window_days = 14, cancel_cutoff_hours = 2, max_tanks_per_order = 6;
select tests.create_slot('07:00', '09:00', 5);
select tests.create_address(tests.user_id('+9647801111111'));

create function tests.path(p_file text) returns text language sql stable
as $$ select 'customer/' || tests.user_id('+9647801111111') || '/' || p_file $$;

select tests.create_object('order-media', tests.path('fresh.jpg'), tests.user_id('+9647801111111'));
select tests.create_object('order-media', tests.path('stale.jpg'), tests.user_id('+9647801111111'));
update storage.objects set created_at = now() - interval '47 hours'
where bucket_id = 'order-media' and name = tests.path('fresh.jpg');
update storage.objects set created_at = now() - interval '49 hours'
where bucket_id = 'order-media' and name = tests.path('stale.jpg');

create function tests.book(p_request text, p_file text) returns uuid language sql
as $$
  select order_id from public.create_order(
    p_request_id => md5(p_request)::uuid,
    p_address_id => (select id from public.addresses where user_id = tests.user_id('+9647801111111')),
    p_service_date => (now() at time zone 'Asia/Baghdad')::date + 1,
    p_slot_id => (select id from public.slots where start_time = '07:00' and end_time = '09:00'),
    p_items => '[{"tank_type": "roof", "size": "m", "qty": 1}]',
    p_media => jsonb_build_array(jsonb_build_object('path', tests.path(p_file)))
  );
$$;

grant execute on all functions in schema tests to authenticated;

select tests.authenticate_as(tests.user_id('+9647801111111'));

select throws_ok(
  $$ select tests.book('stale', 'stale.jpg') $$,
  'ZL009', 'upload_not_found', 'an upload over 48 hours old is refused'
);
select is((select count(*)::int from public.orders), 0, 'and nothing was booked');
select isnt(tests.book('fresh', 'fresh.jpg'), null, 'an upload under 48 hours old books');
select is(
  (select array_agg(path) from public.order_media),
  array[tests.path('fresh.jpg')],
  'and is attached'
);

select * from finish();
rollback;
