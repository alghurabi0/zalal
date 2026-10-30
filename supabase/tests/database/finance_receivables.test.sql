-- finance_receivables (spec §7, §8.3 "Revenue and debts"; Phase 7, task 2):
-- one row per item in the books, for the revenue tab, the A2 card and task
-- 3's reports.
--
-- An order is revenue on its completion day (the last move to completed, in
-- Baghdad) when it is completed, not covered and completed on or after the
-- start day. A subscription is revenue on its activation day (on or after
-- the start), even once cancelled. A live manual sale on its day. An order
-- that isn't in the books but holds live payments is listed too, with no
-- amount, so its payments show as credit. amount_iqd and discount_iqd are 0
-- for an item not in the books; balance = amount − discount − paid (above
-- 0 the customer owes, below 0 credit). Voided records count nowhere.
--
-- Admins read it; guests none (no grant), customers and crews no rows. The
-- same for finance_customer_balances (each customer's items added up, each
-- sale alone) and admin_revenue_summary(from, to) (42501 otherwise).
--
-- Account deletion blanks the notes of the customer's payments and the
-- reasons of their discounts, and the note and reason in those audit rows.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(26);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));
update public.profiles set full_name = 'زبون أ' where id = tests.user_id('+9647801111111');

update public.finance_settings as s set start_on = tests.today() - 30 where s.id;

create function tests.completed_order(p_customer uuid, p_days int)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := tests.create_order(p_customer, 'completed', now() - make_interval(days => p_days), tests.id('crew'));
begin
  insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, created_at)
  values (v_id, 'in_progress', 'completed', tests.user_id('+9647703333333'), 'crew',
    now() - make_interval(days => p_days));
  return v_id;
end;
$$;

insert into tests.ids values
  ('done', tests.completed_order(tests.user_id('+9647801111111'), 3)),
  ('old', tests.completed_order(tests.user_id('+9647801111111'), 40)),
  ('open', tests.create_order(tests.user_id('+9647801111111'), 'confirmed')),
  ('unpaid_open', tests.create_order(tests.user_id('+9647801111111'), 'confirmed')),
  ('sub', tests.create_subscription(tests.user_id('+9647802222222'))),
  ('requested', tests.create_subscription(
    tests.user_id('+9647801111111'), 'requested', tests.today(), 2, 1,
    tests.create_address(tests.user_id('+9647801111111'), 'work')
  ));
insert into tests.ids values ('covered', tests.completed_order(tests.user_id('+9647802222222'), 1));
update public.orders set subscription_id = tests.id('sub') where id = tests.id('covered');
-- Completed twice: the last completion counts.
insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, is_override, created_at)
values
  (tests.id('done'), 'completed', 'in_progress', tests.user_id('+9647504444444'), 'admin', true, now() - interval '3 days'),
  (tests.id('done'), 'in_progress', 'completed', tests.user_id('+9647504444444'), 'admin', true, now() - interval '2 days');

create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_payment(null, tests.id('done'), null, null, tests.today(), tests.cash(), 20000, 'دفع نص');
select public.admin_save_discount(null, tests.id('done'), null, 5000, 'زبون دائم');
select public.admin_save_payment(null, tests.id('open'), null, null, tests.today(), tests.cash(), 35000, null);
select public.admin_save_payment(null, null, tests.id('sub'), null, tests.today(), tests.cash(), 70000, null);
select public.admin_save_manual_sale(null, tests.today(), 'موكب', '+9647709999999', 'تنظيف', null, 90000, null, null, null) as sale \gset
select public.admin_save_manual_sale(null, tests.today(), 'فندق', null, 'تنظيف', null, 10000, null, null, null) as voided \gset
select public.admin_void_manual_sale(:'voided', 'مكرر');

-- Reads --------------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.finance_receivables $$, '42501', null, 'a guest cannot read it');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.finance_receivables $$, 'a customer reads no rows, not even their own orders');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.finance_receivables $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.finance_receivables $$, 'nor a crew');

