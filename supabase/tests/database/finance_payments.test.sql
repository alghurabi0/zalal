-- finance_payments, admin_save_payment and admin_void_payment (spec §7, §8.3
-- "Revenue and debts"; Phase 7, task 2).
--
-- Admins read every payment, voided ones too; guests, customers (even of
-- their own orders) and crews none. Nobody writes the table directly.
--
-- A payment belongs to exactly one order, subscription or manual sale. A
-- negative amount is a refund; an item's live payments never total below
-- zero (ZL050 refund_too_large, also when a void would leave the refunds
-- ahead). The day and box rules are the expenses' (ZL042, ZL043, ZL044).
-- A covered order, an order completed before the books' start day and a
-- subscription activated before it take no payment (ZL049
-- payment_not_allowed); an order not yet completed may be paid ahead. A
-- voided sale takes none (ZL047). An edit keeps the target (22023
-- invalid_target). Logs payment.create / payment.update / payment.void.
--
-- A subscription in the books (activated on or after the start day) is
-- "paid" exactly while its payments cover its price less its discount, both
-- ways, logged as subscription.paid; A7's switch refuses it (ZL053
-- paid_set_by_finance) and still works for one activated before the start.
-- The boxes' balances include the live payments.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(57);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.today() - 30 where s.id;
insert into public.finance_accounts (kind, name, active) values ('bank', 'مصرف مطفأ', false);

-- A completed order: its completion event p_days ago (no cash ticked, so no
-- automatic payment).
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
  ('done', tests.completed_order(tests.user_id('+9647801111111'), 1)),
  ('old', tests.completed_order(tests.user_id('+9647801111111'), 40)),
  ('open', tests.create_order(tests.user_id('+9647801111111'), 'confirmed')),
  ('sub', tests.create_subscription(tests.user_id('+9647802222222'))),
  ('old_sub', tests.create_subscription(
    tests.user_id('+9647801111111'), 'active', tests.today() - 40, 2, 1,
    tests.create_address(tests.user_id('+9647801111111'), 'work')
  ));
update public.subscriptions set activated_at = now() - interval '40 days' where id = tests.id('old_sub');
insert into tests.ids values ('covered', tests.completed_order(tests.user_id('+9647802222222'), 1));
update public.orders set subscription_id = tests.id('sub') where id = tests.id('covered');

insert into public.manual_sales (sold_on, customer_name, service, amount_iqd, created_by)
values (tests.today(), 'موكب أبو الفضل', 'تنظيف خزانات', 150000, tests.user_id('+9647504444444'));
insert into public.manual_sales (sold_on, customer_name, service, amount_iqd, created_by, voided_at, voided_by, void_reason)
values (tests.today(), 'فندق', 'تنظيف', 90000, tests.user_id('+9647504444444'), now(), tests.user_id('+9647504444444'), 'مكرر');

create function tests.sale(p_name text) returns uuid language sql stable security definer
as $$ select id from public.manual_sales where customer_name = p_name $$;
create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.box(p_name text) returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where name = p_name $$;
create function tests.crew_box() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where crew_id = tests.id('crew') $$;
create function tests.payment(p_id uuid) returns public.finance_payments language sql stable security definer
as $$ select * from public.finance_payments where id = p_id $$;
create function tests.paid(p_id uuid) returns boolean language sql stable security definer
as $$ select paid from public.subscriptions where id = p_id $$;
create function tests.balance(p_account uuid) returns int language sql stable security definer
as $$ select balance_iqd::int from public.finance_account_balances where account_id = p_account $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
create function tests.audit_count(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.finance_payments'::regclass),
  'RLS is on for finance_payments'
);
select throws_ok(
  $$ insert into public.finance_payments (paid_on, order_id, account_id, amount_iqd, created_by)
     values (current_date, tests.id('done'), tests.cash(), 0, tests.user_id('+9647504444444')) $$,
  '23514', null, 'an amount is never zero'
);
select throws_ok(
  $$ insert into public.finance_payments (paid_on, order_id, sale_id, account_id, amount_iqd, created_by)
     values (current_date, tests.id('done'), tests.sale('موكب أبو الفضل'), tests.cash(), 1000, tests.user_id('+9647504444444')) $$,
  '23514', null, 'a payment belongs to exactly one item'
);
select throws_ok(
  $$ insert into public.finance_payments (paid_on, sale_id, account_id, amount_iqd, automatic, created_by)
     values (current_date, tests.sale('موكب أبو الفضل'), tests.cash(), 1000, true, tests.user_id('+9647504444444')) $$,
  '23514', null, 'only an order has an automatic payment'
);

