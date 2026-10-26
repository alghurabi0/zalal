-- create_order(..., p_expected_total) (spec §5.11, §8.2 A8): once admins can
-- change prices, a customer may be on Checkout with an old price. The app
-- sends the total the customer saw; when the current prices give another
-- total, the booking is refused with ZL018 price_changed and nothing is
-- written, so Checkout can reload with the new price. Without
-- p_expected_total (an app deployed before this check) the booking goes
-- through at the current prices.
begin;
\ir _helpers.psql

select plan(6);

select tests.create_user('+9647801111111');

delete from public.service_areas;
insert into public.service_areas (name, area)
values ('Test Karbala', 'SRID=4326;MULTIPOLYGON(((43.9 32.5, 44.1 32.5, 44.1 32.7, 43.9 32.7, 43.9 32.5)))');
update public.slots set active = false;
delete from public.blocked_dates;
update public.settings set booking_window_days = 14, cancel_cutoff_hours = 2, max_tanks_per_order = 6;
update public.price_list set price_iqd = 35000 where tank_type = 'roof' and size = 'm';
update public.price_list set price_iqd = 60000 where tank_type = 'ground' and size = 's';
select tests.create_slot('07:00', '09:00', 5);
select tests.create_address(tests.user_id('+9647801111111'));

create function tests.book(p_request text, p_expected int) returns uuid language sql
as $$
  select order_id from public.create_order(
    p_request_id => md5(p_request)::uuid,
    p_address_id => (select id from public.addresses where user_id = tests.user_id('+9647801111111')),
    p_service_date => (now() at time zone 'Asia/Baghdad')::date + 1,
    p_slot_id => (select id from public.slots where start_time = '07:00' and end_time = '09:00'),
    p_items => '[{"tank_type": "roof", "size": "m", "qty": 2}, {"tank_type": "ground", "size": "s", "qty": 1}]',
    p_expected_total => p_expected
  );
$$;

grant execute on all functions in schema tests to authenticated;

select tests.authenticate_as(tests.user_id('+9647801111111'));

select throws_ok(
  $$ select tests.book('old price', 120000) $$,
  'ZL018', 'price_changed', 'a total that no longer matches the prices is refused'
);
select is((select count(*)::int from public.orders), 0, 'and nothing was booked');
select isnt(tests.book('right price', 130000), null, 'the current total books');
select is(
  (select total_iqd from public.orders where client_request_id = md5('right price')::uuid),
  130000,
  'at that total'
);
select isnt(tests.book('no check', null), null, 'without an expected total the booking goes through');
select is((select count(*)::int from public.orders), 2, 'two orders in all');

select * from finish();
rollback;
