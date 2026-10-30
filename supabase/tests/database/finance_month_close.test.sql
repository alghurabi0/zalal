-- Month close: finance_settings.closed_through, admin_close_finance_month and
-- admin_reopen_finance_month (spec §7, §8.3 "Reports"; Phase 7, task 3).
--
-- The books are closed through a day: null (nothing closed) or the last day
-- of a month. Months close in order, one at a time, from the start day's
-- month: only a month that has ended (its last day before today in
-- Baghdad), and only the one right after the last closed month (ZL055
-- close_not_allowed). Only the latest closed month reopens, with a reason
-- (ZL011 reason_required; ZL055 reopen_not_allowed otherwise). Both are
-- admins only (42501), logged finance.month_close / finance.month_reopen.
-- While any month is closed the start day doesn't move (ZL056 books_closed).
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
-- The first day of the month n months before this one.
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(30);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

update public.finance_settings as s set start_on = tests.month(3) + 9, closed_through = null where s.id;

create function tests.closed_through() returns date language sql stable security definer
as $$ select closed_through from public.finance_settings where id $$;
create function tests.last_log(p_action text) returns public.admin_audit_log language sql stable security definer
as $$ select * from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure ----------------------------------------------------------------------------------

select has_column('public', 'finance_settings', 'closed_through', 'finance_settings has closed_through');
select throws_ok(
  $$ update public.finance_settings as s set closed_through = tests.month(2) + 3 where s.id $$,
  '23514', null, 'closed_through is the last day of a month'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_close_finance_month(tests.month(3)) $$,
  '42501', null, 'a guest cannot close a month'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_close_finance_month(tests.month(3)) $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select public.admin_close_finance_month(tests.month(3)) $$,
  '42501', 'not_allowed', 'nor another customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_close_finance_month(tests.month(3)) $$,
  '42501', 'not_allowed', 'nor a crew'
);
select is(tests.closed_through(), null, 'nothing was closed');

-- Closing ------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.admin_close_finance_month(tests.month(4)) $$,
  'ZL055', 'close_not_allowed', 'a month before the books cannot close'
);
select throws_ok(
  $$ select public.admin_close_finance_month(tests.month(2)) $$,
  'ZL055', 'close_not_allowed', 'months close in order: the start month first'
);
select throws_ok(
  $$ select public.admin_close_finance_month(null) $$,
  '22023', 'invalid_date', 'a month is required'
);
select lives_ok(
  $$ select public.admin_close_finance_month(tests.month(3) + 12) $$,
  'an admin closes the start month (any day names its month)'
);
select is(tests.closed_through(), tests.month(2) - 1, 'the books are closed through its last day');
select is(
  (tests.last_log('finance.month_close')).diff,
  jsonb_build_object('closed_through', jsonb_build_object('from', null, 'to', tests.month(2) - 1)),
  'the close is logged'
);
select throws_ok(
  $$ select public.admin_close_finance_month(tests.month(3)) $$,
  'ZL055', 'close_not_allowed', 'a closed month cannot close again'
);
select lives_ok($$ select public.admin_close_finance_month(tests.month(2)) $$, 'the next month closes');
select lives_ok($$ select public.admin_close_finance_month(tests.month(1)) $$, 'and last month');
select is(tests.closed_through(), tests.month(0) - 1, 'closed through the end of last month');
select throws_ok(
  $$ select public.admin_close_finance_month(tests.month(0)) $$,
  'ZL055', 'close_not_allowed', 'this month has not ended'
);

-- The start day holds still ------------------------------------------------------------------

select throws_ok(
  $$ select public.admin_update_finance_settings(tests.month(5)) $$,
  'ZL056', 'books_closed', 'the start day does not move earlier while a month is closed'
);
select throws_ok(
  $$ select public.admin_update_finance_settings(tests.month(3) + 20) $$,
  'ZL056', 'books_closed', 'nor later'
);

-- Reopening ----------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_reopen_finance_month(tests.month(1), 'تصحيح') $$,
  '42501', 'not_allowed', 'a crew cannot reopen a month'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_reopen_finance_month(tests.month(1), 'تصحيح') $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.admin_reopen_finance_month(tests.month(1), '  ') $$,
  'ZL011', 'reason_required', 'reopening needs a reason'
);
select throws_ok(
  $$ select public.admin_reopen_finance_month(tests.month(2), 'تصحيح') $$,
  'ZL055', 'reopen_not_allowed', 'only the latest closed month reopens'
);
select throws_ok(
  $$ select public.admin_reopen_finance_month(tests.month(0), 'تصحيح') $$,
  'ZL055', 'reopen_not_allowed', 'an open month does not reopen'
);
select lives_ok(
  $$ select public.admin_reopen_finance_month(tests.month(1), ' مصروف ناقص ') $$,
  'an admin reopens the latest closed month'
);
select is(tests.closed_through(), tests.month(1) - 1, 'the books are closed through the month before');
select is(
  (tests.last_log('finance.month_reopen')).diff,
  jsonb_build_object(
    'closed_through', jsonb_build_object('from', tests.month(0) - 1, 'to', tests.month(1) - 1),
    'reason', 'مصروف ناقص'
  ),
  'the reopen is logged with its reason'
);
select public.admin_reopen_finance_month(tests.month(2), 'تصحيح');
select public.admin_reopen_finance_month(tests.month(3), 'تصحيح');
select is(tests.closed_through(), null, 'reopening the start month leaves nothing closed');
select lives_ok(
  $$ select public.admin_update_finance_settings(tests.month(4)) $$,
  'with nothing closed the start day moves again'
);

select * from finish();
rollback;
