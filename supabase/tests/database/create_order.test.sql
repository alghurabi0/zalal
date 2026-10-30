-- create_order() (spec §5.9-5.11, §6 "(new) -> pending_confirmation", §7).
-- Only a customer books, for their own live address, which must still be in
-- an active service area (ZL001). The slot must be bookable (ZL004): active,
-- on its weekday, not blocked, on any future day (no booking window since
-- migration `no_booking_limits`), and starting at least cancel_cutoff_hours
-- from now. It takes a place or fails with ZL005, so a
-- slot is never overbooked. Lines are saved tanks on that address or new
-- tanks, which are saved to it (one tank per line; qty stays on the line);
-- any number of tanks (no limit since migration `no_booking_limits`). Prices and the address are
-- copied onto the order. Up to 4 finished uploads from the caller's own
-- folder in order-media (ZL008, ZL009). The same request id returns the same
-- order instead of booking twice. Parallel bookings are tested in
-- tests/integration/booking-capacity.test.ts.
begin;
\ir _helpers.psql

select plan(48);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647703333333', 'crew');
select tests.create_user('+9647504444444', 'admin');

delete from public.service_areas;
insert into public.service_areas (name, area)
values ('Test Karbala', 'SRID=4326;MULTIPOLYGON(((43.9 32.5, 44.1 32.5, 44.1 32.7, 43.9 32.7, 43.9 32.5)))');

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

-- Slot ids by name.
create table tests.slots (name text primary key, id bigint not null);
create function tests.slot(p_name text) returns bigint language sql stable
as $$ select id from tests.slots where name = p_name $$;

-- A one-minute slot open every day, starting at p_start (to the minute).
create function tests.slot_at(p_start timestamptz) returns bigint language plpgsql as $$
declare
  v_time time := (p_start at time zone 'Asia/Baghdad')::time;
begin
  return tests.create_slot(
    v_time, case when v_time >= '23:58' then '23:59:59' else v_time + interval '1 minute' end, 5
  );
end;
$$;

update public.slots set active = false;
delete from public.blocked_dates;
update public.settings set booking_window_days = 14, cancel_cutoff_hours = 2, max_tanks_per_order = 6;

insert into tests.slots values ('main', tests.create_slot('07:00', '09:00', 2));
insert into tests.slots values ('inactive', tests.create_slot('09:00', '10:00', 2));
update public.slots set active = false where id = tests.slot('inactive');
insert into public.slots (start_time, end_time, capacity, weekdays)
values ('10:00', '11:00', 2, array[extract(dow from tests.today() + 3)::smallint]);
insert into tests.slots select 'one_weekday', id from public.slots where start_time = '10:00' and end_time = '11:00';
insert into tests.slots values ('cut_late', tests.slot_at(date_trunc('minute', now() + interval '1 hour 59 minutes')));
insert into tests.slots values ('cut_ok', tests.slot_at(date_trunc('minute', now() + interval '2 hours') + interval '1 minute'));
insert into public.blocked_dates (date) values (tests.today() + 4);

insert into tests.ids values ('a_home', tests.create_address(tests.user_id('+9647801111111'), 'home'));
insert into tests.ids values ('a_work', tests.create_address(tests.user_id('+9647801111111'), 'work'));
insert into tests.ids values ('b_home', tests.create_address(tests.user_id('+9647802222222'), 'home'));
insert into public.tanks (user_id, address_id, type, size)
values (tests.user_id('+9647801111111'), tests.id('a_home'), 'roof', 'm');
insert into tests.ids select 'tank_a_home', id from public.tanks where address_id = tests.id('a_home');
insert into public.tanks (user_id, address_id, type, size)
values (tests.user_id('+9647801111111'), tests.id('a_work'), 'roof', 's');
insert into tests.ids select 'tank_a_work', id from public.tanks where address_id = tests.id('a_work');
insert into public.tanks (user_id, address_id, type, size)
values (tests.user_id('+9647802222222'), tests.id('b_home'), 'roof', 's');
insert into tests.ids select 'tank_b', id from public.tanks where address_id = tests.id('b_home');

-- Finished uploads.
create function tests.a_path(p_file text) returns text language sql stable
as $$ select 'customer/' || tests.user_id('+9647801111111') || '/' || p_file $$;
select tests.create_object('order-media', tests.a_path('p1.jpg'), tests.user_id('+9647801111111'), 'image/jpeg', 2000);
select tests.create_object('order-media', tests.a_path('v1.mp4'), tests.user_id('+9647801111111'), 'video/mp4', 5000000);
select tests.create_object('order-media', tests.a_path('p2.jpg'), tests.user_id('+9647801111111'));
select tests.create_object('order-media', tests.a_path('p3.jpg'), tests.user_id('+9647801111111'));
select tests.create_object('order-media', tests.a_path('p4.jpg'), tests.user_id('+9647801111111'));
select tests.create_object('order-media', tests.a_path('p5.jpg'), tests.user_id('+9647801111111'));
select tests.create_object('order-media', tests.a_path('v2.mp4'), tests.user_id('+9647801111111'), 'video/mp4');
select tests.create_object(
  'order-media', 'customer/' || tests.user_id('+9647802222222') || '/x.jpg', tests.user_id('+9647802222222')
);

