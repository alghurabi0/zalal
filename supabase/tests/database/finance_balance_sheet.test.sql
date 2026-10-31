-- The books with partners, equipment and accrued wages (spec §7, §8.3 A20
-- and A22; Phase 7, task 5): admin_profit_and_loss,
-- admin_expenses_by_category, admin_partner_balances and
-- admin_balance_sheet, checked against a hand count of one small company.
--
-- Profit (accrual): revenue less the expenses counted that month (neither
-- a spread purchase nor a wage paid to a named worker), less the wages the
-- workers earned (admin_payroll), less the month's depreciation, plus what
-- disposals made above what was left (below: a loss). Cash: payments in,
-- refunds and every expense paid, by day.
--
-- admin_partner_balances(month): each partner's opening capital, capital
-- in, withdrawals, and profit share, each month's profit split by that
-- month's shares (rounded down, the dinars left to the largest remainders,
-- so the shares add up to the profit); a row with no partner holds the
-- profit of months with no shares.
--
-- admin_balance_sheet(month), at the month's end or today: assets (boxes,
-- crew cash, what customers owe, workers' advances, equipment left) =
-- liabilities (customer credit, wages owed) + equity (partners, profit not
-- yet shared, and the opening balances no partner holds), each side from
-- its own records, with balanced saying they agree. A month between the
-- books' start and this one (22023 invalid_date). Admins only (42501).
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(17);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;
update public.finance_accounts set opening_balance_iqd = 0 where true;
insert into public.finance_accounts (kind, name, opening_balance_iqd) values ('cash', 'قاصة', 1000000);
insert into public.expense_categories (name, kind) values
  ('عام اختبار', 'general'), ('أجور اختبار', 'wages'), ('معدات اختبار', 'equipment');
insert into public.partners (name, opening_capital_iqd) values ('أبو علي', 600000), ('أبو حسن', 400000);
insert into public.workers (name, opening_balance_iqd) values ('كرار', 20000), ('سجاد', -5000);
insert into tests.ids
select name, id from public.partners
union all select name, id from public.workers
union all select 'cash', id from public.finance_accounts where name = 'قاصة'
union all select 'crew box', id from public.finance_accounts where crew_id = tests.id('crew');

insert into tests.ids values ('ahead', tests.create_order(tests.user_id('+9647801111111'), 'confirmed'));

create function tests.category(p_name text) returns bigint language sql stable security definer
as $$ select id from public.expense_categories where name = p_name $$;
grant execute on all functions in schema tests to anon, authenticated;

-- The company's books ------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
-- Month −2: a sale paid at once, a general expense, the opening equipment starts.
select public.admin_save_manual_sale(null, tests.month(2) + 3, 'موكب', null, 'تنظيف', null, 100000, null, null, tests.id('cash'));
select public.admin_save_expense(null, tests.month(2) + 4, tests.category('عام اختبار'), tests.id('cash'), 15000, null);
select public.admin_save_opening_equipment(null, 'سيارة', 24000, 12, null) as car \gset
-- Month −1: a sale on credit, wages earned and paid, casual labour, a pump, capital, cash to the crew.
select public.admin_save_manual_sale(null, tests.month(1) + 2, 'فندق', null, 'تنظيف', null, 80000, null, null, null);
select public.admin_save_worker_rate(null, tests.id('كرار'), tests.month(2), 'per_day', 10000);
select public.admin_set_worker_days(tests.id('كرار'), tests.month(1), array[tests.month(1) + 1, tests.month(1) + 2, tests.month(1) + 3]);
select public.admin_save_expense(null, tests.month(1) + 5, tests.category('أجور اختبار'), tests.id('cash'), 25000, null, tests.id('كرار'));
select public.admin_save_expense(null, tests.month(1) + 5, tests.category('أجور اختبار'), tests.id('cash'), 7000, 'عامل يومي');
select public.admin_save_expense(null, tests.month(1) + 6, tests.category('معدات اختبار'), tests.id('cash'), 60000, 'مضخة', null, 3);
select public.admin_save_partner_movement(null, tests.id('أبو حسن'), tests.month(1) + 7, 'capital', tests.id('cash'), 50000, null);
select public.admin_save_transfer(null, tests.month(1) + 8, tests.id('cash'), tests.id('crew box'), 10000, null);
select public.admin_set_partner_shares(tests.month(1), jsonb_build_object(tests.id('أبو علي'), 6667, tests.id('أبو حسن'), 3333));
-- This month: a day worked, the car sold, a customer pays ahead, a withdrawal.
select public.admin_set_worker_days(tests.id('كرار'), tests.month(0), array[tests.month(0)]);
select public.admin_save_equipment_disposal(null, null, :'car', tests.month(0), tests.id('cash'), 24000, null);
select public.admin_save_payment(null, tests.id('ahead'), null, null, tests.month(0), tests.id('cash'), 15000, null);
select public.admin_save_partner_movement(null, tests.id('أبو علي'), tests.month(0), 'withdrawal', tests.id('cash'), 30000, null);

-- Profit and loss ----------------------------------------------------------------------------

