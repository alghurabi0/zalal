-- request_subscription(address_id) (spec N8, §9.2; Phase 6, task 2).
--
-- Customers only (42501 otherwise). Refused while the plan has no price
-- (ZL037 subscription_not_offered). The address must be the caller's and
-- live (P0002 address_not_found) and inside an active service area (ZL001).
-- One request per address: asking again returns the same request. Refused
-- while the address has an active subscription that ends more than 30 days
-- from today (ZL035 subscription_exists); from 30 days before the end, or
-- after a decline, a new request is taken (a renewal). Every live admin gets
-- a subscription_requested notification.
begin;
\ir _helpers.psql

select plan(17);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

delete from public.service_areas;
insert into public.service_areas (name, area)
values ('Test Karbala', 'SRID=4326;MULTIPOLYGON(((43.9 32.5, 44.1 32.5, 44.1 32.7, 43.9 32.7, 43.9 32.5)))');
update public.settings as s set subscription_price_iqd = 60000 where s.id;

insert into tests.ids values
  ('home', tests.create_address(tests.a(), 'home')),
  ('family', tests.create_address(tests.a(), 'family')),
  ('work', tests.create_address(tests.a(), 'work')),
  ('b_home', tests.create_address(tests.user_id('+9647802222222'), 'home'));
-- Moved to Baghdad past the addresses' own area check, as if the area had
-- shrunk since it was saved.
set local session_replication_role = replica;
update public.addresses set lat = 33.3, lng = 44.4 where id = tests.id('work');
set local session_replication_role = origin;
-- family: active for 11 more months; home: active, ending in 20 days.
select tests.create_subscription(tests.a(), 'active', tests.today() - 30, p_address_id => tests.id('family'));
select tests.create_subscription(
  tests.a(), 'active', (tests.today() + 20 - interval '12 months' + interval '1 day')::date,
  p_address_id => tests.id('home')
);

-- Who ------------------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.request_subscription(tests.id('home')) $$,
  '42501', null, 'guests cannot request'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.request_subscription(tests.id('home')) $$,
  '42501', 'not_allowed', 'crews cannot request'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.request_subscription(tests.id('home')) $$,
  '42501', 'not_allowed', 'admins cannot request'
);

-- Refusals -------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.request_subscription(tests.id('b_home')) $$,
  'P0002', 'address_not_found', 'another customer''s address is refused'
);
select throws_ok(
  $$ select public.request_subscription(tests.id('work')) $$,
  'ZL001', 'outside_service_area', 'an address outside the service area is refused'
);
select throws_ok(
  $$ select public.request_subscription(tests.id('family')) $$,
  'ZL035', 'subscription_exists', 'an address whose subscription runs for months more is refused'
);

select tests.clear_authentication();
update public.settings as s set subscription_price_iqd = null where s.id;
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.request_subscription(tests.id('home')) $$,
  'ZL037', 'subscription_not_offered', 'nothing is requested while the plan has no price'
);
select tests.clear_authentication();
update public.settings as s set subscription_price_iqd = 60000 where s.id;

-- A renewal --------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
insert into tests.ids select 'renewal', public.request_subscription(tests.id('home'));
select isnt(tests.id('renewal'), null, 'an address whose subscription ends within 30 days takes a renewal');
select is(
  (select status::text from public.subscriptions where id = tests.id('renewal')),
  'requested',
  'as a request'
);
select is(
  (select address_id from public.subscriptions where id = tests.id('renewal')),
  tests.id('home'),
  'on that address'
);
select is(
  (select price_iqd from public.subscriptions where id = tests.id('renewal')),
  null,
  'with its plan set only when it is activated'
);
select is(
  public.request_subscription(tests.id('home')),
  tests.id('renewal'),
  'asking again returns the same request'
);
select is(
  (select count(*)::int from public.subscriptions where address_id = tests.id('home')),
  2,
  'so there is still one request'
);

select tests.clear_authentication();
select is(
  (select count(*)::int from public.notifications
   where type = 'subscription_requested' and user_id = tests.user_id('+9647504444444')
     and data ->> 'subscription_id' = tests.id('renewal')::text),
  1,
  'the admin is told about the request once'
);
select is(
  (select count(*)::int from public.notifications where type = 'subscription_requested' and user_id = tests.a()),
  0,
  'the customer is not'
);

-- After a decline -------------------------------------------------------------------------------

update public.subscriptions
set status = 'declined', ended_at = now()
where id = tests.id('renewal');
select tests.authenticate_as(tests.a());
select isnt(
  public.request_subscription(tests.id('home')),
  tests.id('renewal'),
  'after a decline the customer can ask again'
);

-- A deleted address ---------------------------------------------------------------------------

select tests.clear_authentication();
update public.addresses set deleted_at = now(), is_default = false where id = tests.id('work');
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.request_subscription(tests.id('work')) $$,
  'P0002', 'address_not_found', 'a deleted address is refused'
);

select * from finish();
rollback;
