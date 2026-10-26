-- admin_schedule_conflicts() (spec §8.2 A9, §6): booked orders whose place no
-- longer fits the schedule, so the admin can reschedule them by hand.
-- Admins only (42501 for everyone else; guests can't call it). It lists
-- pending and confirmed orders whose slot hasn't started yet, with one
-- reason each, checked in this order: 'blocked' (the day is blocked),
-- 'slot_off' (the slot is switched off), 'weekday' (the slot no longer runs
-- that weekday), 'over_capacity' (the slot has fewer places than orders that
-- day; the orders past the capacity, by seat, are listed). Orders that fit,
-- that already started, or that are on the way or later are not listed.
begin;
\ir _helpers.psql

select plan(7);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.at(p_day int, p_time time) returns timestamptz language sql stable
as $$ select ((tests.today() + p_day) + p_time) at time zone 'Asia/Baghdad' $$;
create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;

delete from public.blocked_dates;
update public.slots set active = false;

-- Every day, 3 places, then lowered to 1 below.
select tests.create_slot('07:00', '08:00', 3);
create function tests.s_full() returns bigint language sql stable
as $$ select id from public.slots where start_time = '07:00' and end_time = '08:00' $$;
-- Every day, switched off below.
select tests.create_slot('08:00', '09:00', 3);
create function tests.s_off() returns bigint language sql stable
as $$ select id from public.slots where start_time = '08:00' and end_time = '09:00' $$;
-- Every day but the weekday of day 2, set below.
select tests.create_slot('09:00', '10:00', 3);
create function tests.s_days() returns bigint language sql stable
as $$ select id from public.slots where start_time = '09:00' and end_time = '10:00' $$;

insert into tests.ids values
  ('full1', tests.create_order(tests.a(), 'confirmed', tests.at(2, '07:00'), p_slot_id => tests.s_full())),
  ('full2', tests.create_order(tests.a(), 'pending_confirmation', tests.at(2, '07:00'), p_slot_id => tests.s_full())),
  ('full3', tests.create_order(tests.a(), 'confirmed', tests.at(2, '07:00'), p_slot_id => tests.s_full())),
  ('off', tests.create_order(tests.a(), 'confirmed', tests.at(3, '08:00'), p_slot_id => tests.s_off())),
  ('off_past', tests.create_order(tests.a(), 'completed', tests.at(-1, '08:00'), p_slot_id => tests.s_off())),
  ('weekday', tests.create_order(tests.a(), 'pending_confirmation', tests.at(2, '09:00'), p_slot_id => tests.s_days())),
  ('weekday_ok', tests.create_order(tests.a(), 'confirmed', tests.at(3, '09:00'), p_slot_id => tests.s_days())),
  ('blocked', tests.create_order(tests.a(), 'confirmed', tests.at(4, '09:00'), p_slot_id => tests.s_days())),
  ('blocked_otw', tests.create_order(tests.a(), 'on_the_way', tests.at(4, '09:00'), p_slot_id => tests.s_days())),
  ('blocked_off', tests.create_order(tests.a(), 'confirmed', tests.at(4, '08:00'), p_slot_id => tests.s_off())),
  ('fine', tests.create_order(tests.user_id('+9647802222222'), 'confirmed', tests.at(5, '07:00'), p_slot_id => tests.s_full()));

-- The first order on day 2 is cancelled after the others booked: its seat
-- frees up, so 2 orders remain for 1 place and only the later seat is over.
update public.orders set status = 'cancelled' where id = tests.id('full1');
delete from public.slot_bookings where order_id = tests.id('full1');

update public.slots set capacity = 1 where id = tests.s_full();
update public.slots set active = false where id = tests.s_off();
update public.slots
set weekdays = array(select d from generate_series(0, 6) as d where d <> extract(dow from tests.today() + 2))::smallint[]
where id = tests.s_days();
insert into public.blocked_dates (date) values (tests.today() + 4);

grant execute on all functions in schema tests to anon, authenticated;

select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.admin_schedule_conflicts() $$,
  '42501', null, 'a guest cannot read the conflicts'
);
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select * from public.admin_schedule_conflicts() $$,
  '42501', 'not_allowed', 'a customer cannot read the conflicts'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select * from public.admin_schedule_conflicts() $$,
  '42501', 'not_allowed', 'another customer cannot read the conflicts'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select * from public.admin_schedule_conflicts() $$,
  '42501', 'not_allowed', 'a crew cannot read the conflicts'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select results_eq(
  $$ select order_id, reason from public.admin_schedule_conflicts() order by slot_start_at, reason $$,
  $$ values
       (tests.id('full3'), 'over_capacity'),
       (tests.id('weekday'), 'weekday'),
       (tests.id('off'), 'slot_off'),
       (tests.id('blocked_off'), 'blocked'),
       (tests.id('blocked'), 'blocked') $$,
  'an admin sees each order that no longer fits, with its reason'
);
select results_eq(
  $$ select number, service_date, slot_id, status::text from public.admin_schedule_conflicts()
     where order_id = tests.id('off') $$,
  $$ select number, service_date, slot_id, status::text from public.orders where id = tests.id('off') $$,
  'each row names the order, its day, slot and status'
);
select is(
  (select count(*)::int from public.slot_bookings),
  10,
  'listing changes nothing'
);

select * from finish();
rollback;
