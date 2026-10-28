-- subscriptions, subscription_notes and subscription_overview (spec §7,
-- Phase 6, task 2; settled Oct 28, 2026: a subscription belongs to one
-- address).
--
-- A customer reads their own subscriptions; admins read every one; guests,
-- crews and other customers none. Nobody writes the table through the API:
-- request_subscription and the A7 RPCs do. subscription_notes are internal:
-- admins only. subscription_overview (security invoker) adds the counts the
-- screens need under the same rules. Rows: one request per address; an
-- active row has its plan and dates, ending 12 months after the start; two
-- active subscriptions on one address never overlap. An order can use only
-- a subscription of its own address. The plan is in settings (price null =
-- not offered). subscriptions is in the Realtime publication.
begin;
\ir _helpers.psql

select plan(36);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;

insert into tests.ids values
  ('home_a', tests.create_address(tests.a(), 'home')),
  ('family_a', tests.create_address(tests.a(), 'family')),
  ('home_b', tests.create_address(tests.b(), 'home')),
  ('family_b', tests.create_address(tests.b(), 'family'));
update public.addresses set is_default = (id = tests.id('home_b')) where user_id = tests.b();
update public.addresses set is_default = (id = tests.id('home_a')) where user_id = tests.a();
insert into tests.ids values
  ('sub_a', tests.create_subscription(tests.a(), 'active', p_address_id => tests.id('home_a'))),
  ('sub_b', tests.create_subscription(tests.b(), 'requested', p_address_id => tests.id('home_b')));
insert into public.subscription_notes (subscription_id, author_id, note)
values (tests.id('sub_a'), tests.user_id('+9647504444444'), 'دفع نقداً بالمكتب');

-- Structure ----------------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.subscriptions'::regclass),
  'RLS is on for subscriptions'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.subscription_notes'::regclass),
  'RLS is on for subscription_notes'
);
select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subscriptions'
  ),
  'subscriptions are in the Realtime publication'
);
select is(
  (select subscription_visits from public.settings),
  2::smallint,
  'the plan has 2 visits by default'
);
select is(
  (select subscription_tanks from public.settings),
  1::smallint,
  'for 1 tank by default'
);
select throws_ok(
  $$ update public.settings as s set subscription_price_iqd = 0 where s.id $$,
  '23514', null, 'a price is positive'
);
select throws_ok(
  $$ update public.settings as s set subscription_visits = 13 where s.id $$,
  '23514', null, 'at most 12 visits'
);
select lives_ok(
  $$ update public.settings as s set subscription_price_iqd = null where s.id $$,
  'no price means the plan is not offered yet'
);

-- Row rules --------------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.subscriptions (user_id, address_id) values (tests.b(), tests.id('home_b')) $$,
  '23505', null, 'one request per address'
);
select lives_ok(
  $$ insert into public.subscriptions (user_id, address_id) values (tests.a(), tests.id('family_a')) $$,
  'another address of the same customer takes its own request'
);
select throws_ok(
  $$ insert into public.subscriptions (user_id, address_id) values (tests.a(), tests.id('family_b')) $$,
  '23503', null, 'a subscription is on its customer''s own address'
);
select throws_ok(
  $$ insert into public.subscriptions (user_id, address_id, status) values (tests.b(), tests.id('home_b'), 'active') $$,
  '23514', null, 'an active subscription has its plan and dates'
);
select throws_ok(
  $$ insert into public.subscriptions (
       user_id, address_id, status, price_iqd, visits_total, tanks_covered, starts_on, ends_on, activated_at
     )
     values (tests.b(), tests.id('home_b'), 'active', 60000, 2, 1, '2027-01-01', '2027-06-30', now()) $$,
  '23514', null, 'it ends 12 months after it starts'
);
select throws_ok(
  $$ select tests.create_subscription(
       tests.a(), 'active', (now() at time zone 'Asia/Baghdad')::date + 200, p_address_id => tests.id('home_a')
     ) $$,
  '23P01', null, 'two active subscriptions on one address never overlap'
);
select lives_ok(
  $$ select tests.create_subscription(
       tests.a(), 'active', ((now() at time zone 'Asia/Baghdad')::date + interval '12 months')::date, p_address_id => tests.id('home_a')
     ) $$,
  'a renewal starts the day after the current one ends'
);
insert into tests.ids values
  ('order_a', tests.create_order(tests.a())),
  ('order_b', tests.create_order(tests.b()));
select throws_ok(
  $$ update public.orders set subscription_id = tests.id('sub_a') where id = tests.id('order_b') $$,
  '23503', null, 'an order uses only a subscription of its own address'
);
select lives_ok(
  $$ update public.orders set subscription_id = tests.id('sub_a') where id = tests.id('order_a') $$,
  'an order at the subscribed address can use it'
);

-- Reads ----------------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.subscriptions $$,
  '42501', null, 'guests read no subscriptions'
);
select throws_ok(
  $$ select * from public.subscription_overview $$,
  '42501', null, 'nor the overview'
);

select tests.authenticate_as(tests.a());
select is(
  (select count(*)::int from public.subscriptions),
  3,
  'a customer reads their own subscriptions (one per address, and the renewal)'
);
select is(
  (select count(*)::int from public.subscriptions where user_id <> tests.a()),
  0,
  'and nobody else''s'
);
select is(
  (select count(*)::int from public.subscription_overview where id = tests.id('sub_b')),
  0,
  'nor another customer''s overview'
);
select is(
  (select count(*)::int from public.subscription_notes),
  0,
  'a customer never reads the internal notes'
);
select is(
  (select state from public.subscription_overview where id = tests.id('sub_a')),
  'active',
  'the overview says the subscription is active'
);
select is(
  (select visits_held from public.subscription_overview where id = tests.id('sub_a')),
  1,
  'the open order on it holds a visit'
);
select is(
  (select visits_left from public.subscription_overview where id = tests.id('sub_a')),
  1,
  'so 1 of 2 visits is left'
);

select tests.authenticate_as(tests.b());
select is(
  (select count(*)::int from public.subscriptions),
  1,
  'the other customer reads only their request'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is((select count(*)::int from public.subscriptions), 0, 'crews read no subscriptions');
select is((select count(*)::int from public.subscription_notes), 0, 'nor notes');

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.subscriptions), 4, 'admins read every subscription');
select is((select count(*)::int from public.subscription_notes), 1, 'and every note');
select is(
  (select customer_phone from public.subscription_overview where id = tests.id('sub_b')),
  '+9647802222222',
  'the overview names the customer for A7'
);

-- Writes ---------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ insert into public.subscriptions (user_id, address_id) values (tests.a(), tests.id('family_a')) $$,
  '42501', null, 'a customer cannot insert a subscription directly'
);
select throws_ok(
  $$ update public.subscriptions set visits_total = 12 where id = tests.id('sub_a') $$,
  '42501', null, 'nor change one'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ update public.subscriptions set paid = true where id = tests.id('sub_a') $$,
  '42501', null, 'admins change subscriptions only through the A7 functions'
);
select throws_ok(
  $$ insert into public.subscription_notes (subscription_id, author_id, note)
     values (tests.id('sub_a'), tests.user_id('+9647504444444'), 'ملاحظة') $$,
  '42501', null, 'and write notes only through them'
);

select * from finish();
rollback;
