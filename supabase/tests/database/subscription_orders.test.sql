-- Orders on a subscription (spec §5.11, §6; Phase 6, task 2; settled Oct 28,
-- 2026: per address, one visit = one order of up to tanks_covered tanks, a
-- visit is used only by a completed order).
--
-- create_order(..., p_use_subscription): the booking's address must have an
-- active subscription whose period holds the slot date, with a visit left
-- (completed orders, the admin's adjustment and open orders count) and no
-- more tanks than it covers; otherwise ZL034 subscription_unavailable with
-- the reason (no_subscription, outside_subscription_period, no_visits_left,
-- subscription_tanks_exceeded). The total stays the lines' sum.
-- transition_order: completing a covered order needs no cash tick (and
-- records none); confirming one re-checks that its subscription still
-- covers it; a customer can't move it outside the period. No-shows and
-- cancels use no visit; an override out of completed gives it back.
-- delete_address refuses (ZL012) while the address has a request or a
-- subscription that hasn't ended.
begin;
\ir _helpers.psql

select plan(38);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.left(p_id uuid) returns int language sql stable
as $$ select visits_left from public.subscription_overview where id = p_id $$;

delete from public.service_areas;
insert into public.service_areas (name, area)
values ('Test Karbala', 'SRID=4326;MULTIPOLYGON(((43.9 32.5, 44.1 32.5, 44.1 32.7, 43.9 32.7, 43.9 32.5)))');
update public.slots set active = false;
delete from public.blocked_dates;
update public.settings
set booking_window_days = 14, cancel_cutoff_hours = 2, max_tanks_per_order = 6;
update public.price_list set price_iqd = 35000;
select tests.create_slot('07:00', '09:00', 10);

insert into tests.ids values
  ('home', tests.create_address(tests.a(), 'home')),
  ('family', tests.create_address(tests.a(), 'family')),
  ('b_home', tests.create_address(tests.b(), 'home'));
update public.addresses set is_default = (id = tests.id('home')) where user_id = tests.a();
insert into tests.ids values
  ('sub', tests.create_subscription(tests.a(), 'active', tests.today() - 10, 2, 1, tests.id('home'))),
  ('later', tests.create_subscription(tests.a(), 'active', tests.today() + 5, 2, 1, tests.id('family'))),
  -- B's subscription ends in 3 days.
  ('b_sub', tests.create_subscription(
    tests.b(), 'active', (tests.today() + 3 - interval '12 months' + interval '1 day')::date, 2, 1,
    tests.id('b_home')
  ));

create function tests.book(p_request text, p_address uuid, p_qty int, p_use boolean, p_day int default 1)
returns uuid language sql
as $$
  select order_id from public.create_order(
    p_request_id => md5(p_request)::uuid,
    p_address_id => p_address,
    p_service_date => tests.today() + p_day,
    p_slot_id => (select id from public.slots where start_time = '07:00' and end_time = '09:00'),
    p_items => jsonb_build_array(jsonb_build_object('tank_type', 'roof', 'size', 'm', 'qty', p_qty)),
    p_expected_total => 35000 * p_qty,
    p_use_subscription => p_use
  );
$$;
grant execute on all functions in schema tests to authenticated;

-- create_order --------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
insert into tests.ids values ('cash', tests.book('cash', tests.id('home'), 1, false));
select is(
  (select subscription_id from public.orders where id = tests.id('cash')),
  null,
  'without the toggle an order is a cash order'
);
select throws_ok(
  $$ select tests.book('family', tests.id('family'), 1, true) $$,
  'ZL034', 'outside_subscription_period', 'a subscription that hasn''t started covers nothing yet'
);
select throws_ok(
  $$ select tests.book('two tanks', tests.id('home'), 2, true) $$,
  'ZL034', 'subscription_tanks_exceeded', 'more tanks than it covers are refused'
);
insert into tests.ids values ('covered', tests.book('covered', tests.id('home'), 1, true));
select is(
  (select subscription_id from public.orders where id = tests.id('covered')),
  tests.id('sub'),
  'with the toggle the order uses the address''s subscription'
);
select is(
  (select total_iqd from public.orders where id = tests.id('covered')),
  35000,
  'and keeps its list price as its total'
);
select is(tests.book('covered', tests.id('home'), 1, true), tests.id('covered'), 'a retry returns the same order');
select is(tests.left(tests.id('sub')), 1, 'the open order holds a visit');
insert into tests.ids values ('covered2', tests.book('covered2', tests.id('home'), 1, true, 2));
select throws_ok(
  $$ select tests.book('third', tests.id('home'), 1, true, 3) $$,
  'ZL034', 'no_visits_left', 'no more covered orders than visits'
);

select tests.authenticate_as(tests.b());
select throws_ok(
  $$ select tests.book('b none', tests.id('home'), 1, true) $$,
  'P0002', 'address_not_found', 'nobody books on another customer''s address'
);

-- Cancel and no-show use no visit ------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select lives_ok(
  $$ select public.transition_order(tests.id('covered2'), 'cancelled', '{"cancel_reason": "plans_changed"}') $$,
  'the customer cancels a covered order'
);
select is(tests.left(tests.id('sub')), 1, 'which frees its visit');

select tests.clear_authentication();
update public.orders set status = 'confirmed', crew_id = tests.id('crew') where id = tests.id('covered');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select lives_ok(
  $$ select public.transition_order(tests.id('covered'), 'no_show', '{"reason": "ما أحد بالبيت"}') $$,
  'the crew marks a covered order no-show'
);
select tests.authenticate_as(tests.a());
select is(tests.left(tests.id('sub')), 2, 'a no-show uses no visit');

-- Completion ------------------------------------------------------------------------------------

select tests.clear_authentication();
insert into tests.ids values
  ('job', tests.create_order(tests.a(), 'in_progress', now() - interval '1 hour', tests.id('crew'))),
  ('cash_job', tests.create_order(tests.a(), 'in_progress', now() - interval '1 hour', tests.id('crew')));
update public.orders set subscription_id = tests.id('sub') where id = tests.id('job');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.transition_order(tests.id('cash_job'), 'completed', '{"sterilant": "كلور"}') $$,
  'ZL011', 'cash_not_collected', 'a cash order still needs the cash tick'
);
select lives_ok(
  $$ select public.transition_order(tests.id('job'), 'completed', '{"sterilant": "كلور"}') $$,
  'a covered order completes without it'
);
select tests.authenticate_as(tests.a());
select is(
  (select cash_collected from public.orders where id = tests.id('job')),
  false,
  'and records no cash'
);
select is(
  (select visits_used from public.subscription_overview where id = tests.id('sub')),
  1,
  'the completed order used a visit'
);
select is(tests.left(tests.id('sub')), 1, 'one left');
select is(
  (select last_visit_on from public.subscription_overview where id = tests.id('sub')),
  (select service_date from public.orders where id = tests.id('job')),
  'the overview knows the last covered visit'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select public.transition_order(tests.id('job'), 'in_progress', '{"override": true, "reason": "غلط"}') $$,
  'an admin overrides the order out of completed'
);
select is(
  (select visits_used from public.subscription_overview where id = tests.id('sub')),
  0,
  'which gives the visit back'
);

