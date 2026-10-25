-- price_list, slots and blocked_dates (spec §5.9, §7, §10.2; A8, A9).
-- Everyone, guests included, reads the prices and the active slots. Admins
-- also read inactive slots and the blocked dates; customers and crews learn
-- about blocked dates and free places only through booking_availability().
-- Nobody writes through the API: admin edits come in Phase 3 as audited RPCs.
-- The starting prices and slots come from the migration, so hosted projects
-- have them too.
begin;
\ir _helpers.psql

select plan(36);

select tests.create_user('+9647801111111');
select tests.create_user('+9647703333333', 'crew');
select tests.create_user('+9647504444444', 'admin');

-- Shape and starting data ------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.price_list'::regclass),
  'price_list has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.slots'::regclass),
  'slots has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.blocked_dates'::regclass),
  'blocked_dates has RLS enabled'
);

select results_eq(
  $$ select tank_type::text, size::text, price_iqd from public.price_list
     order by price_iqd $$,
  $$ values ('roof', 's', 25000), ('roof', 'm', 35000), ('roof', 'l', 50000),
            ('ground', 's', 60000), ('ground', 'm', 80000), ('ground', 'l', 120000) $$,
  'the migration seeds the six design prices'
);

select results_eq(
  $$ select start_time, end_time, capacity::int, weekdays, active from public.slots
     order by start_time $$,
  $$ values ('08:00'::time, '10:00'::time, 2, '{0,1,2,3,4,6}'::smallint[], true),
            ('10:00'::time, '12:00'::time, 2, '{0,1,2,3,4,6}'::smallint[], true),
            ('16:00'::time, '18:00'::time, 2, '{0,1,2,3,4,6}'::smallint[], true) $$,
  'the migration seeds three slots of 2 places, Saturday to Thursday'
);

-- Constraints --------------------------------------------------------------

select throws_ok(
  $$ update public.price_list set price_iqd = 0 where tank_type = 'roof' and size = 's' $$,
  '23514', null, 'a price must be positive'
);
select throws_ok(
  $$ insert into public.price_list (tank_type, size, price_iqd) values ('roof', 's', 1000) $$,
  '23505', null, 'one price per type and size'
);
select throws_ok(
  $$ insert into public.slots (start_time, end_time, capacity, weekdays)
     values ('12:00', '11:00', 2, '{0}') $$,
  '23514', null, 'a slot ends after it starts'
);
select throws_ok(
  $$ insert into public.slots (start_time, end_time, capacity, weekdays)
     values ('12:00', '13:00', 0, '{0}') $$,
  '23514', null, 'a slot has at least one place'
);
select throws_ok(
  $$ insert into public.slots (start_time, end_time, capacity, weekdays)
     values ('12:00', '13:00', 2, '{7}') $$,
  '23514', null, 'weekdays are 0-6'
);
select throws_ok(
  $$ insert into public.slots (start_time, end_time, capacity, weekdays)
     values ('12:00', '13:00', 2, '{}') $$,
  '23514', null, 'a slot runs on at least one weekday'
);
select throws_ok(
  $$ insert into public.slots (start_time, end_time, capacity, weekdays)
     values ('08:00', '10:00', 3, '{5}') $$,
  '23505', null, 'two slots cannot have the same times'
);
select throws_ok(
  $$ insert into public.blocked_dates (date, reason) values ('2026-12-01', ' عطلة') $$,
  '23514', null, 'a blocked-date reason is trimmed'
);

insert into public.slots (start_time, end_time, capacity, weekdays, active)
values ('18:00', '20:00', 2, '{0,1,2,3,4,5,6}', false);
insert into public.blocked_dates (date, reason) values ('2026-12-01', 'عطلة');

-- Guest ------------------------------------------------------------------------

select tests.authenticate_as_anon();

select is((select count(*)::int from public.price_list), 6, 'a guest reads the prices');
select is((select count(*)::int from public.slots), 3, 'a guest reads only active slots');
select throws_ok(
  $$ select * from public.blocked_dates $$,
  '42501', null, 'a guest cannot read blocked dates'
);
select throws_ok(
  $$ update public.price_list set price_iqd = 1000 $$,
  '42501', null, 'a guest cannot change prices'
);
select throws_ok(
  $$ insert into public.slots (start_time, end_time, capacity, weekdays) values ('20:00', '21:00', 2, '{0}') $$,
  '42501', null, 'a guest cannot add slots'
);

-- Customer ---------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select is((select count(*)::int from public.price_list), 6, 'a customer reads the prices');
select is((select count(*)::int from public.slots), 3, 'a customer reads only active slots');
select is_empty($$ select * from public.blocked_dates $$, 'a customer reads no blocked dates');
select throws_ok(
  $$ update public.price_list set price_iqd = 1000 $$,
  '42501', null, 'a customer cannot change prices'
);
select throws_ok(
  $$ update public.slots set capacity = 20 $$,
  '42501', null, 'a customer cannot change slots'
);
select throws_ok(
  $$ insert into public.blocked_dates (date) values ('2026-12-02') $$,
  '42501', null, 'a customer cannot block dates'
);
select throws_ok(
  $$ delete from public.slots $$,
  '42501', null, 'a customer cannot delete slots'
);

-- Crew ------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));

select is((select count(*)::int from public.slots), 3, 'a crew reads only active slots');
select is_empty($$ select * from public.blocked_dates $$, 'a crew reads no blocked dates');
select throws_ok(
  $$ update public.price_list set price_iqd = 1000 $$,
  '42501', null, 'a crew cannot change prices'
);

-- Admin ----------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select is((select count(*)::int from public.price_list), 6, 'an admin reads the prices');
select is((select count(*)::int from public.slots), 4, 'an admin reads inactive slots too');
select results_eq(
  $$ select date, reason from public.blocked_dates $$,
  $$ values ('2026-12-01'::date, 'عطلة'::text) $$,
  'an admin reads the blocked dates'
);
-- Until the audited admin RPCs (Phase 3), admins only read.
select throws_ok(
  $$ update public.price_list set price_iqd = 1000 $$,
  '42501', null, 'an admin cannot change prices directly'
);
select throws_ok(
  $$ update public.slots set capacity = 5 $$,
  '42501', null, 'an admin cannot change slots directly'
);
select throws_ok(
  $$ insert into public.blocked_dates (date) values ('2026-12-02') $$,
  '42501', null, 'an admin cannot block dates directly'
);
select throws_ok(
  $$ delete from public.blocked_dates $$,
  '42501', null, 'an admin cannot unblock dates directly'
);

-- Server ---------------------------------------------------------------------

select tests.authenticate_as_service_role();

select lives_ok(
  $$ update public.price_list set price_iqd = 30000 where tank_type = 'roof' and size = 's' $$,
  'the server (owner SQL) can change prices'
);

select * from finish();
rollback;
