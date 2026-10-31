-- A closed month takes no change (spec §7, §8.3 "Reports"; Phase 7, task 3).
--
-- No expense, transfer, payment or manual sale dated in a closed month is
-- added, changed or voided, and none is moved into or out of one (ZL054
-- month_closed; the trigger private.finance_refuse_closed, so every writer
-- obeys it). A discount counts on its item's revenue day, so a discount on
-- an item whose revenue falls in a closed month is neither added, changed
-- nor voided. An override that takes an order completed in a closed month
-- out of completed is refused, since its revenue would leave that month.
-- Records in open months, and a payment dated today for an item whose
-- revenue is in a closed month, still go through. Account deletion still
-- blanks a customer's notes there (no amount moves). Orders with no revenue
-- (covered, or completed before the books) reopen freely, and a
-- subscription activated into a closed month (a close at midnight) is
-- refused like a completion.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(35);

select tests.create_user('+9647801111111');            -- customer
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;

create function tests.completed_order(p_on date)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := tests.create_order(
    tests.user_id('+9647801111111'), 'completed', p_on::timestamptz - interval '2 hours', tests.id('crew')
  );
begin
  insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, created_at)
  values (v_id, 'in_progress', 'completed', tests.user_id('+9647703333333'), 'crew',
    (p_on + time '12:00') at time zone 'Asia/Baghdad');
  return v_id;
end;
$$;

insert into tests.ids values
  ('old', tests.completed_order(tests.month(1) + 4)),
  ('new', tests.completed_order(tests.today())),
  ('covered', tests.completed_order(tests.month(1) + 5)),
  ('before_books', tests.completed_order(tests.month(3) + 5)),
  ('sub', tests.create_subscription(tests.user_id('+9647801111111'), 'requested'));
update public.orders set subscription_id = (
  select s.id from public.subscriptions as s where s.user_id = tests.user_id('+9647801111111') limit 1
) where id = tests.id('covered');

create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.bank() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'bank' order by created_at limit 1 $$;
create function tests.category() returns bigint language sql stable security definer
as $$ select id from public.expense_categories order by id limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Records last month and this month, while every month is open.
select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_expense(null, tests.month(1) + 2, tests.category(), tests.cash(), 5000, null) as old_expense \gset
select public.admin_save_expense(null, tests.today(), tests.category(), tests.cash(), 6000, null) as new_expense \gset
select public.admin_save_transfer(null, tests.month(1) + 3, tests.cash(), tests.bank(), 1000, null) as old_transfer \gset
select public.admin_save_payment(null, tests.id('old'), null, null, tests.month(1) + 5, tests.cash(), 10000, 'دفع') as old_payment \gset
select public.admin_save_discount(null, tests.id('old'), null, 2000, 'زبون دائم') as old_discount \gset
select public.admin_save_manual_sale(null, tests.month(1) + 6, 'موكب', null, 'تنظيف', null, 30000, null, null, tests.cash()) as old_sale \gset

-- Close the start month and last month.
select public.admin_close_finance_month(tests.month(2));
select public.admin_close_finance_month(tests.month(1));

-- Expenses -----------------------------------------------------------------------------------

select throws_ok(
  $$ select public.admin_save_expense(null, tests.month(1) + 8, tests.category(), tests.cash(), 5000, null) $$,
  'ZL054', 'month_closed', 'no new expense in a closed month'
);
select throws_ok(
  format($$ select public.admin_save_expense(%L, tests.month(1) + 2, tests.category(), tests.cash(), 7000, null) $$, :'old_expense'),
  'ZL054', 'month_closed', 'nor a change to one there'
);
select throws_ok(
  format($$ select public.admin_save_expense(%L, tests.month(1) + 2, tests.category(), tests.cash(), 5000, 'ملاحظة') $$, :'old_expense'),
  'ZL054', 'month_closed', 'not even its note'
);
select throws_ok(
  format($$ select public.admin_save_expense(%L, tests.today(), tests.category(), tests.cash(), 5000, null) $$, :'old_expense'),
  'ZL054', 'month_closed', 'nor moving one out of it'
);
select throws_ok(
  format($$ select public.admin_save_expense(%L, tests.month(1) + 2, tests.category(), tests.cash(), 6000, null) $$, :'new_expense'),
  'ZL054', 'month_closed', 'nor moving one into it'
);
select throws_ok(
  format($$ select public.admin_void_expense(%L, 'مكرر') $$, :'old_expense'),
  'ZL054', 'month_closed', 'nor voiding one there'
);
select lives_ok(
  format($$ select public.admin_save_expense(%L, tests.today(), tests.category(), tests.cash(), 6500, null) $$, :'new_expense'),
  'an expense this month still changes'
);

-- Transfers ----------------------------------------------------------------------------------

select throws_ok(
  $$ select public.admin_save_transfer(null, tests.month(2) + 1, tests.cash(), tests.bank(), 1000, null) $$,
  'ZL054', 'month_closed', 'no new transfer in a closed month'
);
select throws_ok(
  format($$ select public.admin_save_transfer(%L, tests.month(1) + 3, tests.cash(), tests.bank(), 2000, null) $$, :'old_transfer'),
  'ZL054', 'month_closed', 'nor a change to one there'
);
select throws_ok(
  format($$ select public.admin_void_transfer(%L, 'غلط') $$, :'old_transfer'),
  'ZL054', 'month_closed', 'nor voiding one there'
);

-- Payments -----------------------------------------------------------------------------------

