-- finance_settings and admin_update_finance_settings (spec §7, §8.3 A17;
-- Phase 7, task 1).
--
-- One row: start_on, the day the books start. Admins read it; guests,
-- customers and crews don't. Nobody writes it directly: an admin changes it
-- with admin_update_finance_settings(start_on), which refuses a day after
-- today in Baghdad (ZL043 date_in_future) and a day after a live expense or
-- transfer (ZL046 records_before_start). Logs finance.settings with the old
-- and new day; no change logs nothing.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(20);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

create function tests.start_on() returns date language sql stable security definer
as $$ select start_on from public.finance_settings $$;
create function tests.audit_count(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

update public.finance_settings as s set start_on = tests.today() - 30 where s.id;

-- Structure ----------------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.finance_settings'::regclass),
  'RLS is on for finance_settings'
);
select is((select count(*)::int from public.finance_settings), 1, 'there is one row');
select throws_ok(
  $$ insert into public.finance_settings (id, start_on) values (false, current_date) $$,
  '23514', null, 'and only one'
);

-- Reads --------------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.finance_settings $$, '42501', null, 'a guest cannot read it');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.finance_settings $$, 'a customer reads nothing');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.finance_settings $$, 'nor does another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.finance_settings $$, 'nor a crew');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.finance_settings), 1, 'an admin reads it');
select throws_ok(
  $$ update public.finance_settings as s set start_on = current_date where s.id $$,
  '42501', null, 'but cannot write it directly'
);

-- admin_update_finance_settings --------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_update_finance_settings(current_date) $$,
  '42501', null, 'a guest cannot change it'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_update_finance_settings(current_date) $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_update_finance_settings(current_date) $$,
  '42501', 'not_allowed', 'nor a crew'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.admin_update_finance_settings(tests.today() + 1) $$,
  'ZL043', 'date_in_future', 'the books cannot start after today'
);
select throws_ok(
  $$ select public.admin_update_finance_settings(null) $$,
  '22023', 'invalid_start', 'a day is required'
);
select lives_ok(
  $$ select public.admin_update_finance_settings(tests.today() - 60) $$,
  'an admin moves the start earlier'
);
select is(tests.start_on(), tests.today() - 60, 'and it is saved');
select is(
  tests.last_diff('finance.settings'),
  jsonb_build_object(
    'start_on',
    jsonb_build_object('from', tests.today() - 30, 'to', tests.today() - 60)
  ),
  'logged with the old and new day'
);
select lives_ok(
  $$ select public.admin_update_finance_settings(tests.today() - 60) $$,
  'saving the same day works'
);
select is(tests.audit_count('finance.settings'), 1, 'and logs nothing');

-- A live expense 40 days ago keeps the start at or before it.
select tests.clear_authentication();
insert into public.expenses (spent_on, category_id, account_id, amount_iqd, created_by)
select tests.today() - 40, c.id, a.id, 5000, tests.user_id('+9647504444444')
from public.expense_categories as c, public.finance_accounts as a
where a.kind = 'cash' and c.kind = 'general'
limit 1;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.admin_update_finance_settings(tests.today() - 10) $$,
  'ZL046', 'records_before_start', 'the start cannot move past a recorded expense'
);

select * from finish();
rollback;
