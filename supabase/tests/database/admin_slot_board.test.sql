-- admin_slot_board(from, to) (spec §8.2 A2, §6): the date × slot board and
-- the admin reschedule picker. Admins only (42501 for everyone else; guests
-- can't call it). One row per day in the range and slot that runs that day
-- (active, on its weekdays), plus any slot that still holds places that day
-- (switched off or moved off the weekday since), so no booked order drops
-- off the board. Each row has the capacity, the places taken (cancelled
-- orders hold none), whether the day is blocked, and whether an admin can
-- book it: the slot runs that day, the day isn't blocked, the slot hasn't
-- started and a place is left. Admins aren't held to the booking window or
-- the 2 h cutoff (bookable_slot with staff rules). At most 62 days at once,
-- and from must not be after to (22023).
begin;
\ir _helpers.psql

select plan(16);

select tests.create_user('+9647801111111');            -- customer
select tests.create_user('+9647802222222');            -- another customer
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

update public.slots set active = false;
delete from public.blocked_dates;
update public.settings set booking_window_days = 14, cancel_cutoff_hours = 2;

-- Every day, 2 places.
select tests.create_slot('07:00', '09:00', 2);
create function tests.s1() returns bigint language sql stable
as $$ select id from public.slots where start_time = '07:00' and end_time = '09:00' $$;
-- Only on the weekday of today + 2, 1 place.
insert into public.slots (start_time, end_time, capacity, weekdays)
values ('19:00', '21:00', 1, array[extract(dow from tests.today() + 2)::smallint]);
create function tests.s2() returns bigint language sql stable
as $$ select id from public.slots where start_time = '19:00' and end_time = '21:00' $$;
-- Switched off, but an order still holds a place in it on day 3.
insert into public.slots (start_time, end_time, capacity, weekdays, active)
values ('12:00', '13:00', 5, '{0,1,2,3,4,5,6}', false);
create function tests.s_off() returns bigint language sql stable
as $$ select id from public.slots where start_time = '12:00' and end_time = '13:00' $$;
insert into public.blocked_dates (date) values (tests.today() + 4);

create function tests.at(p_day int, p_time time) returns timestamptz language sql stable
as $$ select ((tests.today() + p_day) + p_time) at time zone 'Asia/Baghdad' $$;

-- Day 1, 07:00: full. A cancelled order holds no place.
select tests.create_order(tests.user_id('+9647801111111'), 'confirmed', tests.at(1, '07:00'), p_slot_id => tests.s1());
select tests.create_order(tests.user_id('+9647802222222'), 'pending_confirmation', tests.at(1, '07:00'), p_slot_id => tests.s1());
select tests.create_order(tests.user_id('+9647801111111'), 'cancelled', tests.at(1, '07:00'), p_slot_id => tests.s1());
-- Day 3, the switched-off slot.
select tests.create_order(tests.user_id('+9647801111111'), 'confirmed', tests.at(3, '12:00'), p_slot_id => tests.s_off());
-- Yesterday, so the start is in the past.
select tests.create_order(tests.user_id('+9647801111111'), 'completed', tests.at(-1, '07:00'), p_slot_id => tests.s1());

grant execute on all functions in schema tests to anon, authenticated;

-- Guest, customer, crew ----------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.admin_slot_board(tests.today(), tests.today() + 6) $$,
  '42501', null, 'a guest cannot read the board'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select * from public.admin_slot_board(tests.today(), tests.today() + 6) $$,
  '42501', 'not_allowed', 'a customer cannot read the board'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select * from public.admin_slot_board(tests.today(), tests.today() + 6) $$,
  '42501', 'not_allowed', 'another customer cannot read the board'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select * from public.admin_slot_board(tests.today(), tests.today() + 6) $$,
  '42501', 'not_allowed', 'a crew cannot read the board'
);

-- Admin ----------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select is(
  (select count(*)::int from public.admin_slot_board(tests.today(), tests.today() + 6)
   where slot_id = tests.s1()),
  7, 'the every-day slot is on each of 7 days, blocked day included'
);
select results_eq(
  $$ select service_date from public.admin_slot_board(tests.today(), tests.today() + 6)
     where slot_id = tests.s2() $$,
  $$ values (tests.today() + 2) $$,
  'a weekday slot shows only on its weekday'
);
select results_eq(
  $$ select service_date, taken, bookable from public.admin_slot_board(tests.today(), tests.today() + 6)
     where slot_id = tests.s_off() $$,
  $$ values (tests.today() + 3, 1, false) $$,
  'a switched-off slot shows only where it still holds a place, and is not bookable'
);
select results_eq(
  $$ select capacity, taken, blocked, bookable,
            start_at = tests.at(1, '07:00'), end_at = tests.at(1, '09:00')
     from public.admin_slot_board(tests.today() + 1, tests.today() + 1)
     where slot_id = tests.s1() $$,
  $$ values (2::smallint, 2, false, false, true, true) $$,
  'a full slot: 2 of 2 taken (the cancelled order holds none), not bookable, Baghdad times'
);
select results_eq(
  $$ select taken, blocked, bookable from public.admin_slot_board(tests.today() + 4, tests.today() + 4)
     where slot_id = tests.s1() $$,
  $$ values (0, true, false) $$,
  'a blocked day is shown as blocked and not bookable'
);
select results_eq(
  $$ select taken, bookable from public.admin_slot_board(tests.today() + 2, tests.today() + 2)
     where slot_id = tests.s1() $$,
  $$ values (0, true) $$,
  'a free slot is bookable'
);
select results_eq(
  $$ select taken, bookable from public.admin_slot_board(tests.today() - 1, tests.today() - 1)
     where slot_id = tests.s1() $$,
  $$ values (1, false) $$,
  'a slot that has started is not bookable'
);

-- Admins aren't held to the window or the cutoff.
select results_eq(
  $$ select bookable from public.admin_slot_board(tests.today() + 20, tests.today() + 20)
     where slot_id = tests.s1() $$,
  $$ values (true) $$,
  'an admin can book past the customer booking window'
);
-- A slot that starts in 30 minutes, inside the 2 h cutoff.
select tests.clear_authentication();
create function tests.soon() returns timestamp language sql stable
as $$ select date_trunc('minute', (now() + interval '30 minutes') at time zone 'Asia/Baghdad') $$;
insert into public.slots (start_time, end_time, capacity, weekdays)
values (
  tests.soon()::time,
  least(tests.soon()::time + interval '1 minute', time '23:59:59'),
  1, '{0,1,2,3,4,5,6}'
);
create function tests.s3() returns bigint language sql stable
as $$ select id from public.slots where start_time = tests.soon()::time $$;
grant execute on all functions in schema tests to anon, authenticated;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select results_eq(
  $$ select bookable from public.admin_slot_board(tests.soon()::date, tests.soon()::date)
     where slot_id = tests.s3() $$,
  $$ values (true) $$,
  'a slot inside the cutoff stays bookable for admins until it starts'
);

select throws_ok(
  $$ select * from public.admin_slot_board(tests.today(), tests.today() + 62) $$,
  '22023', 'invalid_range', 'at most 62 days at once'
);
select throws_ok(
  $$ select * from public.admin_slot_board(tests.today() + 1, tests.today()) $$,
  '22023', 'invalid_range', 'from must not be after to'
);
select lives_ok(
  $$ select * from public.admin_slot_board(tests.today(), tests.today() + 61) $$,
  '62 days is fine'
);

select * from finish();
rollback;
