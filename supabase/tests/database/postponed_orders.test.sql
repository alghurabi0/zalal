-- مؤجل (postponed; spec §6, settled Oct 29, 2026): an order put off with no
-- new date yet.
-- - Customer: postpones their own pending or confirmed order until its slot
--   starts (ZL006 from then on), and cancels a postponed one at any time (it
--   has no slot). They can't set its date again (admins only) or postpone it
--   twice.
-- - Admin: postpones a pending or confirmed order at any time (an optional
--   note stays internal), gives a postponed order its date back with a
--   reschedule (back to pending_confirmation; the old date and slot may be
--   chosen again), or cancels it with a reason. Confirming needs a date
--   first (ZL010). Any other move is an override.
-- - Crew: can't postpone.
-- - Postponing frees the order's place and removes its crew (the crew is
--   told: job_changed, removed). The order keeps its old date and slot as a
--   record. An override into postponed does the same; an override out of it
--   takes the old place again (ZL005 if full).
-- - Notifications: a customer's postpone → admins: customer_postponed; a
--   staff postpone → the customer: order_postponed.
-- - A postponed order is still open: a covered one holds its subscription
--   visit, the address can't be deleted (ZL012), the account can't be
--   deleted (ZL039), and no crew can be assigned (ZL014).
begin;
\ir _helpers.psql

select plan(49);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647803333333');            -- customer C
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333331'));

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

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.admin1() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;
create function tests.crew1_user() returns uuid language sql stable
as $$ select tests.user_id('+9647703333331') $$;

insert into tests.ids values
  ('pc', tests.create_order(tests.a(), 'pending_confirmation', tests.at_main(1), p_slot_id => tests.main())),
  ('cc', tests.create_order(tests.a(), 'confirmed', tests.at_main(2), tests.id('crew1'), tests.main())),
  ('soon', tests.create_order(tests.a(), 'confirmed', now() + interval '1 minute')),
  ('started', tests.create_order(tests.a(), 'confirmed', now())),
  ('old', tests.create_order(tests.a(), 'postponed', now() - interval '3 days')),
  ('b', tests.create_order(tests.user_id('+9647802222222'), 'pending_confirmation')),
  ('otw', tests.create_order(tests.a(), 'on_the_way', now() + interval '1 hour', tests.id('crew1'))),
  ('ap', tests.create_order(tests.a(), 'confirmed', now() + interval '30 minutes')),
  ('ac', tests.create_order(tests.a(), 'postponed', tests.at_main(3))),
  -- The main slot on day 5 is full.
  ('full_1', tests.create_order(tests.user_id('+9647802222222'), 'confirmed', tests.at_main(5), p_slot_id => tests.main())),
  ('full_2', tests.create_order(tests.user_id('+9647802222222'), 'confirmed', tests.at_main(5), p_slot_id => tests.main())),
  ('ov_full', tests.create_order(tests.a(), 'postponed', tests.at_main(5), p_slot_id => tests.main()));

create function tests.go(p_order text, p_to text, p_payload jsonb default '{}')
returns void
language sql
as $$ select public.transition_order(tests.id(p_order), p_to::public.order_status, p_payload) $$;

create function tests.status(p_order text) returns text language sql stable security definer
as $$ select status::text from public.orders where id = tests.id(p_order) $$;

create function tests.seat_of(p_order text) returns text language sql stable security definer
as $$
  select b.service_date || ' ' || b.slot_id from public.slot_bookings as b
  where b.order_id = tests.id(p_order)
$$;

create function tests.crew_of(p_order text) returns uuid language sql stable security definer
as $$ select crew_id from public.orders where id = tests.id(p_order) $$;

create function tests.notified(p_user uuid, p_type text, p_order text) returns bigint
language sql stable security definer
as $$
  select count(*) from public.notifications
  where user_id = p_user and type::text = p_type and order_id = tests.id(p_order)
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- Seats: fixtures for postponed orders hold none.
select is(tests.seat_of('old'), null, 'a postponed order holds no place');

-- Guests ---------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select tests.go('pc', 'postponed') $$,
  '42501', null, 'a guest cannot postpone'
);

-- Customer ---------------------------------------------------------------------------

select tests.authenticate_as(tests.a());

