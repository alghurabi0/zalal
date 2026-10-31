-- admin_payroll(from, to, worker_id): earned against paid, by month (spec
-- §7, §8.3 A21; Phase 7, task 4). Admins only (42501), at most 24 months
-- (22023 invalid_date).
--
-- One row per worker and month. Earned counts days from the books' start
-- through today, each under the live rate in effect that day:
-- - per visit: each completed order of the crew the worker was in on its
--   completion day (covered orders too; manual sales don't count);
-- - per day: each ticked day;
-- - monthly: the salary × the month's days under the rate ÷ the days in the
--   month, rounded to the dinar (a partial month, or a raise mid-month);
-- - none: nothing;
-- plus live bonuses less live deductions by their day. Paid is the live
-- wage expenses linked to the worker, by their day. The balance at each
-- month's end is the opening balance + everything earned − everything paid
-- since the start: above 0 owed to the worker, below 0 an advance. The row
-- also names the worker's crew and rate on the month's last counted day.
-- Visits and days are the month's activity, whatever the rate.
--
-- Hand count for last month (M), books from the month before:
-- - علي, per visit 10,000, 12,000 from the 21st; crew A to the 15th, then
--   crew B. Crew A completed on the 5th, 10th and 15th (a covered order),
--   and on the 21st (after he left); crew B on the 11th (before he joined)
--   and the 21st; a cancelled order of crew A doesn't count. Visits 4:
--   3 × 10,000 + 12,000 = 42,000; bonus 5,000 (another voided), deduction
--   2,000; earned 45,000. Paid 50,000 (another voided), so an advance of
--   5,000, carried into this month.
-- - حسن, no crew, monthly 600,000 from the 11th, opening balance 100,000:
--   600,000 × (days in M − 10) ÷ days in M; this month through today.
-- - كرار, per day 15,000: 3 days ticked = 45,000, paid 45,000: nothing owed.
-- - موقوف: switched off, nothing; still listed.
-- A20's expenses for M are what the workers earned in M plus wages paid to no worker (since task 5).
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;
create function tests.dim(p_month date) returns int language sql immutable
as $$ select extract(day from (p_month + interval '1 month' - interval '1 day'))::int $$;

select plan(16);

select tests.create_user('+9647801111111');            -- customer
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values
  ('crew_a', tests.create_crew('+9647703333333')),
  ('crew_b', tests.create_crew('+9647703333334'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;

create function tests.completed_order(p_crew uuid, p_on date, p_status text default 'completed')
returns uuid
language plpgsql
as $$
declare
  v_id uuid := tests.create_order(
    tests.user_id('+9647801111111'), p_status, p_on::timestamptz - interval '2 hours', p_crew
  );
begin
  if p_status = 'completed' then
    insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, created_at)
    values (v_id, 'in_progress', 'completed', tests.user_id('+9647504444444'), 'admin',
      (p_on + time '12:00') at time zone 'Asia/Baghdad');
  end if;
  return v_id;
end;
$$;

select tests.completed_order(tests.id('crew_a'), tests.month(1) + 4);
select tests.completed_order(tests.id('crew_a'), tests.month(1) + 9);
insert into tests.ids values ('covered', tests.completed_order(tests.id('crew_a'), tests.month(1) + 14));
select tests.completed_order(tests.id('crew_a'), tests.month(1) + 20);
select tests.completed_order(tests.id('crew_b'), tests.month(1) + 10);
select tests.completed_order(tests.id('crew_b'), tests.month(1) + 20);
select tests.completed_order(tests.id('crew_a'), tests.month(1) + 6, 'cancelled');
update public.orders set subscription_id = tests.create_subscription(tests.user_id('+9647801111111'), 'active', tests.month(2))
where id = tests.id('covered');

insert into public.expense_categories (name, kind) values ('أجور', 'wages');
create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.wages() returns bigint language sql stable security definer
as $$ select id from public.expense_categories where name = 'أجور' $$;
create function tests.row(p_name text, p_month date) returns text language sql stable security definer
as $$
  select (p.crew_id, p.pay_type, p.rate_iqd, p.visits, p.days, p.base_iqd, p.bonuses_iqd, p.deductions_iqd,
    p.earned_iqd, p.paid_iqd, p.balance_iqd)::text
  from public.admin_payroll(tests.month(2), tests.today()) as p
  join public.workers as w on w.id = p.worker_id
  where w.name = p_name and p.month = p_month
$$;
grant execute on all functions in schema tests to anon, authenticated;

-- The admin records it, through the RPCs -----------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_worker(null, 'علي', null, null, 0, true) as ali \gset
select public.admin_save_worker(null, 'حسن', null, null, 100000, true) as hasan \gset
select public.admin_save_worker(null, 'كرار', null, null, 0, true) as karrar \gset
select public.admin_save_worker(null, 'موقوف', null, null, 0, false);

select public.admin_save_worker_rate(null, :'ali', tests.month(2), 'per_visit', 10000);
select public.admin_save_worker_rate(null, :'ali', tests.month(1) + 20, 'per_visit', 12000);
select public.admin_save_worker_rate(null, :'hasan', tests.month(1) + 10, 'monthly', 600000);
select public.admin_save_worker_rate(null, :'karrar', tests.month(2), 'per_day', 15000);

select public.admin_save_worker_crew(null, :'ali', tests.id('crew_a'), tests.month(2), null);
select public.admin_move_worker(:'ali', tests.id('crew_b'), tests.month(1) + 15);

select public.admin_save_payroll_adjustment(null, :'ali', tests.month(1) + 24, 'bonus', 5000, 'شغل زايد');
select public.admin_void_payroll_adjustment(
  public.admin_save_payroll_adjustment(null, :'ali', tests.month(1) + 24, 'bonus', 9999, 'غلط'), 'مكررة'
);
select public.admin_save_payroll_adjustment(null, :'ali', tests.month(1) + 25, 'deduction', 2000, 'غياب');
select public.admin_set_worker_days(:'karrar', tests.month(1), array[tests.month(1) + 1, tests.month(1) + 2, tests.month(1) + 3]);

select public.admin_save_expense(null, tests.month(1) + 26, tests.wages(), tests.cash(), 50000, null, :'ali');
select public.admin_void_expense(
  public.admin_save_expense(null, tests.month(1) + 26, tests.wages(), tests.cash(), 7000, null, :'ali'), 'مكرر'
);
select public.admin_save_expense(null, tests.month(1) + 26, tests.wages(), tests.cash(), 20000, 'عامل يومية');
select public.admin_save_expense(null, tests.month(1) + 27, tests.wages(), tests.cash(), 45000, null, :'karrar');

-- Callers ------------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.admin_payroll(current_date, current_date) $$,
  '42501', null, 'a guest cannot read the payroll'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select * from public.admin_payroll(current_date, current_date) $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select * from public.admin_payroll(current_date, current_date) $$,
  '42501', 'not_allowed', 'nor a crew'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select * from public.admin_payroll(%L, %L) $$, tests.month(0), tests.month(0) + interval '2 years'),
  '22023', 'invalid_date', 'at most 24 months'
);
select is(
  (select count(*)::int from public.admin_payroll(tests.month(2), tests.today())),
  12,
  'a row per worker and month, switched-off workers included'
);
select is(
  (select count(*)::int from public.admin_payroll(tests.month(2), tests.today(), :'ali')),
  3,
  'or one worker''s months'
);

