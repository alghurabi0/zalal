-- transition_order() (spec §6): the one way an order's status changes.
-- Customer: cancel (with an N6 reason) or reschedule (new date and slot,
-- back to pending_confirmation) from pending_confirmation or confirmed, only
-- while the slot starts at least cancel_cutoff_hours from now (ZL006).
-- Crew (assigned, active): confirmed -> on_the_way -> arrived -> in_progress
-- -> completed (needs cash collected), or no_show from
-- confirmed/on_the_way/arrived with a note. Before and after photos are
-- optional (settled Oct 26, 2026; migration crew_jobs).
-- Admin: confirm, cancel with a reason, reschedule and no_show at any time;
-- any other move is an override that needs a reason. Every change writes
-- order_events; admin changes also write admin_audit_log. Cancelling frees
-- the place, rescheduling moves it, and an override out of cancelled takes a
-- place again (ZL005 if full). Completion marks the order's tanks cleaned.
-- Moves outside the table fail with ZL010; missing requirements with ZL011.
-- Staff notes (an admin's cancel reason, a no-show note, an override reason)
-- go to order_event_notes, which only admins and the assigned crew read,
-- never the customer (settled Oct 25, 2026).
begin;
\ir _helpers.psql

select plan(69);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.at_main(p_day int) returns timestamptz language sql stable
as $$ select ((tests.today() + p_day) + time '07:00') at time zone 'Asia/Baghdad' $$;

update public.slots set active = false;
delete from public.blocked_dates;
update public.settings set booking_window_days = 14, cancel_cutoff_hours = 2;
select tests.create_slot('07:00', '09:00', 2);
create function tests.main() returns bigint language sql stable
as $$ select id from public.slots where start_time = '07:00' and end_time = '09:00' $$;
insert into public.blocked_dates (date) values (tests.today() + 4);

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;

-- Orders in the fixture slot unless named otherwise.
insert into tests.ids values
  ('p_2h', tests.create_order(tests.a(), 'pending_confirmation', now() + interval '2 hours')),
  ('p_1h59', tests.create_order(tests.a(), 'pending_confirmation', now() + interval '1 hour 59 minutes')),
  ('c_3d', tests.create_order(tests.a(), 'confirmed', now() + interval '3 days')),
  ('p_b', tests.create_order(tests.user_id('+9647802222222'), 'pending_confirmation')),
  ('otw', tests.create_order(tests.a(), 'on_the_way', now() + interval '1 hour', tests.id('crew1'))),
  ('job', tests.create_order(tests.a(), 'confirmed', now() + interval '1 hour', tests.id('crew1'))),
  ('ns', tests.create_order(tests.a(), 'confirmed', now() + interval '1 hour', tests.id('crew1'))),
  ('adm_p', tests.create_order(tests.a(), 'pending_confirmation', now() + interval '30 minutes')),
  ('adm_c', tests.create_order(tests.a(), 'confirmed', now() + interval '30 minutes')),
  ('adm_r', tests.create_order(tests.a(), 'confirmed', now() + interval '30 minutes')),
  ('adm_o', tests.create_order(tests.a(), 'pending_confirmation')),
  ('cancelled', tests.create_order(tests.a(), 'cancelled')),
  -- The main slot on day 5 is full.
  ('b_full_1', tests.create_order(tests.user_id('+9647802222222'), 'confirmed', tests.at_main(5), p_slot_id => tests.main())),
  ('b_full_2', tests.create_order(tests.user_id('+9647802222222'), 'confirmed', tests.at_main(5), p_slot_id => tests.main())),
  ('cancelled_full', tests.create_order(tests.a(), 'cancelled', tests.at_main(5), p_slot_id => tests.main()));

create function tests.go(p_order text, p_to text, p_payload jsonb default '{}')
returns void
language sql
as $$ select public.transition_order(tests.id(p_order), p_to::public.order_status, p_payload) $$;

create function tests.status(p_order text) returns text language sql stable
as $$ select status::text from public.orders where id = tests.id(p_order) $$;

-- Places held, read as the test runner.
create function tests.seat_of(p_order text) returns text language sql stable security definer
as $$
  select b.service_date || ' ' || b.slot_id from public.slot_bookings as b
  where b.order_id = tests.id(p_order)
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- Guests and unknown orders -------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select tests.go('p_2h', 'cancelled', '{"cancel_reason": "other"}') $$,
  '42501', null, 'a guest cannot change orders'
);

