-- RLS audit of migrations order_status_postponed and postponed_orders (مؤجل,
-- spec §6). Cases postponed_orders.test.sql doesn't already cover:
-- - Who may touch a postponed order: a guest, another customer and a crew
--   can't cancel it; its customer can't bring it back (not even with an
--   override flag).
-- - A crew loses the job when it is postponed, pending or confirmed: the
--   order, its lines, events, staff notes, media and the customer's contact
--   (crew_job_contact), and its last live position after an override from on
--   the way (the customer doesn't see that position either).
-- - A deleted account's order can't be brought back as postponed.
-- - Subscription visits: a postponed covered order holds its visit for the
--   next booking (usable_subscription), an override out of cancelled into
--   postponed and A2's "استخدم الاشتراك" check the visits, subscription_overview
--   counts it as held but not as the next order, and ending the subscription
--   makes it a cash order (audited).
-- - Notifications: customer_postponed reaches admins only, order_postponed
--   only its customer, and neither carries a staff note.
-- - A postponed order is open: no cleaning reminder for its address, and its
--   booking videos aren't purged as if it had closed.
begin;
\ir _helpers.psql

select plan(42);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647803333333');            -- customer D (deleted)
select tests.create_user('+9647805555555');            -- customer S (subscriber)
select tests.create_user('+9647806666666');            -- customer R (reminders)
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
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;
create function tests.s() returns uuid language sql stable
as $$ select tests.user_id('+9647805555555') $$;
create function tests.admin1() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;
create function tests.crew1_user() returns uuid language sql stable
as $$ select tests.user_id('+9647703333331') $$;

insert into tests.ids values
  -- Confirmed with crew1: A postpones it.
  ('conf', tests.create_order(tests.a(), 'confirmed', tests.at_main(2), tests.id('crew1'), tests.main())),
  -- Pending with crew1 already chosen: A postpones it.
  ('pend', tests.create_order(tests.a(), 'pending_confirmation', tests.at_main(3), tests.id('crew1'), tests.main())),
  -- On the way: an admin override puts it off.
  ('otw', tests.create_order(tests.a(), 'on_the_way', now() + interval '1 hour', tests.id('crew1'))),
  -- An admin postpones it.
  ('adm', tests.create_order(tests.a(), 'confirmed', tests.at_main(4), p_slot_id => tests.main())),
  -- D's cancelled order; D deletes the account below.
  ('del', tests.create_order(tests.user_id('+9647803333333'), 'cancelled', tests.at_main(5))),
  -- A postponed order whose booking video is old.
  ('old', tests.create_order(tests.b(), 'postponed', now() - interval '120 days'));

-- crew1 can see 'conf' now: a staff note, a customer photo, a live position on 'otw'.
with e as (
  insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role)
  values (tests.id('conf'), 'pending_confirmation', 'confirmed', tests.admin1(), 'admin')
  returning id, order_id
)
insert into public.order_event_notes (event_id, order_id, note)
select e.id, e.order_id, 'البيت بالفرع الثاني' from e;
insert into public.order_media (order_id, kind, media_type, path, bytes)
values (tests.id('conf'), 'customer', 'photo', tests.a() || '/conf.jpg', 1000);
insert into public.crew_live_location (order_id, crew_id, lat, lng, accuracy_m)
values (tests.id('otw'), tests.id('crew1'), 32.6, 44.02, 5);

-- An old booking video on the postponed order, put off 100 days ago.
insert into public.order_media (order_id, kind, media_type, path, bytes, duration_s)
values (tests.id('old'), 'customer', 'video', tests.b() || '/old.mp4', 1000, 10);
insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, created_at)
values (tests.id('old'), 'confirmed', 'postponed', tests.b(), 'customer', now() - interval '100 days');

create function tests.go(p_order text, p_to text, p_payload jsonb default '{}')
returns void
language sql
as $$ select public.transition_order(tests.id(p_order), p_to::public.order_status, p_payload) $$;

create function tests.status(p_order text) returns text language sql stable security definer
as $$ select status::text from public.orders where id = tests.id(p_order) $$;

grant execute on all functions in schema tests to anon, authenticated;

-- A postpones ------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select lives_ok($$ select tests.go('conf', 'postponed') $$, 'A postpones a confirmed order');
select lives_ok($$ select tests.go('pend', 'postponed') $$, 'A postpones a pending order');
select throws_ok(
  $$ select tests.go('conf', 'confirmed', '{"override": true, "reason": "x"}') $$,
  'ZL010', 'invalid_transition', 'a customer''s override flag gives a postponed order nothing'
);
select throws_ok(
  $$ select tests.go('conf', 'pending_confirmation',
       jsonb_build_object('service_date', tests.today() + 6, 'slot_id', tests.main(), 'override', true)) $$,
  'ZL010', 'invalid_transition', 'nor a date'
);

