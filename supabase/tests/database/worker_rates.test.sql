-- worker_rates, admin_save_worker_rate and admin_void_worker_rate (spec §7,
-- §8.3 A21; Phase 7, task 4).
--
-- A worker's pay, dated: from effective_on until the next live rate, the
-- worker earns per visit of their crew, per day ticked, a monthly salary
-- (split by calendar days in a partial month) or nothing ("none", also how
-- a worker who left stops earning). A raise is a new rate, so past months
-- keep theirs. One live rate per worker and day (ZL059 rate_exists). Admins
-- read them; guests, customers and crews none. Nobody writes the table
-- directly.
--
-- admin_save_worker_rate(id, worker_id, effective_on, pay_type, amount_iqd)
-- adds or edits a rate: the day is not after today (ZL043; it may be
-- before the books start), the amount is 1–1,000,000,000 and 0 only for
-- "none" (22023 invalid_amount); the worker is kept on an edit (22023
-- invalid_target), switched on for a new rate (ZL044 worker_inactive).
-- admin_void_worker_rate(id, reason): ZL011 reason_required; ZL047 once
-- voided, also for an edit. P0002 worker_not_found / rate_not_found. No rate
-- dated in a closed month is added, changed or voided (ZL054, trigger
-- worker_rates_refuse_closed). Logs worker_rate.create / .update / .void.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(27);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;

insert into public.workers (name) values ('علي'), ('حسن'), ('موقوف');
update public.workers set active = false where name = 'موقوف';
insert into tests.ids select name, id from public.workers;

create function tests.rate(p_id bigint) returns public.worker_rates language sql stable security definer
as $$ select * from public.worker_rates where id = p_id $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.worker_rates'::regclass),
  'RLS is on for worker_rates'
);
select throws_ok(
  format(
    $$ insert into public.worker_rates (worker_id, effective_on, pay_type, amount_iqd, created_by) values (%L, current_date, 'none', 5000, %L) $$,
    tests.id('علي'), tests.user_id('+9647504444444')
  ),
  '23514', null, '"none" pays nothing'
);
select throws_ok(
  format(
    $$ insert into public.worker_rates (worker_id, effective_on, pay_type, amount_iqd, created_by) values (%L, current_date, 'monthly', 0, %L) $$,
    tests.id('علي'), tests.user_id('+9647504444444')
  ),
  '23514', null, 'any other pay type pays something'
);

insert into public.worker_rates (worker_id, effective_on, pay_type, amount_iqd, created_by)
values (tests.id('حسن'), tests.month(2), 'monthly', 600000, tests.user_id('+9647504444444'));

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.worker_rates $$, '42501', null, 'a guest cannot read rates');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.worker_rates $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.worker_rates $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.worker_rates $$, 'nor a crew');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.worker_rates), 1, 'an admin reads them');
select throws_ok(
  $$ update public.worker_rates set amount_iqd = 1 where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  format($$ select public.admin_save_worker_rate(null, %L, current_date, 'per_visit', 10000) $$, tests.id('علي')),
  '42501', null, 'a guest cannot set a rate'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  format($$ select public.admin_save_worker_rate(null, %L, current_date, 'per_visit', 10000) $$, tests.id('علي')),
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  format($$ select public.admin_save_worker_rate(null, %L, current_date, 'per_visit', 10000) $$, tests.id('علي')),
  '42501', 'not_allowed', 'nor a crew raising its own pay'
);

-- Save, edit, void ---------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_worker_rate(null, tests.id('علي'), tests.month(3), 'per_visit', 10000) as visit_rate \gset
select is(
  tests.last_diff('worker_rate.create'),
  jsonb_build_object(
    'worker_id', tests.id('علي'), 'effective_on', tests.month(3), 'pay_type', 'per_visit', 'amount_iqd', 10000
  ),
  'an admin sets a rate, from before the books too; logged as worker_rate.create'
);
select throws_ok(
  format($$ select public.admin_save_worker_rate(null, %L, %L, 'per_day', 15000) $$, tests.id('علي'), tests.month(3)),
  'ZL059', 'rate_exists', 'one live rate per worker and day'
);
select throws_ok(
  format($$ select public.admin_save_worker_rate(null, %L, %L, 'per_day', 15000) $$, tests.id('علي'), tests.today() + 1),
  'ZL043', 'date_in_future', 'a rate does not start after today'
);
select throws_ok(
  format($$ select public.admin_save_worker_rate(null, %L, current_date, 'per_day', 0) $$, tests.id('علي')),
  '22023', 'invalid_amount', 'a paid rate has an amount'
);
select public.admin_save_worker_rate(null, tests.id('علي'), tests.today(), 'none', null) as none_rate \gset
select is((tests.rate(:none_rate)).amount_iqd, 0, '"none" takes no amount');
select throws_ok(
  format($$ select public.admin_save_worker_rate(null, %L, current_date, 'monthly', 500000) $$, tests.id('موقوف')),
  'ZL044', 'worker_inactive', 'a switched-off worker takes no new rate'
);
select throws_ok(
  format($$ select public.admin_save_worker_rate(%s, %L, %L, 'per_visit', 12000) $$, :visit_rate, tests.id('حسن'), tests.month(3)),
  '22023', 'invalid_target', 'an edit keeps the worker'
);
select lives_ok(
  format($$ select public.admin_save_worker_rate(%s, %L, %L, 'per_visit', 12000) $$, :visit_rate, tests.id('علي'), tests.month(3)),
  'an admin corrects a rate'
);
select is(
  tests.last_diff('worker_rate.update'),
  jsonb_build_object('worker_id', tests.id('علي'), 'amount_iqd', jsonb_build_object('from', 10000, 'to', 12000)),
  'logged with only what changed'
);
select throws_ok(
  format($$ select public.admin_void_worker_rate(%s, ' ') $$, :visit_rate),
  'ZL011', 'reason_required', 'voiding needs a reason'
);

-- Month close --------------------------------------------------------------------------------

select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(0) - 1 where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_void_worker_rate(%s, 'غلط') $$, :visit_rate),
  'ZL054', 'month_closed', 'a rate dated in a closed month (or before it) is not voided'
);
select throws_ok(
  format($$ select public.admin_save_worker_rate(null, %L, %L, 'monthly', 650000) $$, tests.id('حسن'), tests.month(1) + 9),
  'ZL054', 'month_closed', 'nor is a raise added into one'
);
select lives_ok(
  format($$ select public.admin_save_worker_rate(null, %L, %L, 'monthly', 650000) $$, tests.id('حسن'), tests.month(0)),
  'a raise from the open month is added'
);
select tests.clear_authentication();
update public.finance_settings as s set closed_through = null where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  format($$ select public.admin_void_worker_rate(%s, 'غلط') $$, :visit_rate),
  'once reopened, the rate is voided'
);
select throws_ok(
  format($$ select public.admin_save_worker_rate(%s, %L, %L, 'per_visit', 12000) $$, :visit_rate, tests.id('علي'), tests.month(3)),
  'ZL047', 'record_voided', 'a voided rate is not edited'
);

select * from finish();
rollback;