select lives_ok($$ select tests.go('pc', 'postponed') $$, 'a customer postpones a pending order');
select is(tests.status('pc'), 'postponed', 'the order is postponed');
select is(tests.seat_of('pc'), null, 'postponing frees the place');
select results_eq(
  $$ select service_date, slot_id from public.orders where id = tests.id('pc') $$,
  $$ values (tests.today() + 1, tests.main()) $$,
  'the order keeps its old date and slot as a record'
);
select results_eq(
  $$ select from_status::text, to_status::text, actor_role::text, is_override
     from public.order_events where order_id = tests.id('pc') $$,
  $$ values ('pending_confirmation', 'postponed', 'customer', false) $$,
  'the postpone is recorded'
);

select lives_ok($$ select tests.go('cc', 'postponed') $$, 'a customer postpones a confirmed order');
select is(tests.crew_of('cc'), null, 'postponing removes the crew');
select is(tests.seat_of('cc'), null, 'and frees the place');
select is(
  (select details ->> 'from_crew_id' from public.order_events
   where order_id = tests.id('cc') and to_status = 'postponed'),
  tests.id('crew1')::text,
  'the event keeps the crew it had'
);
select lives_ok(
  $$ select tests.go('soon', 'postponed') $$,
  'a customer postpones a minute before the slot starts (no 2-hour rule)'
);
select throws_ok(
  $$ select tests.go('started', 'postponed') $$,
  'ZL006', 'change_too_late', 'a customer cannot postpone once the slot has started'
);
select throws_ok(
  $$ select tests.go('b', 'postponed') $$,
  'P0002', 'order_not_found', 'a customer cannot postpone someone else''s order'
);
select throws_ok(
  $$ select tests.go('otw', 'postponed') $$,
  'ZL010', 'invalid_transition', 'a customer cannot postpone once the crew is on the way'
);
select throws_ok(
  $$ select tests.go('pc', 'postponed') $$,
  'ZL010', 'invalid_transition', 'a postponed order cannot be postponed again'
);
select throws_ok(
  $$ select tests.go('pc', 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 3, 'slot_id', tests.main())) $$,
  'ZL010', 'invalid_transition', 'a customer cannot give a postponed order its date'
);
select throws_ok(
  $$ select tests.go('old', 'cancelled') $$,
  '22023', 'cancel_reason_required', 'cancelling a postponed order needs the N6 reason'
);
select lives_ok(
  $$ select tests.go('old', 'cancelled', '{"cancel_reason": "plans_changed"}') $$,
  'a customer cancels a postponed order, even after its old slot passed'
);
select is(tests.status('old'), 'cancelled', 'the postponed order is cancelled');

-- Crew --------------------------------------------------------------------------------

select tests.authenticate_as(tests.crew1_user());
select throws_ok(
  $$ select tests.go('otw', 'postponed') $$,
  'ZL010', 'invalid_transition', 'a crew cannot postpone'
);

-- Admin --------------------------------------------------------------------------------

select tests.authenticate_as(tests.admin1());