-- Nobody else cancels it -------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select tests.go('conf', 'cancelled', '{"cancel_reason": "other"}') $$,
  '42501', null, 'a guest cannot cancel a postponed order'
);
select tests.authenticate_as(tests.b());
select throws_ok(
  $$ select tests.go('conf', 'cancelled', '{"cancel_reason": "other"}') $$,
  'P0002', 'order_not_found', 'another customer cannot cancel it'
);
select is_empty(
  $$ select 1 from public.orders where id = tests.id('conf') $$,
  'nor read it'
);

-- The crew loses the job -------------------------------------------------------------------

select tests.authenticate_as(tests.crew1_user());
select throws_ok(
  $$ select tests.go('conf', 'cancelled', '{"reason": "x"}') $$,
  'P0002', 'order_not_found', 'the crew cannot cancel a postponed order'
);
select throws_ok(
  $$ select tests.go('conf', 'on_the_way') $$,
  'P0002', 'order_not_found', 'nor set off for it'
);
select is_empty(
  $$ select 1 from public.orders where id in (tests.id('conf'), tests.id('pend')) $$,
  'the crew no longer reads a job postponed from confirmed or pending'
);
select is_empty(
  $$ select 1 from public.order_items where order_id = tests.id('conf') $$,
  'nor its lines'
);
select is_empty(
  $$ select 1 from public.order_events where order_id = tests.id('conf') $$,
  'nor its timeline'
);
select is_empty(
  $$ select 1 from public.order_event_notes where order_id = tests.id('conf') $$,
  'nor its staff notes'
);
select is_empty(
  $$ select 1 from public.order_media where order_id = tests.id('conf') $$,
  'nor its media'
);
select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('conf')) $$,
  'P0002', 'order_not_found', 'nor the customer''s name and phone'
);

-- An override puts the job on the way off.
select tests.authenticate_as(tests.admin1());
select lives_ok(
  $$ select tests.go('otw', 'postponed', '{"override": true, "reason": "تصحيح"}') $$,
  'an admin overrides an order on the way into postponed'
);
select isnt_empty(
  $$ select 1 from public.crew_live_location where order_id = tests.id('otw') $$,
  'admins still read its last position'
);
select tests.authenticate_as(tests.crew1_user());
select is_empty(
  $$ select 1 from public.orders where id = tests.id('otw') $$,
  'the crew no longer reads the job it was on the way to'
);
select is_empty(
  $$ select 1 from public.crew_live_location where order_id = tests.id('otw') $$,
  'the crew no longer reads its last position'
);
select throws_ok(
  $$ select public.share_crew_location(tests.id('otw'), 32.6, 44.02, 5) $$,
  'P0002', null, 'nor shares a new one'
);
select tests.authenticate_as(tests.a());
select is_empty(
  $$ select 1 from public.crew_live_location where order_id = tests.id('otw') $$,
  'and the customer no longer sees the crew''s position'
);

-- A deleted account's order stays closed ------------------------------------------------------

select tests.clear_authentication();
update public.profiles set deleted_at = now(), phone = null where id = tests.user_id('+9647803333333');
select tests.authenticate_as(tests.admin1());
select throws_ok(
  $$ select tests.go('del', 'postponed', '{"override": true, "reason": "تصحيح"}') $$,
  'P0002', 'order_not_found', 'an override cannot bring a deleted account''s order back as postponed'
);
select is(tests.status('del'), 'cancelled', 'it stays cancelled');

-- Subscription visits ------------------------------------------------------------------------

select tests.clear_authentication();
insert into tests.ids values ('sub', tests.create_subscription(tests.s(), 'active', tests.today(), 1, 1));
insert into tests.ids values
  ('s_post', tests.create_order(tests.s(), 'postponed', tests.at_main(3), p_slot_id => tests.main())),
  ('s_cancel', tests.create_order(tests.s(), 'cancelled', tests.at_main(3), p_slot_id => tests.main())),
  ('s_cash', tests.create_order(tests.s(), 'postponed', tests.at_main(3), p_slot_id => tests.main()));
update public.orders set subscription_id = tests.id('sub')
where id in (tests.id('s_post'), tests.id('s_cancel'));
create function tests.s_address() returns uuid language sql stable security definer
as $$ select address_id from public.orders where id = tests.id('s_post') $$;

