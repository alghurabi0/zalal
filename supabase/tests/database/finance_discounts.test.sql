-- finance_discounts, admin_save_discount and admin_void_discount (spec §7,
-- §8.3 "Revenue and debts"; Phase 7, task 2).
--
-- Admins read every discount; guests, customers and crews none. Nobody
-- writes the table directly. A discount lives in the books only: the
-- order's total doesn't change.
--
-- admin_save_discount(id, order_id, subscription_id, amount_iqd, reason):
-- one item, an order or a subscription (22023 invalid_target). The order is
-- completed, not covered and completed on or after the books' start day; the
-- subscription activated on or after it (ZL051 discount_not_allowed). The
-- amount is 1 up to the item's amount (22023 invalid_amount), with a reason
-- (ZL011 reason_required). At most one live discount per item (ZL052
-- discount_exists); it is edited (the target stays) or voided (ZL047 once
-- voided). Logs discount.create / discount.update / discount.void. A
-- subscription's "paid" follows its price less the discount.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(35);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

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

create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.discount(p_id uuid) returns public.finance_discounts language sql stable security definer
as $$ select * from public.finance_discounts where id = p_id $$;
create function tests.paid(p_id uuid) returns boolean language sql stable security definer
as $$ select paid from public.subscriptions where id = p_id $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.finance_discounts'::regclass),
  'RLS is on for finance_discounts'
);
select throws_ok(
  $$ insert into public.finance_discounts (order_id, subscription_id, amount_iqd, reason, created_by)
     values (tests.id('done'), tests.id('sub'), 1000, 'زبون دائم', tests.user_id('+9647504444444')) $$,
  '23514', null, 'a discount belongs to exactly one item'
);
select throws_ok(
  $$ insert into public.finance_discounts (order_id, amount_iqd, reason, created_by)
     values (tests.id('done'), 0, 'زبون دائم', tests.user_id('+9647504444444')) $$,
  '23514', null, 'an amount is positive'
);

insert into public.finance_discounts (order_id, amount_iqd, reason, created_by)
values (tests.id('done'), 1000, 'تجربة', tests.user_id('+9647504444444'));

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.finance_discounts $$, '42501', null, 'a guest cannot read discounts');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.finance_discounts $$, 'a customer reads none, not even on their own order');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.finance_discounts $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.finance_discounts $$, 'nor a crew');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.finance_discounts), 1, 'an admin reads them');
select throws_ok(
  $$ delete from public.finance_discounts where true $$,
  '42501', null, 'but cannot write the table directly'
);
select tests.clear_authentication();
delete from public.finance_discounts;

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_save_discount(null, tests.id('done'), null, 5000, 'زبون دائم') $$,
  '42501', null, 'a guest cannot give a discount'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_save_discount(null, tests.id('done'), null, 5000, 'زبون دائم') $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_save_discount(null, tests.id('done'), null, 5000, 'زبون دائم') $$,
  '42501', 'not_allowed', 'nor a crew'
);

-- Save ---------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_discount(null, tests.id('done'), null, 5000, '  زبون دائم  ') as disc \gset
select is((tests.discount(:'disc')).reason, 'زبون دائم', 'an admin gives a discount on a completed order');
select is(
  tests.last_diff('discount.create'),
  jsonb_build_object('order_id', tests.id('done'), 'subscription_id', null, 'amount_iqd', 5000, 'reason', 'زبون دائم'),
  'logged as discount.create'
);
select is((select total_iqd from public.orders where id = tests.id('done')), 35000, 'the order''s total stays');
select throws_ok(
  $$ select public.admin_save_discount(null, tests.id('done'), null, 1000, 'ثاني') $$,
  'ZL052', 'discount_exists', 'one live discount per item'
);
select throws_ok(
  $$ select public.admin_save_discount(null, tests.id('open'), null, 1000, 'سبب') $$,
  'ZL051', 'discount_not_allowed', 'an order not yet completed takes none'
);
select throws_ok(
  $$ select public.admin_save_discount(null, tests.id('covered'), null, 1000, 'سبب') $$,
  'ZL051', 'discount_not_allowed', 'nor a covered order'
);
select throws_ok(
  $$ select public.admin_save_discount(null, tests.id('old'), null, 1000, 'سبب') $$,
  'ZL051', 'discount_not_allowed', 'nor one completed before the books start'
);
select throws_ok(
  $$ select public.admin_save_discount(null, null, tests.id('old_sub'), 1000, 'سبب') $$,
  'ZL051', 'discount_not_allowed', 'nor a subscription activated before the books start'
);
select throws_ok(
  $$ select public.admin_save_discount(null, null, tests.id('sub'), 60001, 'سبب') $$,
  '22023', 'invalid_amount', 'a discount is at most the item''s amount'
);
select throws_ok(
  $$ select public.admin_save_discount(null, null, tests.id('sub'), 0, 'سبب') $$,
  '22023', 'invalid_amount', 'and positive'
);
select throws_ok(
  $$ select public.admin_save_discount(null, null, tests.id('sub'), 1000, ' ') $$,
  'ZL011', 'reason_required', 'a discount needs a reason'
);
select throws_ok(
  $$ select public.admin_save_discount(null, null, null, 1000, 'سبب') $$,
  '22023', 'invalid_target', 'and an item'
);
select throws_ok(
  $$ select public.admin_save_discount(null, gen_random_uuid(), null, 1000, 'سبب') $$,
  'P0002', 'order_not_found', 'a missing order'
);

-- A subscription's "paid" follows the price less the discount.
select public.admin_save_payment(null, null, tests.id('sub'), null, tests.today(), tests.cash(), 50000, null);
select is(tests.paid(tests.id('sub')), false, 'a part payment leaves a subscription unpaid');
select public.admin_save_discount(null, null, tests.id('sub'), 10000, 'عرض') as sub_disc \gset
select is(tests.paid(tests.id('sub')), true, 'a discount covering the rest ticks paid');

-- Edit and void ------------------------------------------------------------------------------

select lives_ok(
  format($$ select public.admin_save_discount(%L, null, null, 7000, 'زبون دائم') $$, :'disc'),
  'an admin edits a discount'
);
select is(
  tests.last_diff('discount.update'),
  '{"amount_iqd": {"from": 5000, "to": 7000}}'::jsonb,
  'logged as discount.update with only what changed'
);
select throws_ok(
  format($$ select public.admin_save_discount(%L, tests.id('open'), null, 7000, 'سبب') $$, :'disc'),
  '22023', 'invalid_target', 'the item stays'
);
select lives_ok(format($$ select public.admin_void_discount(%L, 'غلط') $$, :'sub_disc'), 'an admin voids one');
select is(tests.paid(tests.id('sub')), false, 'which unticks paid again');
select is(tests.last_diff('discount.void'), '{"reason": "غلط"}'::jsonb, 'logged as discount.void');
select throws_ok(
  format($$ select public.admin_void_discount(%L, 'غلط') $$, :'sub_disc'),
  'ZL047', 'record_voided', 'once only'
);
select lives_ok(
  $$ select public.admin_save_discount(null, null, tests.id('sub'), 10000, 'عرض') $$,
  'a voided discount leaves room for a new one'
);

select * from finish();
rollback;
