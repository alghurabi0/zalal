-- The "expiring in 30 days" notice (spec §9.2; Phase 6, task 2):
-- private.send_subscription_expiry_notices(day), run by pg_cron daily at
-- 07:13 UTC (10:13 Baghdad), writes one subscription_expiring notification
-- for each active subscription whose ends_on is 0–30 days after day, once
-- per ends_on (expiry_notified_on), for a live account, unless the address
-- already has a request or a later active subscription (a renewal). It
-- returns how many it wrote. Only postgres runs it.
begin;
\ir _helpers.psql

select plan(10);

create function tests.t() returns date language sql immutable as $$ select date '2027-03-01' $$;
-- An active subscription ending p_days after tests.t().
create function tests.ending(p_phone text, p_days int) returns uuid language sql
as $$
  select tests.create_subscription(
    tests.create_user(p_phone), 'active',
    (tests.t() + p_days - interval '12 months' + interval '1 day')::date
  )
$$;
create function tests.notices(p_phone text) returns int language sql stable
as $$
  select count(*)::int from public.notifications
  where user_id = tests.user_id(p_phone) and type = 'subscription_expiring'
$$;

insert into tests.ids values
  ('in30', tests.ending('+9647800000001', 30)),
  ('in31', tests.ending('+9647800000002', 31)),
  ('today', tests.ending('+9647800000003', 0)),
  ('deleted', tests.ending('+9647800000004', 10)),
  ('renewed', tests.ending('+9647800000005', 10)),
  ('ended', tests.ending('+9647800000006', -1));
update public.profiles set deleted_at = now() where id = tests.user_id('+9647800000004');
select tests.create_subscription(tests.user_id('+9647800000005'), 'requested');

select is(private.send_subscription_expiry_notices(tests.t()), 2, 'two notices go out');
select is(tests.notices('+9647800000001'), 1, 'for a subscription ending in 30 days');
select is(tests.notices('+9647800000003'), 1, 'and one ending today');
select is(tests.notices('+9647800000002'), 0, 'not one ending in 31 days');
select is(tests.notices('+9647800000004'), 0, 'not to a deleted account');
select is(tests.notices('+9647800000005'), 0, 'not when a renewal is already asked for');
select is(tests.notices('+9647800000006'), 0, 'not for one that has ended');
select is(private.send_subscription_expiry_notices(tests.t() + 1), 1, 'the next day only the newly due one');
select is(tests.notices('+9647800000001'), 1, 'each goes once');

select tests.authenticate_as(tests.user_id('+9647800000001'));
select throws_ok(
  $$ select private.send_subscription_expiry_notices(current_date) $$,
  '42501', null, 'users cannot run the job'
);

select * from finish();
rollback;
