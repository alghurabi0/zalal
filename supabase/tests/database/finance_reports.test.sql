-- orders.completed_on, admin_profit_and_loss and admin_expenses_by_category
-- (spec §7, §8.3 "Reports"; Phase 7, task 3).
--
-- orders.completed_on is the Baghdad day of the order's last completion
-- while it is completed, null otherwise: kept by triggers on order_events
-- and orders, so the books don't look up the events per order.
--
-- admin_profit_and_loss(from, to): one row per month from from's month to
-- to's (at most 24; 22023 invalid_date otherwise). Accrual: the revenue of
-- the items in the books by revenue day (orders, subscriptions, manual
-- sales), less their discounts, less the month's expenses = profit. Cash:
-- payments in and refunds out by payment day, less expenses = net cash.
-- Voided records count nowhere. closed says whether the month is closed.
-- admin_expenses_by_category(from, to): each month's live expenses by
-- category. Both admins only (42501).
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(21);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;

create function tests.completed_order(p_customer uuid, p_on date, p_total int)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := tests.create_order(p_customer, 'completed', p_on::timestamptz - interval '2 hours', tests.id('crew'));
begin
  update public.orders set total_iqd = p_total where id = v_id;
  insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, created_at)
  values (v_id, 'in_progress', 'completed', tests.user_id('+9647703333333'), 'crew',
    (p_on + time '12:00') at time zone 'Asia/Baghdad');
  return v_id;
end;
$$;

insert into tests.ids values
  ('last', tests.completed_order(tests.user_id('+9647801111111'), tests.month(1) + 3, 40000)),
  ('this', tests.completed_order(tests.user_id('+9647801111111'), tests.today(), 25000)),
  ('before', tests.completed_order(tests.user_id('+9647801111111'), tests.month(3) + 3, 50000)),
  ('sub', tests.create_subscription(tests.user_id('+9647802222222')));
update public.subscriptions
set price_iqd = 70000, activated_at = ((tests.month(1) + 10) + time '12:00') at time zone 'Asia/Baghdad'
where id = tests.id('sub');
insert into tests.ids values
  ('covered', tests.completed_order(tests.user_id('+9647802222222'), tests.month(1) + 12, 30000));
update public.orders set subscription_id = tests.id('sub') where id = tests.id('covered');

create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.category(n int) returns bigint language sql stable security definer
as $$ select id from public.expense_categories order by id offset n limit 1 $$;
create function tests.completed_on(p_id uuid) returns date language sql stable security definer
as $$ select completed_on from public.orders where id = p_id $$;
grant execute on all functions in schema tests to anon, authenticated;

-- orders.completed_on --------------------------------------------------------------------------

