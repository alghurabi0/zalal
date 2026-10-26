-- admin_block_date(date, reason) and admin_unblock_date(date) (spec §8.2 A9,
-- §7). Admins only (42501 for everyone else; guests can't call them). A day
-- before today in Baghdad can't be blocked (22023 date_in_past). Blocking a
-- day that is already blocked updates its reason. The reason is optional,
-- 2-100 characters (23514). Unblocking a day that isn't blocked is P0002
-- blocked_date_not_found. Each change is logged ('blocked_date.add' with the
-- reason, 'blocked_date.update' with the old and new reason,
-- 'blocked_date.remove' with the old reason). Blocking never touches the
-- orders booked that day; booking_availability() stops offering it at once.
begin;
\ir _helpers.psql

select plan(22);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

delete from public.blocked_dates;
insert into tests.ids values (
  'order',
  tests.create_order(tests.user_id('+9647801111111'), 'confirmed', (tests.today() + 5 + time '05:00') at time zone 'Asia/Baghdad')
);

create function tests.blocked() returns table (date date, reason text)
language sql stable security definer
as $$ select date, reason from public.blocked_dates order by date $$;

create function tests.audit(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;

grant execute on all functions in schema tests to anon, authenticated;

-- Everyone but admins --------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_block_date(tests.today() + 5, null) $$,
  '42501', null, 'a guest cannot block a day'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_block_date(tests.today() + 5, null) $$,
  '42501', 'not_allowed', 'a customer cannot block a day'
);
select throws_ok(
  $$ insert into public.blocked_dates (date) values (tests.today() + 5) $$,
  '42501', null, 'a customer cannot insert one directly'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select public.admin_block_date(tests.today() + 5, null) $$,
  '42501', 'not_allowed', 'another customer cannot block a day'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_block_date(tests.today() + 5, null) $$,
  '42501', 'not_allowed', 'a crew cannot block a day'
);

select tests.clear_authentication();
select is_empty($$ select * from tests.blocked() $$, 'nothing was blocked by the refused callers');

-- Admin ------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select throws_ok(
  $$ insert into public.blocked_dates (date) values (tests.today() + 5) $$,
  '42501', null, 'an admin cannot insert one directly either'
);
select lives_ok(
  $$ select public.admin_block_date(tests.today() + 5, 'عاشوراء') $$,
  'an admin blocks a day with an order on it'
);
select results_eq(
  $$ select * from tests.blocked() $$,
  $$ values (tests.today() + 5, 'عاشوراء'::text) $$,
  'the day is blocked with its reason'
);
select results_eq(
  $$ select entity, entity_id, diff from public.admin_audit_log where action = 'blocked_date.add' $$,
  $$ values ('blocked_dates', (tests.today() + 5)::text, '{"reason": "عاشوراء"}'::jsonb) $$,
  'the block is in the audit log'
);
select is(
  (select status::text from public.orders where id = tests.id('order')),
  'confirmed',
  'the order that day is untouched'
);
select is(
  (select count(*)::int from public.slot_bookings where order_id = tests.id('order')),
  1,
  'and still holds its place'
);

select lives_ok(
  $$ select public.admin_block_date(tests.today() + 5, 'أربعينية') $$,
  'blocking the day again changes its reason'
);
select results_eq(
  $$ select diff from public.admin_audit_log where action = 'blocked_date.update' $$,
  $$ values ('{"reason": {"from": "عاشوراء", "to": "أربعينية"}}'::jsonb) $$,
  'the new reason is logged'
);
select lives_ok($$ select public.admin_block_date(tests.today(), null) $$, 'an admin blocks today, without a reason');
select throws_ok(
  $$ select public.admin_block_date(tests.today() - 1, null) $$,
  '22023', 'date_in_past', 'a past day cannot be blocked'
);
select throws_ok(
  $$ select public.admin_block_date(tests.today() + 6, 'x') $$,
  '23514', null, 'a one-letter reason is refused'
);

select lives_ok($$ select public.admin_unblock_date(tests.today() + 5) $$, 'an admin unblocks a day');
select results_eq(
  $$ select * from tests.blocked() $$,
  $$ values (tests.today(), null::text) $$,
  'only today is still blocked'
);
select results_eq(
  $$ select diff from public.admin_audit_log where action = 'blocked_date.remove' $$,
  $$ values ('{"reason": "أربعينية"}'::jsonb) $$,
  'the unblock is in the audit log'
);
select throws_ok(
  $$ select public.admin_unblock_date(tests.today() + 9) $$,
  'P0002', 'blocked_date_not_found', 'a day that is not blocked cannot be unblocked'
);
select is(tests.audit('blocked_date.add'), 2, 'refused changes log nothing');

select * from finish();
rollback;