-- create_order with test defaults: tomorrow, the main slot, A's home.
create function tests.book(
  p_request text,
  p_items jsonb,
  p_date date default null,
  p_slot bigint default null,
  p_address uuid default null,
  p_media jsonb default '[]',
  p_note text default null
)
returns uuid
language sql
as $$
  select order_id from public.create_order(
    p_request_id => md5(p_request)::uuid,
    p_address_id => coalesce(p_address, tests.id('a_home')),
    p_service_date => coalesce(p_date, tests.today() + 1),
    p_slot_id => coalesce(p_slot, tests.slot('main')),
    p_items => p_items,
    p_note => p_note,
    p_media => p_media
  );
$$;

-- One line on a saved tank.
create function tests.line(p_tank text, p_qty int default 1) returns jsonb language sql stable
as $$ select jsonb_build_object('tank_id', tests.id(p_tank), 'qty', p_qty) $$;

create function tests.file(p_file text, p_duration numeric default null) returns jsonb
language sql stable
as $$ select jsonb_strip_nulls(jsonb_build_object('path', tests.a_path(p_file), 'duration_s', p_duration)) $$;

grant select on tests.slots to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- Who may book -----------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select tests.book('anon', jsonb_build_array(tests.line('tank_a_home'))) $$,
  '42501', null, 'a guest cannot book'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select tests.book('crew', '[{"tank_type": "roof", "size": "s", "qty": 1}]') $$,
  '42501', 'not_allowed', 'a crew cannot book'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select tests.book('admin', '[{"tank_type": "roof", "size": "s", "qty": 1}]') $$,
  '42501', 'not_allowed', 'an admin cannot book'
);

-- A booking ---------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select lives_ok(
  $$ insert into tests.ids
     select 'first', tests.book(
       'first',
       jsonb_build_array(tests.line('tank_a_home'), '{"tank_type": "ground", "size": "l", "qty": 2}'::jsonb),
       p_media => jsonb_build_array(tests.file('p1.jpg'), tests.file('v1.mp4', 30.5)),
       p_note => 'الباب الأزرق'
     ) $$,
  'a customer books a slot'
);

select results_eq(
  $$ select status::text, customer_id, address_id, district, landmark, lat, lng, service_date,
       slot_id, slot_start_at, slot_end_at, total_iqd, payment_method::text, cash_collected,
       customer_note, crew_id
     from public.orders where id = tests.id('first') $$,
  $$ values ('pending_confirmation', tests.user_id('+9647801111111'), tests.id('a_home'),
       'حي الحسين'::text, 'قرب الجامع'::text, 32.616::float8, 44.024::float8, tests.today() + 1,
       tests.slot('main'), ((tests.today() + 1) + time '07:00') at time zone 'Asia/Baghdad',
       ((tests.today() + 1) + time '09:00') at time zone 'Asia/Baghdad', 275000, 'cash',
       false, 'الباب الأزرق'::text, null::uuid) $$,
  'the order waits for confirmation, with the address, slot times and total copied onto it'
);
select results_eq(
  $$ select tank_type::text, size::text, qty::int, unit_price_iqd, tank_id is not null
     from public.order_items where order_id = tests.id('first') order by unit_price_iqd $$,
  $$ values ('roof', 'm', 1, 35000, true), ('ground', 'l', 2, 120000, true) $$,
  'each line keeps its price from the price list'
);
select results_eq(
  $$ select type::text, size::text, last_cleaned_at from public.tanks
     where address_id = tests.id('a_home') and id <> tests.id('tank_a_home') $$,
  $$ values ('ground', 'l', null::timestamptz) $$,
  'a new line is saved to the address as one tank'
);
select results_eq(
  $$ select tank_id from public.order_items
     where order_id = tests.id('first') and tank_type = 'ground' $$,
  $$ select id from public.tanks where address_id = tests.id('a_home') and type = 'ground' $$,
  'the new line points at the saved tank'
);
select results_eq(
  $$ select from_status::text, to_status::text, actor_id, actor_role::text, is_override
     from public.order_events where order_id = tests.id('first') $$,
  $$ values (null::text, 'pending_confirmation', tests.user_id('+9647801111111'), 'customer', false) $$,
  'the booking is the first event'
);
select results_eq(
  $$ select kind::text, media_type::text, path, bytes, duration_s, uploaded_by
     from public.order_media where order_id = tests.id('first') order by path $$,
  $$ values ('customer', 'photo', tests.a_path('p1.jpg'), 2000::bigint, null::numeric,
             tests.user_id('+9647801111111')),
            ('customer', 'video', tests.a_path('v1.mp4'), 5000000::bigint, 30.5::numeric,
             tests.user_id('+9647801111111')) $$,
  'uploads are attached, with type and size from Storage'
);