select lives_ok(
  $$ select tests.go('ap', 'postponed', '{"reason": "الزبون مسافر"}') $$,
  'an admin postpones at any time, with a note'
);
select is(
  (select n.note from public.order_event_notes as n where n.order_id = tests.id('ap')),
  'الزبون مسافر',
  'the note is internal'
);
select is(
  (select count(*) from public.admin_audit_log
   where entity_id = tests.id('ap')::text and diff ->> 'to' = 'postponed'),
  1::bigint,
  'the postpone is audited'
);
select throws_ok(
  $$ select tests.go('ac', 'confirmed') $$,
  'ZL010', 'invalid_transition', 'a postponed order gets a date before it is confirmed'
);
select throws_ok(
  $$ select tests.go('ac', 'pending_confirmation') $$,
  '22023', 'new_slot_required', 'giving the date back names the date and slot'
);
select throws_ok(
  $$ select tests.go('ov_full', 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 5, 'slot_id', tests.main())) $$,
  'ZL005', 'slot_full', 'the new slot needs a place'
);
select lives_ok(
  $$ select tests.go('pc', 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 1, 'slot_id', tests.main())) $$,
  'an admin gives a postponed order its date back, the old one included'
);
select is(tests.status('pc'), 'pending_confirmation', 'it waits for confirmation again');
select is(
  tests.seat_of('pc'), (tests.today() + 1) || ' ' || tests.main(),
  'and holds a place in the slot'
);
select lives_ok(
  $$ select tests.go('cc', 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 3, 'slot_id', tests.main())) $$,
  'an admin moves a postponed order to a new day'
);
select results_eq(
  $$ select status::text, service_date, slot_start_at, crew_id
     from public.orders where id = tests.id('cc') $$,
  $$ values ('pending_confirmation', tests.today() + 3, tests.at_main(3), null::uuid) $$,
  'with the new slot and no crew'
);
select throws_ok(
  $$ select public.assign_crew(tests.id('ac'), tests.id('crew1')) $$,
  'ZL014', 'crew_change_not_allowed', 'no crew is assigned to a postponed order'
);
select throws_ok(
  $$ select tests.go('ac', 'cancelled') $$,
  'ZL011', 'reason_required', 'an admin cancels a postponed order with a reason'
);
select lives_ok(
  $$ select tests.go('ac', 'cancelled', '{"reason": "ما رد"}') $$,
  'an admin cancels a postponed order'
);

-- Overrides
select lives_ok(
  $$ select tests.go('otw', 'postponed', '{"override": true, "reason": "تصحيح"}') $$,
  'an override puts an order on the way off'
);
select results_eq(
  $$ select status::text, crew_id from public.orders where id = tests.id('otw') $$,
  $$ values ('postponed', null::uuid) $$,
  'without its crew'
);
select is(tests.seat_of('otw'), null, 'and without its place');
select throws_ok(
  $$ select tests.go('ov_full', 'confirmed', '{"override": true, "reason": "تصحيح"}') $$,
  'ZL005', 'slot_full', 'an override out of postponed needs its old place back'
);
select lives_ok(
  $$ select tests.go('otw', 'confirmed', '{"override": true, "reason": "تصحيح"}') $$,
  'an override brings a postponed order back on its old date'
);
select isnt(tests.seat_of('otw'), null, 'taking its place again');

select tests.clear_authentication();

-- Notifications --------------------------------------------------------------------------

select is(
  tests.notified(tests.admin1(), 'customer_postponed', 'pc'), 1::bigint,
  'admins hear of a customer''s postpone'
);
select is(
  tests.notified(tests.a(), 'order_postponed', 'ap'), 1::bigint,
  'the customer hears of a staff postpone'
);
select is(
  tests.notified(tests.a(), 'order_postponed', 'pc'), 0::bigint,
  'but not of their own'
);
select is(
  (select count(*) from public.notifications
   where user_id = tests.crew1_user() and order_id = tests.id('cc')
     and type = 'job_changed' and data ->> 'change' = 'removed'),
  1::bigint,
  'the crew is told the job left its schedule'
);
select is(
  (select audience::text from public.notifications
   where type = 'customer_postponed' limit 1),
  'admin',
  'customer_postponed is for admins'
);

-- Still open ---------------------------------------------------------------------------

insert into tests.ids values ('sub', tests.create_subscription(tests.user_id('+9647802222222')));
insert into tests.ids values
  ('covered', tests.create_order(tests.user_id('+9647802222222'), 'postponed', tests.at_main(7)));
update public.orders set subscription_id = tests.id('sub') where id = tests.id('covered');
select is(
  (select held from private.subscription_visits(tests.id('sub'))),
  1,
  'a postponed covered order holds its visit'
);

-- Customer C's only order is postponed.
insert into tests.ids values
  ('c_only', tests.create_order(tests.user_id('+9647803333333'), 'postponed', tests.at_main(8)));
select tests.authenticate_as(tests.user_id('+9647803333333'));
select throws_ok(
  $$ select public.delete_address(
       (select address_id from public.orders where id = tests.id('c_only'))) $$,
  'ZL012', null, 'an address with a postponed order cannot be deleted'
);
select throws_ok(
  $$ select public.delete_account() $$,
  'ZL039', 'account_has_open_orders', 'an account with a postponed order cannot be deleted'
);

select * from finish();
rollback;