-- Rows ---------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select results_eq(
  $$ select kind, revenue_on, counted, customer_name, crew_id, total_iqd, amount_iqd, discount_iqd, paid_iqd::int, balance_iqd::int
     from public.finance_receivables where order_id = tests.id('done') $$,
  $$ values ('order'::text, tests.today() - 2, true, 'زبون أ'::text, tests.id('crew'), 35000, 35000, 5000, 20000, 10000) $$,
  'a completed order is revenue on its last completion day, owing amount − discount − paid'
);
select is_empty(
  $$ select 1 from public.finance_receivables where order_id in (tests.id('old'), tests.id('covered'), tests.id('unpaid_open')) $$,
  'an order completed before the start, a covered one and an open unpaid one are not listed'
);
select results_eq(
  $$ select revenue_on, counted, amount_iqd, paid_iqd::int, balance_iqd::int
     from public.finance_receivables where order_id = tests.id('open') $$,
  $$ values (null::date, false, 0, 35000, -35000) $$,
  'an order paid ahead shows its payment as credit'
);
select results_eq(
  $$ select kind, revenue_on, customer_id, amount_iqd, balance_iqd::int
     from public.finance_receivables where subscription_id = tests.id('sub') $$,
  $$ values ('subscription'::text, tests.today(), tests.user_id('+9647802222222'), 60000, -10000) $$,
  'a subscription is revenue on its activation day; paying more is credit'
);
select is_empty(
  $$ select 1 from public.finance_receivables where subscription_id = tests.id('requested') $$,
  'a request is not'
);
select results_eq(
  format(
    $$ select kind, revenue_on, customer_name, customer_phone, service, amount_iqd, balance_iqd::int
       from public.finance_receivables where sale_id = %L $$,
    :'sale'
  ),
  $$ values ('sale'::text, tests.today(), 'موكب'::text, '+9647709999999'::text, 'تنظيف'::text, 90000, 90000) $$,
  'a manual sale is revenue on its day'
);
select is_empty(
  format($$ select 1 from public.finance_receivables where sale_id = %L $$, :'voided'),
  'a voided one is not'
);

-- A cancelled subscription stays revenue.
select tests.clear_authentication();
update public.subscriptions set status = 'cancelled', ended_at = now() where id = tests.id('sub');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is(
  (select amount_iqd from public.finance_receivables where subscription_id = tests.id('sub')),
  60000, 'a cancelled subscription stays revenue'
);

-- An override out of completed leaves the payment as credit, and the discount out.
select public.transition_order(tests.id('done'), 'in_progress', '{"override": true, "reason": "رجعوا"}');
select results_eq(
  $$ select counted, amount_iqd, discount_iqd, paid_iqd::int, balance_iqd::int
     from public.finance_receivables where order_id = tests.id('done') $$,
  $$ values (false, 0, 0, 20000, -20000) $$,
  'an order taken out of completed keeps its payments as credit'
);
select public.transition_order(tests.id('done'), 'completed', '{"override": true, "reason": "خلص"}');
select is(
  (select revenue_on from public.finance_receivables where order_id = tests.id('done')),
  tests.today(), 'and completing it again moves its revenue day'
);

-- The start day moves later: the order completed before it drops out.
select public.admin_update_finance_settings(tests.today() - 1);
select is(
  (select count(*)::int from public.finance_receivables where kind = 'order' and counted),
  1, 'only orders completed on or after the start day count'
);

-- Per customer and the summary -----------------------------------------------------------

select results_eq(
  $$ select kind, customer_name, items, balance_iqd::int from public.finance_customer_balances
     order by balance_iqd $$,
  $$ values ('customer'::text, 'زبون أ'::text, 2, -25000), ('customer', null, 1, -10000), ('sale', 'موكب', 1, 90000) $$,
  'finance_customer_balances adds up each customer''s items, and lists each sale alone'
);
select results_eq(
  $$ select revenue_iqd::int, discounts_iqd::int, owed_iqd::int, credit_iqd::int, received_iqd::int
     from public.admin_revenue_summary(tests.today(), tests.today()) $$,
  $$ values (185000, 5000, 90000, 35000, 125000) $$,
  'admin_revenue_summary: the period''s revenue, discounts and money in, and what is owed and held as credit'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.finance_customer_balances $$, 'a customer reads no balances');
select throws_ok(
  $$ select * from public.admin_revenue_summary(current_date, current_date) $$,
  '42501', 'not_allowed', 'nor the summary'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select * from public.admin_revenue_summary(current_date, current_date) $$,
  '42501', 'not_allowed', 'nor does a crew'
);
select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.admin_revenue_summary(current_date, current_date) $$,
  '42501', null, 'nor a guest'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));

-- Account deletion ---------------------------------------------------------------------------

select public.admin_save_payment(null, null, tests.id('sub'), null, tests.today(), tests.cash(), -5000, 'رجعنا لأبو علي');
select public.admin_save_discount(null, null, tests.id('sub'), 1000, 'أبو علي جارنا');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select public.delete_account();
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is_empty(
  $$ select 1 from public.finance_payments where subscription_id = tests.id('sub') and note is not null $$,
  'deleting the account blanks its payments'' notes'
);
select is_empty(
  $$ select 1 from public.finance_discounts where subscription_id = tests.id('sub') and reason is not null $$,
  'and its discounts'' reasons'
);
select is_empty(
  $$ select 1 from public.admin_audit_log as l
     where l.entity in ('finance_payments', 'finance_discounts')
       and (l.diff ->> 'note' like '%أبو علي%' or l.diff ->> 'reason' like '%أبو علي%') $$,
  'and the free text in their audit rows'
);
select is(
  (select count(*)::int from public.finance_payments where order_id = tests.id('done') and note = 'دفع نص'),
  1, 'another customer''s notes stay'
);
select is(
  (select amount_iqd from public.finance_receivables where subscription_id = tests.id('sub')),
  60000, 'and the money records stay'
);

select * from finish();
rollback;