select lives_ok(
  $$ select public.transition_order(tests.id('job'), 'completed', '{"override": true, "reason": "تم", "cash_collected": true}') $$,
  'an admin completes it again'
);
select is(
  (select cash_collected from public.orders where id = tests.id('job')),
  false,
  'and a covered order records no cash even when the override says so'
);

-- Confirming re-checks coverage ---------------------------------------------------------------------

select tests.clear_authentication();
insert into tests.ids values ('pending', tests.create_order(tests.a(), 'pending_confirmation'));
update public.orders set subscription_id = tests.id('sub') where id = tests.id('pending');
update public.subscriptions set status = 'cancelled', ended_at = now() where id = tests.id('sub');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.transition_order(tests.id('pending'), 'confirmed') $$,
  'ZL034', 'no_subscription', 'an order whose subscription was cancelled is not confirmed as covered'
);
select tests.clear_authentication();
update public.subscriptions set status = 'active', ended_at = null where id = tests.id('sub');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select public.transition_order(tests.id('pending'), 'confirmed') $$,
  'with the subscription active it is confirmed'
);

-- 'job' (completed) and 'pending' (confirmed) use and hold both visits now;
-- bringing the cancelled covered2 back would take a third.
select throws_ok(
  $$ select public.transition_order(tests.id('covered2'), 'confirmed', '{"override": true, "reason": "رجعناه"}') $$,
  'ZL034', 'no_visits_left', 'an override cannot bring a covered order back past its visits'
);
select lives_ok(
  $$ select public.admin_set_order_subscription(tests.id('covered2'), false) $$,
  'the admin drops its coverage'
);
select lives_ok(
  $$ select public.transition_order(tests.id('covered2'), 'confirmed', '{"override": true, "reason": "رجعناه"}') $$,
  'and brings it back as a cash order'
);