-- The hand count -----------------------------------------------------------------------------

select is(
  tests.row('علي', tests.month(1)),
  (tests.id('crew_b'), 'per_visit'::public.worker_pay_type, 12000, 4, 0, 42000::bigint, 5000::bigint, 2000::bigint,
    45000::bigint, 50000::bigint, -5000::bigint)::text,
  'per visit: his crews'' visits while he was in each, at the rate of the day; paid ahead is an advance'
);
select is(
  tests.row('علي', tests.month(0)),
  (tests.id('crew_b'), 'per_visit'::public.worker_pay_type, 12000, 0, 0, 0::bigint, 0::bigint, 0::bigint,
    0::bigint, 0::bigint, -5000::bigint)::text,
  'the advance carries into this month'
);
select is(
  tests.row('علي', tests.month(2)),
  (tests.id('crew_a'), 'per_visit'::public.worker_pay_type, 10000, 0, 0, 0::bigint, 0::bigint, 0::bigint,
    0::bigint, 0::bigint, 0::bigint)::text,
  'and the month before had nothing'
);
select is(
  tests.row('حسن', tests.month(1)),
  (null::uuid, 'monthly'::public.worker_pay_type, 600000, 0, 0,
    round(600000::numeric * (tests.dim(tests.month(1)) - 10) / tests.dim(tests.month(1)))::bigint,
    0::bigint, 0::bigint,
    round(600000::numeric * (tests.dim(tests.month(1)) - 10) / tests.dim(tests.month(1)))::bigint,
    0::bigint,
    100000 + round(600000::numeric * (tests.dim(tests.month(1)) - 10) / tests.dim(tests.month(1)))::bigint)::text,
  'monthly from the 11th: the salary split by calendar days, on top of the opening balance'
);
select is(
  (select p.balance_iqd from public.admin_payroll(tests.month(0), tests.month(0), :'hasan') as p),
  (
    100000
    + round(600000::numeric * (tests.dim(tests.month(1)) - 10) / tests.dim(tests.month(1)))
    + round(600000::numeric * extract(day from tests.today()) / tests.dim(tests.month(0)))
  )::bigint,
  'this month counts the days through today'
);
select is(
  (select p.balance_iqd from public.admin_payroll(tests.month(2), tests.month(2), :'hasan') as p),
  100000::bigint,
  'the opening balance stands from the start'
);
select is(
  tests.row('كرار', tests.month(1)),
  (null::uuid, 'per_day'::public.worker_pay_type, 15000, 0, 3, 45000::bigint, 0::bigint, 0::bigint,
    45000::bigint, 45000::bigint, 0::bigint)::text,
  'per day: the days ticked'
);
select is(
  tests.row('موقوف', tests.month(1)),
  (null::uuid, null::public.worker_pay_type, null::int, 0, 0, 0::bigint, 0::bigint, 0::bigint,
    0::bigint, 0::bigint, 0::bigint)::text,
  'a worker with no rate earns nothing'
);

-- Reports and month close --------------------------------------------------------------------

select is(
  (select row(p.wages_iqd, p.expenses_iqd, p.paid_out_iqd)::text
   from public.admin_profit_and_loss(tests.month(1), tests.month(1)) as p),
  row(
    (select sum(x.earned_iqd) from public.admin_payroll(tests.month(1), tests.month(1)) as x)::bigint,
    (select sum(x.earned_iqd) from public.admin_payroll(tests.month(1), tests.month(1)) as x)::bigint + 20000,
    (50000 + 20000 + 45000)::bigint
  )::text,
  'A20 counts the wages earned plus casual labour paid (since task 5); its cash view every wage paid'
);
select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(0) - 1 where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.transition_order(%L, 'in_progress', '{"override": true, "reason": "غلط"}') $$, tests.id('covered')),
  'ZL054', 'month_closed', 'a covered order completed in a closed month stays completed: it is a visit'
);

select * from finish();
rollback;
