-- RLS audit of migration `no_booking_limits` (spec §5.9, §6, §7; no booking
-- window and no tank limit, settled Oct 30, 2026).
--
-- - booking_availability(date, date) replaced booking_availability(): the old
--   overload is gone, EXECUTE is granted to authenticated only (not PUBLIC,
--   not anon).
-- - create_order() takes any number of tanks, but what it stores must stay
--   storable: a line whose quantity times its price is beyond an integer is
--   refused as 22023 invalid_items (not an unhandled 22003), a total beyond
--   orders.total_iqd is refused the same way, and the total stored is exact.
-- - An order has a bounded number of lines: without max_tanks_per_order
--   nothing else stopped one call from inserting thousands of tanks and
--   order lines (5,000 in about 2 s, inside the 8 s statement timeout).
-- - "Any future day" still means a day the app can show: a service date the
--   app's JavaScript dates can't hold (year 10000 and later, or infinity) is
--   refused as ZL004 slot_unavailable, on booking and on a customer's
--   reschedule. Otherwise a customer calling the RPC directly stores an order
--   whose date makes Intl.DateTimeFormat throw (RangeError) in the admin
--   order table and the customer's own screens.
begin;
\ir _helpers.psql

select plan(10);

select tests.create_user('+9647801111111');            -- customer

delete from public.service_areas;
insert into public.service_areas (name, area)
values ('Test Karbala', 'SRID=4326;MULTIPOLYGON(((43.9 32.5, 44.1 32.5, 44.1 32.7, 43.9 32.7, 43.9 32.5)))');

update public.slots set active = false;
delete from public.blocked_dates;
update public.settings as s set cancel_cutoff_hours = 2 where s.id;
update public.price_list set price_iqd = 50000 where tank_type = 'roof' and size = 'l';
update public.price_list set price_iqd = 120000 where tank_type = 'ground' and size = 'l';
update public.price_list set price_iqd = 25000 where tank_type = 'roof' and size = 's';

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

insert into tests.ids values ('home', tests.create_address(tests.user_id('+9647801111111'), 'home'));
create table tests.slot (id bigint not null);
insert into tests.slot select tests.create_slot('07:00', '09:00', 5);

-- An order to reschedule, three days ahead in the test slot.
insert into tests.ids values ('order', tests.create_order(
  tests.user_id('+9647801111111'), 'pending_confirmation',
  ((tests.today() + 3) + time '07:00') at time zone 'Asia/Baghdad',
  p_slot_id => (select id from tests.slot)
));

-- create_order on A's home in the test slot.
create function tests.book(p_request text, p_items jsonb, p_date date default null)
returns uuid
language sql
as $$
  select order_id from public.create_order(
    p_request_id => md5(p_request)::uuid,
    p_address_id => tests.id('home'),
    p_service_date => coalesce(p_date, tests.today() + 1),
    p_slot_id => (select id from tests.slot),
    p_items => p_items
  );
$$;

grant select on tests.slot to authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- Grants on the recreated function --------------------------------------------------------

select results_eq(
  $$ select p.oid::regprocedure::text,
       has_function_privilege('anon', p.oid, 'execute'),
       has_function_privilege('authenticated', p.oid, 'execute'),
       coalesce(p.proacl::text like '%,=X/%' or p.proacl::text like '{=X/%', true)
     from pg_proc as p
     join pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'booking_availability' $$,
  $$ values ('booking_availability(date,date)', false, true, false) $$,
  'booking_availability is only the (date, date) version, run by authenticated, not by PUBLIC or anon'
);

-- Quantities --------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select lives_ok(
  $$ select tests.book('max line', '[{"tank_type": "roof", "size": "l", "qty": 32767}]') $$,
  'the largest line that fits can be booked'
);
select results_eq(
  $$ select o.total_iqd, i.qty::int from public.orders as o
     join public.order_items as i on i.order_id = o.id
     where o.client_request_id = md5('max line')::uuid $$,
  $$ values (1638350000, 32767) $$,
  'and is stored with its exact total'
);
select throws_ok(
  $$ select tests.book('total too big', '[{"tank_type": "roof", "size": "l", "qty": 32767},
                                          {"tank_type": "roof", "size": "l", "qty": 32767}]') $$,
  '22023', 'invalid_items', 'a total beyond an integer is refused as invalid_items'
);
select throws_ok(
  $$ select tests.book('line too big', '[{"tank_type": "ground", "size": "l", "qty": 32767}]') $$,
  '22023', 'invalid_items',
  'a single line whose quantity times its price is beyond an integer is refused as invalid_items, not 22003'
);
select throws_ok(
  $$ select tests.book('many lines', (
       select jsonb_agg('{"tank_type": "roof", "size": "s", "qty": 1}'::jsonb)
       from generate_series(1, 1000)
     )) $$,
  '22023', 'invalid_items', 'an order with 1,000 lines is refused'
);
select is(
  (select count(*)::int from public.tanks where address_id = tests.id('home')),
  2, 'and it saved none of its tanks (only the fixture order''s and the largest line''s)'
);

-- Dates -------------------------------------------------------------------------------------

select throws_ok(
  $$ select tests.book('year 10000', '[{"tank_type": "roof", "size": "s", "qty": 1}]', date '10000-01-01') $$,
  'ZL004', 'slot_unavailable', 'a day the app cannot show (year 10000) cannot be booked'
);
select throws_ok(
  $$ select tests.book('infinity', '[{"tank_type": "roof", "size": "s", "qty": 1}]', 'infinity'::date) $$,
  'ZL004', 'slot_unavailable', 'an infinite day cannot be booked (not a 23514 from the insert)'
);
select throws_ok(
  $$ select public.transition_order(
       tests.id('order'), 'pending_confirmation',
       jsonb_build_object('service_date', '10000-01-01', 'slot_id', (select id from tests.slot))
     ) $$,
  'ZL004', 'slot_unavailable', 'a customer cannot reschedule to year 10000'
);

select * from finish();
rollback;