-- Rescheduling inside the period ------------------------------------------------------------------

select tests.authenticate_as(tests.b());
insert into tests.ids values ('b_order', tests.book('b covered', tests.id('b_home'), 1, true));
select throws_ok(
  $$ select public.transition_order(
       tests.id('b_order'), 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 5, 'slot_id',
         (select id from public.slots where start_time = '07:00' and end_time = '09:00'))
     ) $$,
  'ZL034', 'outside_subscription_period', 'a customer cannot move a covered order past the end'
);
select lives_ok(
  $$ select public.transition_order(
       tests.id('b_order'), 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 2, 'slot_id',
         (select id from public.slots where start_time = '07:00' and end_time = '09:00'))
     ) $$,
  'but within it'
);
select tests.clear_authentication();
update public.subscriptions set status = 'cancelled', ended_at = now() where id = tests.id('b_sub');
select tests.authenticate_as(tests.b());
select throws_ok(
  $$ select public.transition_order(
       tests.id('b_order'), 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 1, 'slot_id',
         (select id from public.slots where start_time = '07:00' and end_time = '09:00'))
     ) $$,
  'ZL034', 'outside_subscription_period', 'nor keep it on a subscription that has ended'
);
select tests.clear_authentication();
update public.subscriptions set status = 'active', ended_at = null where id = tests.id('b_sub');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select public.transition_order(
       tests.id('b_order'), 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 6, 'slot_id',
         (select id from public.slots where start_time = '07:00' and end_time = '09:00'))
     ) $$,
  'staff may move it anywhere'
);

-- Cancelling a subscription makes its open orders cash orders ---------------------------------------

select lives_ok(
  $$ select public.admin_end_subscription(tests.id('b_sub'), 'طلب الزبون') $$,
  'an admin cancels B''s subscription'
);
select is(
  (select subscription_id from public.orders where id = tests.id('b_order')),
  null,
  'its open order is a cash order now'
);
select is(
  (select count(*)::int from public.admin_audit_log
   where action = 'order.subscription' and entity_id = tests.id('b_order')::text),
  1,
  'and the change is logged on the order'
);

-- delete_address ------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.delete_address(tests.id('family')) $$,
  'ZL012', 'address_in_use', 'an address with a subscription that hasn''t ended is not deleted'
);
select tests.clear_authentication();
update public.subscriptions set status = 'cancelled', ended_at = now() where id = tests.id('later');
insert into public.subscriptions (user_id, address_id) values (tests.a(), tests.id('family'));
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.delete_address(tests.id('family')) $$,
  'ZL012', 'address_in_use', 'nor one with a request'
);
select tests.clear_authentication();
update public.subscriptions set status = 'declined', ended_at = now()
where address_id = tests.id('family') and status = 'requested';
select tests.authenticate_as(tests.a());
select lives_ok(
  $$ select public.delete_address(tests.id('family')) $$,
  'once they are declined or cancelled, it is'
);

select * from finish();
rollback;