select results_eq(
  $$ select month, revenue_iqd, spent_iqd, wages_iqd, depreciation_iqd, expenses_iqd, equipment_result_iqd, profit_iqd,
       received_iqd, paid_out_iqd, net_cash_iqd
     from public.admin_profit_and_loss(tests.month(2), tests.today()) $$,
  $$ values
       (tests.month(2), 100000::bigint, 15000::bigint, 0::bigint, 2000::bigint, 17000::bigint, 0::bigint, 83000::bigint,
        100000::bigint, 15000::bigint, 85000::bigint),
       (tests.month(1), 80000::bigint, 7000::bigint, 30000::bigint, 22000::bigint, 59000::bigint, 0::bigint, 21000::bigint,
        0::bigint, 92000::bigint, -92000::bigint),
       (tests.month(0), 0::bigint, 0::bigint, 10000::bigint, 20000::bigint, 30000::bigint, 4000::bigint, -26000::bigint,
        15000::bigint, 0::bigint, 15000::bigint) $$,
  'profit: wages as earned, purchases spread, the car sold 4,000 above what was left; cash: every expense as paid'
);
select results_eq(
  $$ select month, category_id, total_iqd, counted_iqd
     from public.admin_expenses_by_category(tests.month(2), tests.today())
     where category_id in (tests.category('عام اختبار'), tests.category('أجور اختبار'), tests.category('معدات اختبار')) $$,
  $$ values
       (tests.month(2), tests.category('عام اختبار'), 15000::bigint, 15000::bigint),
       (tests.month(1), tests.category('أجور اختبار'), 32000::bigint, 7000::bigint),
       (tests.month(1), tests.category('معدات اختبار'), 60000::bigint, 0::bigint) $$,
  'by category: all that was spent, and the part the profit counts'
);

-- Partners -----------------------------------------------------------------------------------

select results_eq(
  $$ select share_bp, opening_iqd, capital_iqd, withdrawn_iqd, profit_month_iqd, profit_iqd, balance_iqd
     from public.admin_partner_balances(tests.today())
     order by coalesce(partner_id = tests.id('أبو علي'), false) desc, coalesce(partner_id = tests.id('أبو حسن'), false) desc $$,
  $$ values
       (6667, 600000::bigint, 0::bigint, 30000::bigint, -17334::bigint, -3333::bigint, 566667::bigint),
       (3333, 400000::bigint, 50000::bigint, 0::bigint, -8666::bigint, -1667::bigint, 448333::bigint),
       (null::int, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 83000::bigint, 83000::bigint) $$,
  'each month split by its shares, the dinar left to the largest remainder; month −2 had no shares'
);
select results_eq(
  $$ select profit_month_iqd, balance_iqd from public.admin_partner_balances(tests.month(1))
     order by coalesce(partner_id = tests.id('أبو علي'), false) desc, coalesce(partner_id = tests.id('أبو حسن'), false) desc $$,
  $$ values (14001::bigint, 614001::bigint), (6999::bigint, 456999::bigint), (0::bigint, 83000::bigint) $$,
  'a past month: the balances at its end'
);

-- Balance sheet ------------------------------------------------------------------------------

select results_eq(
  $$ select as_of, boxes_iqd, crew_cash_iqd, receivables_iqd, advances_iqd, equipment_iqd, assets_iqd,
       customer_credit_iqd, wages_owed_iqd, liabilities_iqd,
       partners_iqd, unallocated_profit_iqd, opening_difference_iqd, equity_iqd, balanced
     from public.admin_balance_sheet(tests.today()) $$,
  $$ values (tests.today(), 1042000::bigint, 10000::bigint, 80000::bigint, 5000::bigint, 20000::bigint, 1157000::bigint,
       15000::bigint, 35000::bigint, 50000::bigint,
       1015000::bigint, 83000::bigint, 9000::bigint, 1107000::bigint, true) $$,
  'today: assets = liabilities + equity, each from its own records'
);
select results_eq(
  $$ select as_of, boxes_iqd, crew_cash_iqd, receivables_iqd, advances_iqd, equipment_iqd, assets_iqd,
       customer_credit_iqd, wages_owed_iqd, liabilities_iqd,
       partners_iqd, unallocated_profit_iqd, opening_difference_iqd, equity_iqd, balanced
     from public.admin_balance_sheet(tests.month(1)) $$,
  $$ values ((tests.month(0) - 1), 1033000::bigint, 10000::bigint, 80000::bigint, 5000::bigint, 60000::bigint, 1188000::bigint,
       0::bigint, 25000::bigint, 25000::bigint,
       1071000::bigint, 83000::bigint, 9000::bigint, 1163000::bigint, true) $$,
  'a past month''s end balances too'
);
select is(
  (select boxes_iqd + crew_cash_iqd from public.admin_balance_sheet(tests.today())),
  (select sum(balance_iqd)::bigint from public.finance_account_balances),
  'today''s boxes are A15''s balances'
);
select is(
  (select bool_and(balanced) from (
    select (public.admin_balance_sheet(tests.month(n))).balanced from generate_series(0, 2) as n
  ) as x),
  true, 'every month of the books balances'
);
select throws_ok(
  $$ select * from public.admin_balance_sheet(tests.month(3)) $$,
  '22023', 'invalid_date', 'no balance sheet before the books'
);
select throws_ok(
  $$ select * from public.admin_balance_sheet((tests.month(0) + interval '1 month')::date) $$,
  '22023', 'invalid_date', 'nor after this month'
);
select throws_ok(
  $$ select * from public.admin_partner_balances(null) $$,
  '22023', 'invalid_date', 'partner balances need a month'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.admin_balance_sheet(current_date) $$, '42501', null, 'a guest cannot read the balance sheet');
select throws_ok($$ select * from public.admin_partner_balances(current_date) $$, '42501', null, 'nor partner balances');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok($$ select * from public.admin_balance_sheet(current_date) $$, '42501', 'not_allowed', 'nor can a customer');
select throws_ok($$ select * from public.admin_partner_balances(current_date) $$, '42501', 'not_allowed', 'or see partner balances');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok($$ select * from public.admin_balance_sheet(current_date) $$, '42501', 'not_allowed', 'nor can a crew');
select throws_ok($$ select * from public.admin_partner_balances(current_date) $$, '42501', 'not_allowed', 'or see partner balances');

select * from finish();
rollback;
