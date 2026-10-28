-- A7 subscriptions (spec §8.2, §9.2; Phase 6, task 2). Admins only (42501
-- otherwise); a missing subscription is P0002 subscription_not_found. Every
-- change is logged to admin_audit_log (entity subscriptions), only what
-- changed.
--
-- admin_activate_subscription(id, starts_on, visits, tanks, price, paid,
-- note): a request becomes active from starts_on (not before today in
-- Baghdad) to 12 months later less a day, with 1–12 visits, 1 to
-- max_tanks_per_order tanks and a positive price; another status is ZL036
-- invalid_subscription_status; an overlap with the address's other active
-- subscription is ZL035. The customer is told (subscription_activated).
-- admin_set_subscription_paid(id, paid): the paid tick of an active one.
-- admin_adjust_subscription_visits(id, delta, reason): adds delta to the
-- visits used; used never goes below 0 and used plus held never above the
-- total (22023 invalid_adjustment); a reason is required (ZL011).
-- admin_end_subscription(id, reason): a request is declined (the customer
-- is told, subscription_declined), an active one cancelled; reason required.
-- admin_add_subscription_note(id, note): an internal note, 1–1000.
-- admin_set_order_subscription(order_id, use): puts the address's
-- subscription on an order while it is pending or confirmed, with
-- create_order's checks (ZL034), and drops an order's coverage in any status
-- but completed (ZL038 otherwise).
begin;
\ir _helpers.psql

select plan(48);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.left(p_id uuid) returns int language sql stable
as $$ select visits_left from public.subscription_overview where id = p_id $$;

update public.settings as s set max_tanks_per_order = 6 where s.id;
insert into tests.ids values
  ('home', tests.create_address(tests.a(), 'home')),
  ('family', tests.create_address(tests.a(), 'family'));
update public.addresses set is_default = (id = tests.id('home')) where user_id = tests.a();
insert into tests.ids values
  ('request', tests.create_subscription(tests.a(), 'requested', p_address_id => tests.id('home'))),
  ('family_request', tests.create_subscription(tests.a(), 'requested', p_address_id => tests.id('family')));

-- Who ------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.admin_activate_subscription(tests.id('request'), tests.today(), 2, 1, 60000, true) $$,
  '42501', 'not_allowed', 'a customer cannot activate a subscription'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_end_subscription(tests.id('request'), 'لا') $$,
  '42501', 'not_allowed', 'nor can a crew end one'
);
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_add_subscription_note(tests.id('request'), 'ملاحظة') $$,
  '42501', null, 'nor a guest note one'
);

-- Activate -----------------------------------------------------------------------------------------