insert into public.finance_payments (paid_on, order_id, account_id, amount_iqd, note, created_by)
values (tests.today(), tests.id('done'), tests.crew_box(), 5000, 'دفعة أولى', tests.user_id('+9647504444444'));

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.finance_payments $$, '42501', null, 'a guest cannot read payments');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.finance_payments $$, 'a customer reads none, not even of their own order');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.finance_payments $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.finance_payments $$, 'nor a crew, not even one into its box');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.finance_payments), 1, 'an admin reads them');
select throws_ok(
  $$ update public.finance_payments set amount_iqd = 1 where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('done'), null, null, current_date, tests.cash(), 5000, null) $$,
  '42501', null, 'a guest cannot record a payment'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('done'), null, null, current_date, tests.cash(), 5000, null) $$,
  '42501', 'not_allowed', 'nor a customer, for their own order'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('done'), null, null, current_date, tests.crew_box(), 5000, null) $$,
  '42501', 'not_allowed', 'nor a crew, into its own box'
);
select throws_ok(
  $$ select public.admin_void_payment((select id from public.finance_payments limit 1), 'غلط') $$,
  '42501', 'not_allowed', 'and a crew cannot void one'
);

-- Save ---------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_payment(
  null, tests.id('done'), null, null, tests.today(), tests.cash(), 20000, '  الباقي  '
) as pay \gset
select is((tests.payment(:'pay')).note, 'الباقي', 'an admin records a payment on an order, note trimmed');
select is((tests.payment(:'pay')).automatic, false, 'which is not automatic');
select is(
  tests.last_diff('payment.create'),
  jsonb_build_object(
    'order_id', tests.id('done'), 'subscription_id', null, 'sale_id', null,
    'paid_on', tests.today(), 'account_id', tests.cash(), 'amount_iqd', 20000, 'note', 'الباقي'
  ),
  'logged as payment.create'
);
select is(tests.balance(tests.cash()), 20000, 'the box balance includes it');
select is(tests.balance(tests.crew_box()), 5000, 'and the crew box its own');
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('covered'), null, null, tests.today(), tests.cash(), 5000, null) $$,
  'ZL049', 'payment_not_allowed', 'a covered order takes no payment'
);
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('old'), null, null, tests.today(), tests.cash(), 5000, null) $$,
  'ZL049', 'payment_not_allowed', 'nor an order completed before the books start'
);
select throws_ok(
  $$ select public.admin_save_payment(null, null, tests.id('old_sub'), null, tests.today(), tests.cash(), 5000, null) $$,
  'ZL049', 'payment_not_allowed', 'nor a subscription activated before the books start'
);
select lives_ok(
  $$ select public.admin_save_payment(null, tests.id('open'), null, null, tests.today(), tests.box('زين كاش'), 35000, null) $$,
  'an order not yet completed may be paid ahead'
);
select lives_ok(
  $$ select public.admin_save_payment(null, null, null, tests.sale('موكب أبو الفضل'), tests.today(), tests.cash(), 100000, null) $$,
  'a manual sale takes payments'
);
select throws_ok(
  $$ select public.admin_save_payment(null, null, null, tests.sale('فندق'), tests.today(), tests.cash(), 1000, null) $$,
  'ZL047', 'record_voided', 'but not a voided one'
);
select throws_ok(
  $$ select public.admin_save_payment(null, null, null, null, tests.today(), tests.cash(), 1000, null) $$,
  '22023', 'invalid_target', 'a payment needs an item'
);
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('done'), tests.id('sub'), null, tests.today(), tests.cash(), 1000, null) $$,
  '22023', 'invalid_target', 'and only one'
);
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('done'), null, null, tests.today(), tests.cash(), 0, null) $$,
  '22023', 'invalid_amount', 'an amount is never zero'
);
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('done'), null, null, tests.today(), tests.cash(), -1000000001, null) $$,
  '22023', 'invalid_amount', 'and at most a billion either way'
);
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('done'), null, null, tests.today() + 1, tests.cash(), 1000, null) $$,
  'ZL043', 'date_in_future', 'a day after today is refused'
);
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('done'), null, null, tests.today() - 31, tests.cash(), 1000, null) $$,
  'ZL042', 'before_finance_start', 'so is a day before the books start'
);
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('done'), null, null, tests.today(), tests.box('مصرف مطفأ'), 1000, null) $$,
  'ZL044', 'account_inactive', 'a switched-off box is refused'
);
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('done'), null, null, tests.today(), gen_random_uuid(), 1000, null) $$,
  'P0002', 'finance_account_not_found', 'a missing box'
);
select throws_ok(
  $$ select public.admin_save_payment(null, gen_random_uuid(), null, null, tests.today(), tests.cash(), 1000, null) $$,
  'P0002', 'order_not_found', 'a missing order'
);
select throws_ok(
  $$ select public.admin_save_payment(null, null, gen_random_uuid(), null, tests.today(), tests.cash(), 1000, null) $$,
  'P0002', 'subscription_not_found', 'a missing subscription'
);
select throws_ok(
  $$ select public.admin_save_payment(null, null, null, gen_random_uuid(), tests.today(), tests.cash(), 1000, null) $$,
  'P0002', 'sale_not_found', 'a missing sale'
);