-- Customer --------------------------------------------------------------------

select tests.authenticate_as(tests.a());

select throws_ok(
  $$ select public.transition_order(gen_random_uuid(), 'cancelled', '{"cancel_reason": "other"}') $$,
  'P0002', 'order_not_found', 'an unknown order is refused'
);

select lives_ok(
  $$ select tests.go('p_2h', 'cancelled', '{"cancel_reason": "plans_changed"}') $$,
  'a customer cancels exactly 2 hours before the slot'
);
select is(tests.status('p_2h'), 'cancelled', 'the order is cancelled');
select results_eq(
  $$ select from_status::text, to_status::text, actor_id, actor_role::text, cancel_reason::text, is_override
     from public.order_events where order_id = tests.id('p_2h') $$,
  $$ values ('pending_confirmation', 'cancelled', tests.a(), 'customer', 'plans_changed', false) $$,
  'the cancel is recorded with its reason'
);
select is(tests.seat_of('p_2h'), null, 'cancelling frees the place');

select throws_ok(
  $$ select tests.go('p_1h59', 'cancelled', '{"cancel_reason": "plans_changed"}') $$,
  'ZL006', 'change_too_late', 'a customer cannot cancel 1 h 59 min before the slot'
);
select throws_ok(
  $$ select tests.go('c_3d', 'cancelled') $$,
  '22023', 'cancel_reason_required', 'a customer gives a reason to cancel'
);
select throws_ok(
  $$ select tests.go('c_3d', 'cancelled', '{"cancel_reason": "bored"}') $$,
  '22023', null, 'the reason is one of the N6 options'
);
select throws_ok(
  $$ select tests.go('p_b', 'cancelled', '{"cancel_reason": "other"}') $$,
  'P0002', 'order_not_found', 'a customer cannot cancel someone else''s order'
);
select throws_ok(
  $$ select tests.go('otw', 'cancelled', '{"cancel_reason": "other"}') $$,
  'ZL010', 'invalid_transition', 'a customer cannot cancel once the crew is on the way'
);
select throws_ok(
  $$ select tests.go('p_1h59', 'confirmed') $$,
  'ZL010', 'invalid_transition', 'a customer cannot confirm'
);
select throws_ok(
  $$ select tests.go('c_3d', 'completed') $$,
  'ZL010', 'invalid_transition', 'a customer cannot complete'
);

-- Reschedule
select lives_ok(
  $$ select tests.go('c_3d', 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 2, 'slot_id', tests.main())) $$,
  'a customer reschedules a confirmed order'
);
select results_eq(
  $$ select status::text, service_date, slot_id, slot_start_at, slot_end_at
     from public.orders where id = tests.id('c_3d') $$,
  $$ values ('pending_confirmation', tests.today() + 2, tests.main(), tests.at_main(2),
             tests.at_main(2) + interval '2 hours') $$,
  'the order moves to the new slot and waits for confirmation again'
);
select is(
  tests.seat_of('c_3d'), (tests.today() + 2) || ' ' || tests.main(),
  'the place moves to the new slot'
);
select results_eq(
  $$ select from_status::text, to_status::text,
       details ->> 'to_service_date', (details ->> 'to_slot_id')::bigint, details ? 'from_service_date'
     from public.order_events where order_id = tests.id('c_3d') $$,
  $$ values ('confirmed', 'pending_confirmation', (tests.today() + 2)::text, tests.main(), true) $$,
  'the reschedule is recorded with the old and new slot'
);
select throws_ok(
  $$ select tests.go('c_3d', 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 2, 'slot_id', tests.main())) $$,
  '22023', 'same_slot', 'rescheduling to the same slot is refused'
);
select throws_ok(
  $$ select tests.go('c_3d', 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 4, 'slot_id', tests.main())) $$,
  'ZL004', 'slot_unavailable', 'rescheduling to a blocked date is refused'
);
select throws_ok(
  $$ select tests.go('c_3d', 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 5, 'slot_id', tests.main())) $$,
  'ZL005', 'slot_full', 'rescheduling to a full slot is refused'
);
select is(
  tests.seat_of('c_3d'), (tests.today() + 2) || ' ' || tests.main(),
  'a refused reschedule keeps the old place'
);
select throws_ok(
  $$ select tests.go('c_3d', 'pending_confirmation') $$,
  '22023', 'new_slot_required', 'a reschedule names the new date and slot'
);
select throws_ok(
  $$ select tests.go('p_1h59', 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 3, 'slot_id', tests.main())) $$,
  'ZL006', 'change_too_late', 'a customer cannot reschedule within 2 hours of the slot'
);