select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('old'), null, null, tests.month(1) + 9, tests.cash(), 1000, null) $$,
  'ZL054', 'month_closed', 'no new payment dated in a closed month'
);
select throws_ok(
  format($$ select public.admin_save_payment(%L, null, null, null, tests.month(1) + 5, tests.cash(), 9000, 'دفع') $$, :'old_payment'),
  'ZL054', 'month_closed', 'nor a change to one there'
);
select throws_ok(
  format($$ select public.admin_void_payment(%L, 'غلط') $$, :'old_payment'),
  'ZL054', 'month_closed', 'nor voiding one there'
);
select lives_ok(
  $$ select public.admin_save_payment(null, tests.id('old'), null, null, tests.today(), tests.cash(), 3000, null) $$,
  'an item whose revenue is in a closed month is still paid today'
);

-- Discounts ----------------------------------------------------------------------------------

select throws_ok(
  format($$ select public.admin_save_discount(%L, null, null, 3000, 'زبون دائم') $$, :'old_discount'),
  'ZL054', 'month_closed', 'a discount on revenue in a closed month does not change'
);
select throws_ok(
  format($$ select public.admin_void_discount(%L, 'غلط') $$, :'old_discount'),
  'ZL054', 'month_closed', 'nor void'
);
select lives_ok(
  $$ select public.admin_save_discount(null, tests.id('new'), null, 1000, 'زبون دائم') $$,
  'a discount on revenue this month goes through'
);
-- Manual sales -------------------------------------------------------------------------------

select throws_ok(
  $$ select public.admin_save_manual_sale(null, tests.month(1) + 7, 'فندق', null, 'تنظيف', null, 9000, null, null, null) $$,
  'ZL054', 'month_closed', 'no new sale in a closed month'
);
select throws_ok(
  format($$ select public.admin_save_manual_sale(%L, tests.month(1) + 6, 'موكب', null, 'تنظيف', null, 35000, null, null, null) $$, :'old_sale'),
  'ZL054', 'month_closed', 'nor a change to one there'
);
select throws_ok(
  format($$ select public.admin_void_manual_sale(%L, 'مكرر') $$, :'old_sale'),
  'ZL054', 'month_closed', 'nor voiding one there'
);

-- Orders -------------------------------------------------------------------------------------

select throws_ok(
  format($$ select public.transition_order(%L, 'in_progress', '{"override": true, "reason": "رجعوا يكملون"}') $$, tests.id('old')),
  'ZL054', 'month_closed', 'an override does not take an order completed in a closed month out of completed'
);
select is(
  (select status::text from public.orders where id = tests.id('old')), 'completed', 'the order stays completed'
);
select lives_ok(
  format($$ select public.transition_order(%L, 'in_progress', '{"override": true, "reason": "رجعوا يكملون"}') $$, tests.id('new')),
  'an order completed this month still reopens'
);

-- Every writer obeys it ----------------------------------------------------------------------

select tests.clear_authentication();
select lives_ok(
  format($$ update public.orders set status = 'in_progress' where id = %L $$, tests.id('covered')),
  'a covered order completed in a closed month still reopens (it has no revenue)'
);
select lives_ok(
  format($$ update public.orders set status = 'in_progress' where id = %L $$, tests.id('before_books')),
  'and an order completed before the books'
);
select throws_ok(
  format(
    $$ update public.subscriptions set status = 'active', price_iqd = 70000, starts_on = %L, ends_on = %L,
         activated_at = %L where id = %L $$,
    tests.month(1) + 3, tests.month(1) + 300, ((tests.month(1) + 3) + time '12:00') at time zone 'Asia/Baghdad',
    tests.id('sub')
  ),
  'ZL054', 'month_closed', 'an activation landing in a closed month is refused (a close at midnight)'
);
select throws_ok(
  format($$ update public.expenses set amount_iqd = 1 where id = %L $$, :'old_expense'),
  'ZL054', 'month_closed', 'a direct change is refused too'
);
select throws_ok(
  $$ insert into public.finance_payments (paid_on, order_id, account_id, amount_iqd, created_by)
     values (tests.month(1) + 1, tests.id('old'), tests.cash(), 100, tests.user_id('+9647504444444')) $$,
  'ZL054', 'month_closed', 'and a direct insert'
);
select throws_ok(
  format($$ update public.finance_discounts set amount_iqd = 1 where id = %L $$, :'old_discount'),
  'ZL054', 'month_closed', 'and a direct change to a discount'
);
select lives_ok(
  format($$ update public.finance_payments set note = null where id = %L $$, :'old_payment'),
  'account deletion still blanks a note there'
);
select lives_ok(
  format($$ update public.finance_discounts set reason = null where id = %L $$, :'old_discount'),
  'and a discount reason'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_save_payment(%L, null, null, null, tests.month(1) + 5, tests.cash(), 10000, 'ملاحظة') $$, :'old_payment'),
  'ZL054', 'month_closed', 'but an admin cannot write a note there'
);

-- Reopened, the month takes changes again ----------------------------------------------------

select public.admin_reopen_finance_month(tests.month(1), 'مصروف ناقص');
select lives_ok(
  $$ select public.admin_save_expense(null, tests.month(1) + 8, tests.category(), tests.cash(), 5000, null) $$,
  'a reopened month takes a new expense'
);
select lives_ok(
  format($$ select public.admin_void_manual_sale(%L, 'مكرر') $$, :'old_sale'),
  'and a void'
);
select throws_ok(
  $$ select public.admin_save_expense(null, tests.month(2) + 8, tests.category(), tests.cash(), 5000, null) $$,
  'ZL054', 'month_closed', 'the month before it stays closed'
);

select * from finish();
rollback;