select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ select public.admin_activate_subscription(gen_random_uuid(), tests.today(), 2, 1, 60000, true) $$,
  'P0002', 'subscription_not_found', 'a missing subscription'
);
select throws_ok(
  $$ select public.admin_activate_subscription(tests.id('request'), tests.today() - 1, 2, 1, 60000, true) $$,
  '22023', 'invalid_start', 'a subscription cannot start in the past'
);
select throws_ok(
  $$ select public.admin_activate_subscription(tests.id('request'), tests.today(), 0, 1, 60000, true) $$,
  '22023', 'invalid_visits', 'at least one visit'
);
select throws_ok(
  $$ select public.admin_activate_subscription(tests.id('request'), tests.today(), 2, 7, 60000, true) $$,
  '22023', 'invalid_tanks', 'no more tanks than an order may hold'
);
select tests.clear_authentication();
update public.settings as s set max_tanks_per_order = 10 where s.id;
select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ select public.admin_activate_subscription(tests.id('request'), tests.today(), 2, 7, 60000, true) $$,
  '22023', 'invalid_tanks', 'and never more than 6, whatever the order limit'
);
select throws_ok(
  $$ select public.admin_activate_subscription(tests.id('request'), tests.today(), 2, 1, 0, true) $$,
  '22023', 'invalid_price', 'a positive price'
);
select lives_ok(
  $$ select public.admin_activate_subscription(tests.id('request'), tests.today(), 2, 2, 55000, false, 'يدفع بأول زيارة') $$,
  'an admin activates a request'
);
select results_eq(
  $$ select status::text, starts_on, ends_on, visits_total::int, tanks_covered::int, price_iqd, paid
     from public.subscriptions where id = tests.id('request') $$,
  $$ values ('active', tests.today(), (tests.today() + interval '12 months' - interval '1 day')::date, 2, 2, 55000, false) $$,
  'for 12 months, with the plan the admin set'
);
select is(
  (select note from public.subscription_notes where subscription_id = tests.id('request')),
  'يدفع بأول زيارة',
  'the note is kept as an internal note'
);
select is(
  (select diff -> 'visits_total' from public.admin_audit_log
   where action = 'subscription.activate' and entity_id = tests.id('request')::text),
  '2'::jsonb,
  'and the activation is logged with the plan'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.notifications
   where type = 'subscription_activated' and user_id = tests.a()
     and data ->> 'subscription_id' = tests.id('request')::text),
  1,
  'the customer is told'
);
select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ select public.admin_activate_subscription(tests.id('request'), tests.today(), 2, 1, 60000, true) $$,
  'ZL036', 'invalid_subscription_status', 'an active subscription is not activated again'
);

-- A renewal that overlaps --------------------------------------------------------------------------

select tests.clear_authentication();
insert into tests.ids values (
  'renewal', tests.create_subscription(tests.a(), 'requested', p_address_id => tests.id('home'))
);
select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ select public.admin_activate_subscription(tests.id('renewal'), tests.today() + 30, 2, 1, 60000, true) $$,
  'ZL035', 'subscription_exists', 'a renewal cannot overlap the subscription it follows'
);
select lives_ok(
  $$ select public.admin_activate_subscription(
       tests.id('renewal'), (tests.today() + interval '12 months')::date, 2, 1, 60000, true
     ) $$,
  'it starts the day after the current one ends'
);

-- Paid --------------------------------------------------------------------------------------------

select lives_ok(
  $$ select public.admin_set_subscription_paid(tests.id('request'), true) $$,
  'an admin ticks paid'
);
select ok((select paid from public.subscriptions where id = tests.id('request')), 'it is paid');
select lives_ok(
  $$ select public.admin_set_subscription_paid(tests.id('request'), true) $$,
  'ticking it again'
);
select is(
  (select count(*)::int from public.admin_audit_log
   where action = 'subscription.paid' and entity_id = tests.id('request')::text),
  1,
  'logs nothing the second time'
);
select throws_ok(
  $$ select public.admin_set_subscription_paid(tests.id('family_request'), true) $$,
  'ZL036', 'invalid_subscription_status', 'a request has no paid tick yet'
);

-- Visits ------------------------------------------------------------------------------------------

select tests.clear_authentication();
insert into tests.ids values ('open', tests.create_order(tests.a(), 'confirmed'));
update public.orders set subscription_id = tests.id('request') where id = tests.id('open');
select tests.authenticate_as(tests.admin());
select is(tests.left(tests.id('request')), 1, 'an open order holds one of 2 visits');
select throws_ok(
  $$ select public.admin_adjust_subscription_visits(tests.id('request'), 1, '') $$,
  'ZL011', 'reason_required', 'an adjustment needs a reason'
);
select throws_ok(
  $$ select public.admin_adjust_subscription_visits(tests.id('request'), -1, 'تصحيح') $$,
  '22023', 'invalid_adjustment', 'used visits never go below 0'
);
select throws_ok(
  $$ select public.admin_adjust_subscription_visits(tests.id('request'), 2, 'تصحيح') $$,
  '22023', 'invalid_adjustment', 'used and held never go above the total'
);
select lives_ok(
  $$ select public.admin_adjust_subscription_visits(tests.id('request'), 1, 'زيارة قبل التطبيق') $$,
  'an admin counts a visit made outside the app'
);
select is(tests.left(tests.id('request')), 0, 'leaving none');
select is(
  (select diff -> 'visits_left' from public.admin_audit_log
   where action = 'subscription.adjust' and entity_id = tests.id('request')::text),
  '{"from": 1, "to": 0}'::jsonb,
  'logged with the visits left before and after'
);
select is(
  (select count(*)::int from public.subscription_notes
   where subscription_id = tests.id('request') and note = 'زيارة قبل التطبيق'),
  1,
  'and the reason kept as a note'
);