-- Crew -------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));

select lives_ok($$ select tests.go('job', 'on_the_way') $$, 'the crew sets off');
select lives_ok($$ select tests.go('job', 'arrived') $$, 'the crew arrives');
select lives_ok(
  $$ select tests.go('job', 'in_progress') $$,
  'the crew starts work without a before photo'
);
select throws_ok(
  $$ select tests.go('job', 'completed') $$,
  'ZL011', 'cash_not_collected', 'the crew ticks that the cash was collected'
);
select lives_ok(
  $$ select tests.go('job', 'completed', '{"cash_collected": true}') $$,
  'the crew completes the job without an after photo'
);
select is_empty(
  $$ select 1 from public.order_media where order_id = tests.id('job') $$,
  'the job has no photos at all'
);
select results_eq(
  $$ select status::text, cash_collected from public.orders where id = tests.id('job') $$,
  $$ values ('completed', true) $$,
  'the order is completed with the cash collected'
);
select results_eq(
  $$ select to_status::text, actor_role::text from public.order_events
     where order_id = tests.id('job') order by id $$,
  $$ values ('on_the_way', 'crew'), ('arrived', 'crew'), ('in_progress', 'crew'), ('completed', 'crew') $$,
  'each crew step is recorded'
);
select throws_ok(
  $$ select tests.go('job', 'on_the_way') $$,
  'ZL010', 'invalid_transition', 'a completed job cannot go back'
);
select throws_ok(
  $$ select tests.go('p_b', 'on_the_way') $$,
  'P0002', 'order_not_found', 'a crew cannot move an order it is not assigned'
);
select throws_ok(
  $$ select tests.go('ns', 'cancelled', '{"cancel_reason": "other"}') $$,
  'ZL010', 'invalid_transition', 'a crew cannot cancel'
);
select throws_ok(
  $$ select tests.go('ns', 'no_show') $$,
  'ZL011', 'reason_required', 'a no-show needs a note'
);
select lives_ok(
  $$ select tests.go('ns', 'no_show', '{"reason": "ما احد فتح الباب"}') $$,
  'the crew marks a no-show'
);
select isnt(tests.seat_of('ns'), null, 'a no-show keeps its place');
select results_eq(
  $$ select n.note from public.order_event_notes as n
     join public.order_events as e on e.id = n.event_id
     where e.order_id = tests.id('ns') $$,
  $$ values ('ما احد فتح الباب'::text) $$,
  'the crew reads the no-show note on its order'
);

select tests.authenticate_as(tests.user_id('+9647703333334'));
select is_empty(
  $$ select * from public.order_event_notes $$,
  'another crew reads no notes on orders it is not assigned'
);
select throws_ok(
  $$ select tests.go('otw', 'arrived') $$,
  'P0002', 'order_not_found', 'another crew cannot move the order'
);

select tests.clear_authentication();
select is(
  (select last_cleaned_at from public.tanks
   where id = (select tank_id from public.order_items where order_id = tests.id('job'))),
  now(), 'completion marks the order''s tanks cleaned'
);