select throws_ok(
  $$ select private.usable_subscription(tests.s_address(), tests.today() + 6, 1) $$,
  'ZL034', 'no_visits_left', 'a postponed covered order keeps its visit from a new booking'
);

select tests.authenticate_as(tests.s());
select results_eq(
  $$ select visits_held, visits_left, next_order_id from public.subscription_overview
     where id = tests.id('sub') $$,
  $$ values (1, 0, null::uuid) $$,
  'the overview counts it as held, but not as the next visit (it has no date)'
);
select throws_ok(
  $$ select public.admin_set_order_subscription(tests.id('s_cash'), true) $$,
  '42501', 'not_allowed', 'a customer cannot put coverage on a postponed order'
);

select tests.authenticate_as(tests.admin1());
select throws_ok(
  $$ select tests.go('s_cancel', 'postponed', '{"override": true, "reason": "تصحيح"}') $$,
  'ZL034', 'no_visits_left', 'an override from cancelled into postponed needs a visit left'
);
select is(tests.status('s_cancel'), 'cancelled', 'so it stays cancelled');
select throws_ok(
  $$ select public.admin_set_order_subscription(tests.id('s_cash'), true) $$,
  'ZL034', 'no_visits_left', 'coverage on a postponed order needs a visit left'
);
select lives_ok(
  $$ select public.admin_end_subscription(tests.id('sub'), 'طلب الزبون') $$,
  'an admin cancels the subscription'
);
select is(
  (select subscription_id from public.orders where id = tests.id('s_post')),
  null,
  'its postponed order becomes a cash order'
);
select is(
  (select count(*) from public.admin_audit_log
   where action = 'order.subscription' and entity_id = tests.id('s_post')::text),
  1::bigint,
  'and that is audited'
);

-- Notifications ------------------------------------------------------------------------------

select lives_ok(
  $$ select tests.go('adm', 'postponed', '{"reason": "الزبون مسافر"}') $$,
  'an admin postpones A''s order with a note'
);

select is(
  (select count(*) from public.notifications
   where type = 'customer_postponed' and order_id = tests.id('conf')),
  1::bigint,
  'admins read the customer''s postpone'
);
select is(
  (select array_agg(k order by k) from public.notifications as n, jsonb_object_keys(n.data) as k
   where n.type = 'customer_postponed' and n.order_id = tests.id('conf')),
  array['district', 'number', 'service_date', 'slot_end_at', 'slot_start_at'],
  'it carries the order notice only'
);
select is_empty(
  $$ select 1 from public.notifications where type = 'order_postponed' $$,
  'an admin doesn''t read the customer''s order_postponed'
);

select tests.authenticate_as(tests.a());
select is(
  (select array_agg(k order by k) from public.notifications as n, jsonb_object_keys(n.data) as k
   where n.type = 'order_postponed' and n.order_id = tests.id('adm')),
  array['district', 'number', 'service_date', 'slot_end_at', 'slot_start_at'],
  'A reads the staff postpone, without the staff note'
);
select is_empty(
  $$ select 1 from public.notifications where type = 'customer_postponed' $$,
  'a customer never reads customer_postponed'
);

select tests.authenticate_as(tests.b());
select is_empty(
  $$ select 1 from public.notifications where order_id = tests.id('adm') $$,
  'another customer reads nothing about A''s order'
);

select tests.authenticate_as(tests.crew1_user());
select is_empty(
  $$ select 1 from public.notifications where type in ('customer_postponed', 'order_postponed') $$,
  'the crew reads neither postpone notification'
);

-- Still open -----------------------------------------------------------------------------------

select tests.clear_authentication();
-- R: a certificate due in a week, and a postponed order at the same address.
insert into public.certificates (order_id, public_code, next_due_on, issued_at)
values (
  tests.create_order(tests.user_id('+9647806666666'), 'completed', now() - interval '180 days'),
  private.new_certificate_code(), tests.today() + 7, now() - interval '6 months'
);
select tests.create_order(tests.user_id('+9647806666666'), 'postponed', tests.at_main(6));
select private.send_cleaning_reminders(tests.today());
select is_empty(
  $$ select 1 from public.notifications
     where user_id = tests.user_id('+9647806666666') and type = 'cleaning_reminder' $$,
  'no cleaning reminder for an address with a postponed order'
);

select private.purge_expired_media();
select isnt_empty(
  $$ select 1 from public.order_media where order_id = tests.id('old') $$,
  'a postponed order''s booking video isn''t purged: the order hasn''t closed'
);

select * from finish();
rollback;
