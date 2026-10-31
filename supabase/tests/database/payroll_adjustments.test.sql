-- payroll_adjustments, admin_save_payroll_adjustment and
-- admin_void_payroll_adjustment (spec §7, §8.3 A21; Phase 7, task 4).
--
-- A bonus or a deduction on a worker's pay, dated, with a reason; it
-- counts in the month of its day. Admins read them; guests, customers and
-- crews none. Nobody writes the table directly.
--
-- admin_save_payroll_adjustment(id, worker_id, adjusted_on, kind,
-- amount_iqd, reason) adds or edits one: the expense rules for the day
-- (ZL042, ZL043) and amount (22023 invalid_amount), a reason (ZL011
-- reason_required), the worker kept on an edit (22023 invalid_target) and
-- switched on for a new one (ZL044 worker_inactive).
-- admin_void_payroll_adjustment(id, reason): ZL011; ZL047 once voided.
-- P0002 worker_not_found / adjustment_not_found. Nothing dated in a closed
-- month is added, changed or voided (ZL054). Logs
-- payroll_adjustment.create / .update / .void.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(25);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;

insert into public.workers (name) values ('علي'), ('حسن'), ('موقوف');
update public.workers set active = false where name = 'موقوف';
insert into tests.ids select name, id from public.workers;

create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.payroll_adjustments'::regclass),
  'RLS is on for payroll_adjustments'
);
select throws_ok(
  format(
    $$ insert into public.payroll_adjustments (worker_id, adjusted_on, kind, amount_iqd, reason, created_by)
       values (%L, current_date, 'bonus', 0, 'عيد', %L) $$,
    tests.id('علي'), tests.user_id('+9647504444444')
  ),
  '23514', null, 'an amount is positive'
);

insert into public.payroll_adjustments (worker_id, adjusted_on, kind, amount_iqd, reason, created_by)
values (tests.id('حسن'), tests.today(), 'bonus', 5000, 'عيد', tests.user_id('+9647504444444'));

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.payroll_adjustments $$, '42501', null, 'a guest cannot read bonuses');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.payroll_adjustments $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.payroll_adjustments $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.payroll_adjustments $$, 'nor a crew');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.payroll_adjustments), 1, 'an admin reads them');
select throws_ok(
  $$ delete from public.payroll_adjustments where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  format($$ select public.admin_save_payroll_adjustment(null, %L, current_date, 'bonus', 5000, 'عيد') $$, tests.id('علي')),
  '42501', null, 'a guest cannot add a bonus'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  format($$ select public.admin_save_payroll_adjustment(null, %L, current_date, 'bonus', 5000, 'عيد') $$, tests.id('علي')),
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  format($$ select public.admin_save_payroll_adjustment(null, %L, current_date, 'bonus', 5000, 'عيد') $$, tests.id('علي')),
  '42501', 'not_allowed', 'nor a crew'
);

-- Save, edit, void ---------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_payroll_adjustment(
  null, tests.id('علي'), tests.month(1) + 2, 'deduction', 2000, 'غياب بدون إذن'
) as cut \gset
select is(
  tests.last_diff('payroll_adjustment.create'),
  jsonb_build_object(
    'worker_id', tests.id('علي'), 'adjusted_on', tests.month(1) + 2, 'kind', 'deduction',
    'amount_iqd', 2000, 'reason', 'غياب بدون إذن'
  ),
  'an admin records a deduction, logged as payroll_adjustment.create'
);
select throws_ok(
  format($$ select public.admin_save_payroll_adjustment(null, %L, current_date, 'bonus', 5000, '  ') $$, tests.id('علي')),
  'ZL011', 'reason_required', 'a bonus has a reason'
);
select throws_ok(
  format($$ select public.admin_save_payroll_adjustment(null, %L, %L, 'bonus', 5000, 'عيد') $$, tests.id('علي'), tests.month(2) - 1),
  'ZL042', 'before_finance_start', 'not before the books start'
);
select throws_ok(
  format($$ select public.admin_save_payroll_adjustment(null, %L, %L, 'bonus', 5000, 'عيد') $$, tests.id('علي'), tests.today() + 1),
  'ZL043', 'date_in_future', 'nor after today'
);
select throws_ok(
  format($$ select public.admin_save_payroll_adjustment(null, %L, current_date, 'bonus', 5000, 'عيد') $$, tests.id('موقوف')),
  'ZL044', 'worker_inactive', 'a switched-off worker takes no new bonus'
);
select throws_ok(
  $$ select public.admin_save_payroll_adjustment(null, gen_random_uuid(), current_date, 'bonus', 5000, 'عيد') $$,
  'P0002', 'worker_not_found', 'a missing worker is refused'
);
select throws_ok(
  format($$ select public.admin_save_payroll_adjustment(%s, %L, %L, 'deduction', 3000, 'غياب') $$, :cut, tests.id('حسن'), tests.month(1) + 2),
  '22023', 'invalid_target', 'an edit keeps the worker'
);
select lives_ok(
  format($$ select public.admin_save_payroll_adjustment(%s, %L, %L, 'deduction', 3000, 'غياب بدون إذن') $$, :cut, tests.id('علي'), tests.month(1) + 2),
  'an admin corrects a deduction'
);
select is(
  tests.last_diff('payroll_adjustment.update'),
  jsonb_build_object('amount_iqd', jsonb_build_object('from', 2000, 'to', 3000)),
  'logged with only what changed'
);

-- Month close --------------------------------------------------------------------------------

select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(0) - 1 where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_void_payroll_adjustment(%s, 'غلط') $$, :cut),
  'ZL054', 'month_closed', 'a deduction in a closed month is not voided'
);
select throws_ok(
  format($$ select public.admin_save_payroll_adjustment(null, %L, %L, 'bonus', 5000, 'عيد') $$, tests.id('علي'), tests.month(1) + 5),
  'ZL054', 'month_closed', 'nor is a bonus added into one'
);
select tests.clear_authentication();
update public.finance_settings as s set closed_through = null where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  format($$ select public.admin_void_payroll_adjustment(%s, 'غلط') $$, :cut),
  'once reopened, it is voided'
);
select is(
  tests.last_diff('payroll_adjustment.void'),
  jsonb_build_object('adjusted_on', tests.month(1) + 2, 'amount_iqd', 3000, 'reason', 'غلط'),
  'logged as payroll_adjustment.void'
);
select throws_ok(
  format($$ select public.admin_void_payroll_adjustment(%s, 'غلط') $$, :cut),
  'ZL047', 'record_voided', 'a voided one is not voided again'
);

select * from finish();
rollback;