-- Admin -------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select lives_ok($$ select tests.go('adm_p', 'confirmed') $$, 'an admin confirms a booking');
select results_eq(
  $$ select admin_id, action, entity, entity_id, diff ->> 'from', diff ->> 'to'
     from public.admin_audit_log where entity_id = tests.id('adm_p')::text $$,
  $$ values (tests.user_id('+9647504444444'), 'order.transition', 'orders', tests.id('adm_p')::text,
             'pending_confirmation', 'confirmed') $$,
  'admin changes are written to the audit log'
);
select throws_ok(
  $$ select tests.go('adm_c', 'cancelled') $$,
  'ZL011', 'reason_required', 'an admin gives a reason to cancel'
);
select lives_ok(
  $$ select tests.go('adm_c', 'cancelled', '{"reason": "طلب الزبون بالمحادثة"}') $$,
  'an admin cancels within 2 hours of the slot'
);
select is(tests.seat_of('adm_c'), null, 'an admin cancel frees the place');
select lives_ok(
  $$ select tests.go('adm_r', 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 3, 'slot_id', tests.main())) $$,
  'an admin reschedules within 2 hours of the slot'
);
select is(tests.status('adm_r'), 'pending_confirmation', 'a rescheduled order waits for confirmation');
select throws_ok(
  $$ select tests.go('adm_o', 'completed') $$,
  'ZL010', 'invalid_transition', 'an admin needs an override for a move outside the table'
);
select throws_ok(
  $$ select tests.go('adm_o', 'completed', '{"override": true}') $$,
  'ZL011', 'reason_required', 'an override needs a reason'
);
select lives_ok(
  $$ select tests.go('adm_o', 'completed', '{"override": true, "reason": "الفريق نسى يسكر الطلب"}') $$,
  'an admin overrides with a reason'
);
select results_eq(
  $$ select from_status::text, to_status::text, actor_role::text, is_override
     from public.order_events where order_id = tests.id('adm_o') $$,
  $$ values ('pending_confirmation', 'completed', 'admin', true) $$,
  'the override is recorded as one'
);
select results_eq(
  $$ select e.order_id, n.note from public.order_event_notes as n
     join public.order_events as e on e.id = n.event_id
     where e.order_id in (tests.id('adm_c'), tests.id('adm_o')) order by n.event_id $$,
  $$ values (tests.id('adm_c'), 'طلب الزبون بالمحادثة'::text),
            (tests.id('adm_o'), 'الفريق نسى يسكر الطلب'::text) $$,
  'staff reasons are kept as internal notes'
);
select lives_ok(
  $$ select tests.go('cancelled', 'confirmed', '{"override": true, "reason": "الزبون رجع"}') $$,
  'an admin brings back a cancelled order'
);
select isnt(tests.seat_of('cancelled'), null, 'a restored order takes a place again');
select throws_ok(
  $$ select tests.go('cancelled_full', 'confirmed', '{"override": true, "reason": "الزبون رجع"}') $$,
  'ZL005', 'slot_full', 'a restored order needs a free place'
);
select throws_ok(
  $$ select tests.go('adm_p', 'confirmed', '{"override": true, "reason": "x"}') $$,
  'ZL010', 'invalid_transition', 'an order cannot move to the status it has'
);
select throws_ok(
  $$ select tests.go('p_1h59', 'in_progress', '{"override": true, "reason": " "}') $$,
  'ZL011', 'reason_required', 'a blank reason is no reason'
);
select lives_ok(
  $$ select tests.go('b_full_1', 'no_show', '{"reason": "ما احد بالبيت"}') $$,
  'an admin marks a no-show'
);
select is(
  (select count(*)::int from public.admin_audit_log), 6,
  'every admin change, and only admin changes, is in the audit log'
);

-- Admin reads the whole trail ------------------------------------------------------

select is(
  (select count(*)::int from public.order_events where order_id = tests.id('job')), 4,
  'an admin reads the crew''s events'
);

-- Event rows carry the actor --------------------------------------------------------

select tests.authenticate_as(tests.a());
select results_eq(
  $$ select to_status::text, actor_role::text from public.order_events
     where order_id = tests.id('adm_p') $$,
  $$ values ('confirmed', 'admin') $$,
  'the customer sees who confirmed'
);
select is_empty(
  $$ select * from public.admin_audit_log $$,
  'the customer does not read the audit log'
);
select is_empty(
  $$ select * from public.order_event_notes $$,
  'the customer reads no staff notes on their orders'
);
select hasnt_column(
  'public', 'order_events', 'reason',
  'the timeline customers read has no free-text staff reason'
);

-- Deleted accounts and roles ---------------------------------------------------------

select tests.clear_authentication();
update public.crews set active = false where id = tests.id('crew1');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select tests.go('otw', 'arrived') $$,
  'P0002', 'order_not_found', 'an inactive crew cannot move its orders'
);

select tests.clear_authentication();
update public.profiles set deleted_at = now() where id = tests.a();
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select tests.go('p_1h59', 'cancelled', '{"cancel_reason": "other"}') $$,
  '42501', 'not_allowed', 'a deleted account cannot change orders'
);

-- The status never changes without an event -------------------------------------------

select tests.clear_authentication();
select is(
  (select count(*)::int from public.orders as o
   where o.status <> coalesce(
     (select e.to_status from public.order_events as e
      where e.order_id = o.id order by e.id desc limit 1),
     o.status)),
  0, 'every order''s status matches its last event'
);
select is(
  (select count(*)::int from public.order_events where actor_id is null), 0,
  'every event names who made it'
);

select * from finish();
rollback;