select is(
  tests.book('first', '[{"tank_type": "roof", "size": "s", "qty": 3}]'),
  tests.id('first'),
  'the same request id returns the same order'
);
select is(
  (select count(*)::int from public.orders), 1, 'a repeated request books nothing new'
);

select lives_ok(
  $$ select tests.book('second', jsonb_build_array(tests.line('tank_a_home'))) $$,
  'a second booking takes the last place'
);
select throws_ok(
  $$ select tests.book('third', '[{"tank_type": "roof", "size": "l", "qty": 1}]') $$,
  'ZL005', 'slot_full', 'a full slot is refused'
);
select is(
  (select count(*)::int from public.tanks where address_id = tests.id('a_home')),
  2, 'a refused booking saves no tanks'
);

select tests.clear_authentication();
select results_eq(
  $$ select seat::int from public.slot_bookings
     where service_date = tests.today() + 1 and slot_id = tests.slot('main') order by seat $$,
  $$ values (1), (2) $$,
  'each booking holds one place'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));

-- Tanks -------------------------------------------------------------------------

select lives_ok(
  $$ select tests.book('55 tanks', jsonb_build_array(
       tests.line('tank_a_home', 25), '{"tank_type": "roof", "size": "s", "qty": 30}'::jsonb
     ), tests.today() + 20) $$,
  'any number of tanks can be booked, with more than 20 on a line'
);
select results_eq(
  $$ select sum(i.qty)::int from public.order_items as i
     join public.orders as o on o.id = i.order_id
     where o.client_request_id = md5('55 tanks')::uuid $$,
  $$ values (55) $$,
  'and every line keeps its quantity'
);
select throws_ok(
  $$ select tests.book('huge', jsonb_build_array(tests.line('tank_a_home', 40000)), tests.today() + 21) $$,
  '22023', 'invalid_items', 'a quantity too big to store is refused as invalid input'
);
select throws_ok(
  $$ select tests.book('qty 0', jsonb_build_array(tests.line('tank_a_home', 0)), tests.today() + 2) $$,
  '22023', null, 'a line has at least one tank'
);
select throws_ok(
  $$ select tests.book('no lines', '[]', tests.today() + 2) $$,
  '22023', null, 'an order has at least one line'
);
select throws_ok(
  $$ select tests.book('bad type', '[{"tank_type": "pool", "size": "s", "qty": 1}]', tests.today() + 2) $$,
  '22023', null, 'an unknown tank type is refused'
);
select throws_ok(
  $$ select tests.book('twice', jsonb_build_array(tests.line('tank_a_home'), tests.line('tank_a_home')),
       tests.today() + 2) $$,
  '22023', null, 'a saved tank appears once'
);
select throws_ok(
  $$ select tests.book('b tank', jsonb_build_array(tests.line('tank_b')), tests.today() + 2) $$,
  'P0002', 'tank_not_found', 'someone else''s tank is refused'
);
select throws_ok(
  $$ select tests.book('work tank', jsonb_build_array(tests.line('tank_a_work')), tests.today() + 2) $$,
  'P0002', 'tank_not_found', 'a tank from another address is refused'
);

-- Address ---------------------------------------------------------------------

select throws_ok(
  $$ select tests.book('b home', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2,
       p_address => tests.id('b_home')) $$,
  'P0002', 'address_not_found', 'someone else''s address is refused'
);
select public.delete_address(tests.id('a_work'));
select throws_ok(
  $$ select tests.book('deleted', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2,
       p_address => tests.id('a_work')) $$,
  'P0002', 'address_not_found', 'a deleted address is refused'
);

select tests.clear_authentication();
update public.service_areas set active = false;
insert into public.service_areas (name, area)
values ('Elsewhere', 'SRID=4326;MULTIPOLYGON(((40 30, 40.1 30, 40.1 30.1, 40 30.1, 40 30)))');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select tests.book('outside', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2) $$,
  'ZL001', 'outside_service_area', 'an address no longer in the service area is refused'
);
select tests.clear_authentication();
delete from public.service_areas where name = 'Elsewhere';
update public.service_areas set active = true;
select tests.authenticate_as(tests.user_id('+9647801111111'));

-- Slot --------------------------------------------------------------------------

