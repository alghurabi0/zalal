-- booking_availability() (spec §5.9, N7, §6): one row per day and slot in
-- the booking window (today in Baghdad plus booking_window_days - 1 days),
-- for active slots on their weekdays, leaving out blocked dates. Each row
-- has the places left (capacity minus places held, never below 0) and
-- whether it can be booked: a place is left and the slot starts at least
-- cancel_cutoff_hours from now. Logged-in users only; guests are sent to
-- login before Booking.
begin;
\ir _helpers.psql

select plan(14);

select tests.create_user('+9647801111111');            -- customer
select tests.create_user('+9647703333333', 'crew');

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
grant execute on function tests.today() to anon, authenticated;

-- Slots and dates the test controls.
update public.slots set active = false;
delete from public.blocked_dates;
update public.settings set booking_window_days = 14, cancel_cutoff_hours = 2;

select tests.create_slot('07:00', '09:00', 2);           -- every day
insert into public.slots (start_time, end_time, capacity, weekdays)
values ('19:00', '21:00', 1, array[extract(dow from tests.today() + 2)::smallint]);
insert into public.slots (start_time, end_time, capacity, weekdays, active)
values ('12:00', '13:00', 5, '{0,1,2,3,4,5,6}', false);
insert into public.blocked_dates (date) values (tests.today() + 5);

create function tests.s1() returns bigint language sql stable
as $$ select id from public.slots where start_time = '07:00' and end_time = '09:00' $$;
grant execute on function tests.s1() to anon, authenticated;

-- Tomorrow's 07:00 slot is full; a cancelled order holds no place.
select tests.create_order(
  tests.user_id('+9647801111111'), 'confirmed',
  ((tests.today() + 1) + time '07:00') at time zone 'Asia/Baghdad', p_slot_id => tests.s1()
);
select tests.create_order(
  tests.user_id('+9647801111111'), 'pending_confirmation',
  ((tests.today() + 1) + time '07:00') at time zone 'Asia/Baghdad', p_slot_id => tests.s1()
);
select tests.create_order(
  tests.user_id('+9647801111111'), 'cancelled',
  ((tests.today() + 3) + time '07:00') at time zone 'Asia/Baghdad', p_slot_id => tests.s1()
);

-- Guest ----------------------------------------------------------------------

select tests.authenticate_as_anon();

select throws_ok(
  $$ select * from public.booking_availability() $$,
  '42501', null, 'a guest cannot read availability'
);

-- Customer ---------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select results_eq(
  $$ select min(service_date), max(service_date), count(distinct service_date)::int
     from public.booking_availability() $$,
  $$ values (tests.today(), tests.today() + 13, 13) $$,
  'the window is today plus 13 days, without the blocked date'
);
select is_empty(
  $$ select * from public.booking_availability() where service_date = tests.today() + 5 $$,
  'a blocked date has no slots'
);
select is(
  (select count(*)::int from public.booking_availability() where slot_id = tests.s1()),
  13, 'a slot open every day appears on each open day'
);
select results_eq(
  $$ select service_date from public.booking_availability()
     where slot_id <> tests.s1() order by 1 $$,
  $$ values (tests.today() + 2), (tests.today() + 9) $$,
  'a slot appears only on its weekdays'
);
select is(
  (select count(*)::int from public.booking_availability()),
  15, 'inactive slots are left out'
);
select results_eq(
  $$ select start_at, end_at, capacity::int, remaining from public.booking_availability()
     where slot_id = tests.s1() and service_date = tests.today() + 2 $$,
  $$ values (((tests.today() + 2) + time '07:00') at time zone 'Asia/Baghdad',
             ((tests.today() + 2) + time '09:00') at time zone 'Asia/Baghdad', 2, 2) $$,
  'start and end are the slot times in Baghdad'
);
select results_eq(
  $$ select remaining, bookable from public.booking_availability()
     where slot_id = tests.s1() and service_date = tests.today() + 1 $$,
  $$ values (0, false) $$,
  'a full slot has no places and cannot be booked'
);
select results_eq(
  $$ select remaining from public.booking_availability()
     where slot_id = tests.s1() and service_date = tests.today() + 3 $$,
  $$ values (2) $$,
  'a cancelled order holds no place'
);
select ok(
  (select bool_and(bookable = (remaining > 0 and start_at >= now() + interval '2 hours'))
   from public.booking_availability()),
  'a slot can be booked when a place is left and it starts at least 2 hours from now'
);

-- A lower capacity never shows fewer than 0 places.
select tests.clear_authentication();
update public.slots set capacity = 1 where id = tests.s1();
select tests.authenticate_as(tests.user_id('+9647801111111'));

select results_eq(
  $$ select service_date, remaining from public.booking_availability()
     where slot_id = tests.s1() and service_date in (tests.today() + 1, tests.today() + 3)
     order by 1 $$,
  $$ values (tests.today() + 1, 0), (tests.today() + 3, 1) $$,
  'places left follow the current capacity and never go below 0'
);

-- The window and the cutoff come from settings.
select tests.clear_authentication();
update public.settings set booking_window_days = 3, cancel_cutoff_hours = 0;
select tests.authenticate_as(tests.user_id('+9647801111111'));

select results_eq(
  $$ select min(service_date), max(service_date) from public.booking_availability() $$,
  $$ values (tests.today(), tests.today() + 2) $$,
  'the window follows booking_window_days'
);
select ok(
  (select bool_and(bookable = (remaining > 0 and start_at >= now()))
   from public.booking_availability()),
  'the cutoff follows cancel_cutoff_hours'
);

-- Crew -------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));

select lives_ok(
  $$ select * from public.booking_availability() $$,
  'other logged-in roles can read availability too (nothing in it is private)'
);

select * from finish();
rollback;