-- Orders ------------------------------------------------------------------------------------------

select lives_ok(
  $$ select public.admin_set_order_subscription(tests.id('open'), false) $$,
  'an admin drops an order''s coverage'
);
select is(
  (select subscription_id from public.orders where id = tests.id('open')),
  null,
  'it is a cash order now'
);
select is(
  (select diff from public.admin_audit_log where action = 'order.subscription' and entity_id = tests.id('open')::text),
  jsonb_build_object('from', tests.id('request'), 'to', null),
  'logged'
);
select is(tests.left(tests.id('request')), 1, 'and the visit it held is free again');
select lives_ok(
  $$ select public.admin_set_order_subscription(tests.id('open'), true) $$,
  'an admin puts the subscription back on it'
);
select is(
  (select subscription_id from public.orders where id = tests.id('open')),
  tests.id('request'),
  'the subscription of its address'
);

select tests.clear_authentication();
insert into tests.ids values ('open2', tests.create_order(tests.a(), 'pending_confirmation'));
select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ select public.admin_set_order_subscription(tests.id('open2'), true) $$,
  'ZL034', 'no_visits_left', 'another order finds no visit left'
);

select tests.clear_authentication();
insert into tests.ids values ('done', tests.create_order(tests.a(), 'completed'));
select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ select public.admin_set_order_subscription(tests.id('done'), true) $$,
  'ZL038', 'subscription_change_not_allowed', 'a completed order keeps what it had'
);
select tests.clear_authentication();
insert into tests.ids values ('gone', tests.create_order(tests.a(), 'cancelled'));
update public.orders set subscription_id = tests.id('request') where id = tests.id('gone');
select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ select public.admin_set_order_subscription(tests.id('gone'), true) $$,
  'ZL038', 'subscription_change_not_allowed', 'coverage is put only on an order waiting for its visit'
);
select lives_ok(
  $$ select public.admin_set_order_subscription(tests.id('gone'), false) $$,
  'but dropped from a cancelled one, so it can come back as a cash order'
);

-- End and notes ---------------------------------------------------------------------------------

select throws_ok(
  $$ select public.admin_end_subscription(tests.id('family_request'), '  ') $$,
  'ZL011', 'reason_required', 'ending needs a reason'
);
select lives_ok(
  $$ select public.admin_end_subscription(tests.id('family_request'), 'رقم غلط') $$,
  'an admin declines a request'
);
select is(
  (select status::text from public.subscriptions where id = tests.id('family_request')),
  'declined',
  'it is declined'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.notifications where type = 'subscription_declined' and user_id = tests.a()),
  1,
  'and the customer told'
);
select tests.authenticate_as(tests.admin());
select lives_ok(
  $$ select public.admin_end_subscription(tests.id('renewal'), 'طلب الزبون') $$,
  'an admin cancels an active subscription'
);
select is(
  (select status::text from public.subscriptions where id = tests.id('renewal')),
  'cancelled',
  'it is cancelled'
);
select lives_ok(
  $$ select public.admin_add_subscription_note(tests.id('request'), '  اتصلنا بيه  ') $$,
  'an admin adds a note'
);
select is(
  (select count(*)::int from public.subscription_notes where note = 'اتصلنا بيه'),
  1,
  'trimmed'
);

select * from finish();
rollback;