select throws_ok(
  $$ select tests.book('blocked', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 4) $$,
  'ZL004', 'slot_unavailable', 'a blocked date is refused'
);
select lives_ok(
  $$ select tests.book('last day', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 13) $$,
  'the 14th day (today + 13) can be booked'
);
select lives_ok(
  $$ select tests.book('far ahead', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 400) $$,
  'a day long after the old 14-day window can be booked'
);
select throws_ok(
  $$ select tests.book('yesterday', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() - 1) $$,
  'ZL004', 'slot_unavailable', 'a past day is refused'
);
select throws_ok(
  $$ select tests.book('inactive', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2,
       tests.slot('inactive')) $$,
  'ZL004', 'slot_unavailable', 'an inactive slot is refused'
);
select throws_ok(
  $$ select tests.book('wrong day', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2,
       tests.slot('one_weekday')) $$,
  'ZL004', 'slot_unavailable', 'a slot on a day it does not run is refused'
);
select throws_ok(
  $$ select tests.book('missing slot', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2,
       -1) $$,
  'ZL004', 'slot_unavailable', 'an unknown slot is refused'
);
select throws_ok(
  $$ select tests.book('1h59', '[{"tank_type": "roof", "size": "s", "qty": 1}]',
       ((date_trunc('minute', now() + interval '1 hour 59 minutes')) at time zone 'Asia/Baghdad')::date,
       tests.slot('cut_late')) $$,
  'ZL004', 'slot_unavailable', 'a slot starting in less than 2 hours is refused'
);
select lives_ok(
  $$ select tests.book('2h', '[{"tank_type": "roof", "size": "s", "qty": 1}]',
       ((date_trunc('minute', now() + interval '2 hours') + interval '1 minute') at time zone 'Asia/Baghdad')::date,
       tests.slot('cut_ok')) $$,
  'a slot starting 2 hours or more from now can be booked'
);

-- Uploads ---------------------------------------------------------------------

select throws_ok(
  $$ select tests.book('5 files', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2,
       p_media => jsonb_build_array(tests.file('p2.jpg'), tests.file('p3.jpg'), tests.file('p4.jpg'),
                                    tests.file('p5.jpg'), tests.file('v2.mp4', 10))) $$,
  'ZL008', 'too_many_files', 'more than 4 files is refused'
);
select throws_ok(
  $$ select tests.book('b file', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2,
       p_media => jsonb_build_array(jsonb_build_object(
         'path', 'customer/' || tests.user_id('+9647802222222') || '/x.jpg'))) $$,
  'ZL009', 'upload_not_found', 'someone else''s upload is refused'
);
select throws_ok(
  $$ select tests.book('no file', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2,
       p_media => jsonb_build_array(tests.file('missing.jpg'))) $$,
  'ZL009', 'upload_not_found', 'an unfinished or missing upload is refused'
);
select throws_ok(
  $$ select tests.book('reused file', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2,
       p_media => jsonb_build_array(tests.file('p1.jpg'))) $$,
  'ZL009', 'upload_not_found', 'a file already attached to an order is refused'
);
select throws_ok(
  $$ select tests.book('no duration', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2,
       p_media => jsonb_build_array(tests.file('v2.mp4'))) $$,
  '23514', null, 'a video needs its duration'
);
select throws_ok(
  $$ select tests.book('long video', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2,
       p_media => jsonb_build_array(tests.file('v2.mp4', 61))) $$,
  '23514', null, 'a video over 60 seconds is refused'
);
select lives_ok(
  $$ select tests.book('4 files', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 2,
       p_media => jsonb_build_array(tests.file('p2.jpg'), tests.file('p3.jpg'), tests.file('p4.jpg'),
                                    tests.file('v2.mp4', 60))) $$,
  'up to 4 files can be attached'
);

-- Note, prices, account ----------------------------------------------------------

select throws_ok(
  $$ select tests.book('long note', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 3,
       p_note => repeat('x', 501)) $$,
  '23514', null, 'a note over 500 characters is refused'
);
insert into tests.ids
select 'blank note', tests.book('blank note', '[{"tank_type": "roof", "size": "s", "qty": 1}]',
                                tests.today() + 3, p_note => '');
select is(
  (select customer_note from public.orders where id = tests.id('blank note')),
  null, 'an empty note is stored as no note'
);

select tests.clear_authentication();
delete from public.price_list where tank_type = 'ground' and size = 'm';
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select tests.book('no price', '[{"tank_type": "ground", "size": "m", "qty": 1}]', tests.today() + 5) $$,
  'P0002', 'price_not_found', 'a tank without a price cannot be booked'
);

select tests.clear_authentication();
update public.profiles set deleted_at = now() where id = tests.user_id('+9647801111111');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select tests.book('deleted account', '[{"tank_type": "roof", "size": "s", "qty": 1}]', tests.today() + 5) $$,
  '42501', 'not_allowed', 'a deleted account cannot book'
);

select * from finish();
rollback;