select is(tests.completed_on(tests.id('last')), tests.month(1) + 3, 'completed_on is the completion day in Baghdad');
select is(
  tests.completed_on(tests.create_order(tests.user_id('+9647801111111'), 'confirmed')), null,
  'an order not completed has none'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.transition_order(tests.id('this'), 'in_progress', '{"override": true, "reason": "رجعوا يكملون"}');
select is(tests.completed_on(tests.id('this')), null, 'leaving completed clears it');
select public.transition_order(tests.id('this'), 'completed', '{"override": true, "reason": "خلصوا", "sterilant": "كلور"}');
select is(tests.completed_on(tests.id('this')), tests.today(), 'completing again sets the new day');
select is(
  (select revenue_on from public.finance_receivables where order_id = tests.id('last')), tests.month(1) + 3,
  'finance_receivables reads it'
);

-- Records ------------------------------------------------------------------------------------

select public.admin_save_discount(null, tests.id('last'), null, 5000, 'زبون دائم');
select public.admin_save_payment(null, tests.id('last'), null, null, tests.month(1) + 4, tests.cash(), 30000, null);
select public.admin_save_payment(null, tests.id('last'), null, null, tests.month(1) + 20, tests.cash(), -10000, 'استرجاع');
select public.admin_save_payment(null, null, tests.id('sub'), null, tests.today(), tests.cash(), 70000, null);
select public.admin_save_manual_sale(null, tests.month(1) + 6, 'موكب', null, 'تنظيف', null, 35000, null, null, tests.cash());
select public.admin_save_manual_sale(null, tests.month(1) + 7, 'فندق', null, 'تنظيف', null, 99000, null, null, tests.cash()) as voided_sale \gset
select public.admin_void_manual_sale(:'voided_sale', 'مكرر');
select public.admin_save_expense(null, tests.month(1) + 1, tests.category(0), tests.cash(), 5000, null);
select public.admin_save_expense(null, tests.month(1) + 2, tests.category(1), tests.cash(), 3000, null);
select public.admin_save_expense(null, tests.month(1) + 2, tests.category(1), tests.cash(), 9999, null) as voided_expense \gset
select public.admin_void_expense(:'voided_expense', 'مكرر');
select public.admin_save_expense(null, tests.today(), tests.category(0), tests.cash(), 4000, null);
select public.admin_close_finance_month(tests.month(2));

-- Profit and loss ----------------------------------------------------------------------------

select results_eq(
  $$ select month, orders_iqd, subscriptions_iqd, sales_iqd, discounts_iqd, revenue_iqd, expenses_iqd, profit_iqd,
       received_iqd, refunded_iqd, net_cash_iqd, closed
     from public.admin_profit_and_loss(tests.month(2), tests.today()) $$,
  $$ values
       (tests.month(2), 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
        0::bigint, 0::bigint, 0::bigint, true),
       (tests.month(1), 40000::bigint, 70000::bigint, 35000::bigint, 5000::bigint, 140000::bigint, 8000::bigint,
        132000::bigint, 65000::bigint, 10000::bigint, 47000::bigint, false),
       (tests.month(0), 25000::bigint, 0::bigint, 0::bigint, 0::bigint, 25000::bigint, 4000::bigint, 21000::bigint,
        70000::bigint, 0::bigint, 66000::bigint, false) $$,
  'each month: revenue by revenue day less discounts and expenses; money in and out by day; voided records left out'
);
select is(
  (select count(*)::int from public.admin_profit_and_loss(tests.month(1) + 15, tests.month(1) + 16)),
  1, 'any days name their months'
);
select is(
  (select orders_iqd from public.admin_profit_and_loss(tests.month(3), tests.month(3))),
  0::bigint, 'an order completed before the books is not revenue'
);
select throws_ok(
  $$ select * from public.admin_profit_and_loss(tests.today(), tests.month(1)) $$,
  '22023', 'invalid_date', 'the range runs forward'
);
select throws_ok(
  $$ select * from public.admin_profit_and_loss(tests.month(24), tests.today()) $$,
  '22023', 'invalid_date', 'and covers at most 24 months'
);
select throws_ok(
  $$ select * from public.admin_profit_and_loss(null, tests.today()) $$,
  '22023', 'invalid_date', 'both ends are required'
);

-- Expenses by category -----------------------------------------------------------------------

select results_eq(
  $$ select month, category_id, total_iqd from public.admin_expenses_by_category(tests.month(2), tests.today()) $$,
  $$ values
       (tests.month(1), tests.category(0), 5000::bigint),
       (tests.month(1), tests.category(1), 3000::bigint),
       (tests.month(0), tests.category(0), 4000::bigint) $$,
  'each month''s live expenses by category'
);
select throws_ok(
  $$ select * from public.admin_expenses_by_category(tests.today(), tests.month(1)) $$,
  '22023', 'invalid_date', 'its range runs forward too'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.admin_profit_and_loss(tests.month(1), tests.today()) $$,
  '42501', null, 'a guest cannot read the profit and loss'
);
select throws_ok(
  $$ select * from public.admin_expenses_by_category(tests.month(1), tests.today()) $$,
  '42501', null, 'nor the expenses by category'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select * from public.admin_profit_and_loss(tests.month(1), tests.today()) $$,
  '42501', 'not_allowed', 'nor a customer'
);
select throws_ok(
  $$ select * from public.admin_expenses_by_category(tests.month(1), tests.today()) $$,
  '42501', 'not_allowed', 'nor a customer by category'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select * from public.admin_profit_and_loss(tests.month(1), tests.today()) $$,
  '42501', 'not_allowed', 'nor another customer'
);
select throws_ok(
  $$ select * from public.admin_expenses_by_category(tests.month(1), tests.today()) $$,
  '42501', 'not_allowed', 'nor another customer by category'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select * from public.admin_profit_and_loss(tests.month(1), tests.today()) $$,
  '42501', 'not_allowed', 'nor a crew'
);
select throws_ok(
  $$ select * from public.admin_expenses_by_category(tests.month(1), tests.today()) $$,
  '42501', 'not_allowed', 'nor a crew by category'
);

select * from finish();
rollback;