-- Refunds ------------------------------------------------------------------------------------

select lives_ok(
  $$ select public.admin_save_payment(null, tests.id('done'), null, null, tests.today(), tests.cash(), -25000, 'رجعنا') $$,
  'a refund is a negative payment, up to what was paid'
);
select is(tests.balance(tests.cash()), 100000 - 5000, 'and leaves the box');
select throws_ok(
  $$ select public.admin_save_payment(null, tests.id('done'), null, null, tests.today(), tests.cash(), -1, null) $$,
  'ZL050', 'refund_too_large', 'never past what was paid'
);

-- Edit and void ------------------------------------------------------------------------------

select lives_ok(
  format(
    $$ select public.admin_save_payment(%L, null, null, null, tests.today(), tests.cash(), 25000, 'الباقي') $$,
    :'pay'
  ),
  'an edit may leave the target out'
);
select is(
  tests.last_diff('payment.update'),
  '{"amount_iqd": {"from": 20000, "to": 25000}}'::jsonb,
  'logged as payment.update with only what changed'
);
select throws_ok(
  format(
    $$ select public.admin_save_payment(%L, tests.id('open'), null, null, tests.today(), tests.cash(), 25000, null) $$,
    :'pay'
  ),
  '22023', 'invalid_target', 'but keeps it'
);
select throws_ok(
  format(
    $$ select public.admin_save_payment(%L, null, null, null, tests.today(), tests.cash(), 1000, null) $$,
    gen_random_uuid()
  ),
  'P0002', 'payment_not_found', 'a missing payment'
);
select throws_ok(
  format($$ select public.admin_void_payment(%L, '  ') $$, :'pay'),
  'ZL011', 'reason_required', 'a void needs a reason'
);
select throws_ok(
  format($$ select public.admin_void_payment(%L, 'غلط') $$, :'pay'),
  'ZL050', 'refund_too_large', 'and is refused when the refunds would be left ahead'
);
select lives_ok(
  $$ select public.admin_void_payment(
       (select id from public.finance_payments where amount_iqd = -25000), 'ما رجعنا'
     ) $$,
  'an admin voids a refund'
);
select lives_ok(format($$ select public.admin_void_payment(%L, 'غلط') $$, :'pay'), 'then the payment');
select is(tests.last_diff('payment.void'), '{"reason": "غلط"}'::jsonb, 'logged as payment.void');
select throws_ok(
  format($$ select public.admin_void_payment(%L, 'غلط') $$, :'pay'),
  'ZL047', 'record_voided', 'once only'
);
select throws_ok(
  format(
    $$ select public.admin_save_payment(%L, null, null, null, tests.today(), tests.cash(), 1000, null) $$,
    :'pay'
  ),
  'ZL047', 'record_voided', 'and a voided payment cannot be edited'
);
select is(tests.balance(tests.cash()), 100000, 'voided payments leave the balance');

-- Subscriptions and "paid" -------------------------------------------------------------------

select public.admin_save_payment(null, null, tests.id('sub'), null, tests.today(), tests.cash(), 30000, null);
select is(tests.paid(tests.id('sub')), false, 'half the price leaves the subscription unpaid');
select public.admin_save_payment(null, null, tests.id('sub'), null, tests.today(), tests.cash(), 30000, null) as sub_pay \gset
select is(tests.paid(tests.id('sub')), true, 'the whole price ticks paid');
select is(
  tests.last_diff('subscription.paid'),
  '{"paid": {"from": false, "to": true}}'::jsonb,
  'logged as subscription.paid'
);
select public.admin_void_payment(:'sub_pay', 'غلط بالمبلغ');
select is(tests.paid(tests.id('sub')), false, 'and a void unticks it');
select throws_ok(
  $$ select public.admin_set_subscription_paid(tests.id('sub'), true) $$,
  'ZL053', 'paid_set_by_finance', 'A7''s switch refuses a subscription in the books'
);
select lives_ok(
  $$ select public.admin_set_subscription_paid(tests.id('old_sub'), true) $$,
  'and still ticks one activated before the start'
);

select * from finish();
rollback;
