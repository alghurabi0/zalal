-- RLS audit of migration finance_revenue (spec §7 "Accounting", §8.3
-- "Revenue and debts"; Phase 7, task 2).
--
-- 1. A subscription in the books is "paid" exactly while its payments cover
--    its price less its discount. admin_activate_subscription still takes
--    p_paid and stores it, and every activation is in the books (it is
--    activated today, and the start day is never after today), so an admin
--    call with p_paid true marks a subscription paid that nobody paid; A7's
--    switch then refuses to untick it (ZL053). The activation must leave it
--    unpaid (or refuse p_paid true with ZL053).
-- 2. Moving the start day earlier brings the subscriptions activated in
--    between into the books, but keeps the paid tick A7's switch set while
--    they were outside: paid with no payment. The move must sync them.
-- 3. Account deletion blanks the customer's payment notes, discount reasons
--    and the note and reason in their audit rows, but leaves the void reasons
--    on the payments and discounts themselves, the same staff text the
--    scrubbed payment.void and discount.void audit rows held.
--
-- All three are fixed in the migration: the activation leaves paid false,
-- the start-day move syncs the subscriptions it brings in, and the deletion
-- replaces those void reasons with '-deleted-'.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(5);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.today() - 30 where s.id;

create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.paid(p_id uuid) returns boolean language sql stable security definer
as $$ select paid from public.subscriptions where id = p_id $$;

-- 1. Activation with paid ticked ---------------------------------------------------------

insert into tests.ids values ('request', tests.create_subscription(tests.user_id('+9647801111111'), 'requested'));

-- The activation as the admin, with p_paid true; a fix that refuses it
-- (ZL053) is as good as one that ignores it.
create function tests.activate_paid(p_id uuid) returns boolean
language plpgsql
as $$
begin
  perform public.admin_activate_subscription(p_id, tests.today(), 2, 1, 60000, true, null);
  return tests.paid(p_id);
exception when sqlstate 'ZL053' then
  return tests.paid(p_id);
end;
$$;
grant execute on all functions in schema tests to anon, authenticated;

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is(
  tests.activate_paid(tests.id('request')),
  false,
  'activating a subscription in the books never ticks paid without a payment'
);
select is(
  (select coalesce(sum(amount_iqd), 0)::int from public.finance_payments where subscription_id = tests.id('request')),
  0,
  'it has no payment'
);

-- 2. The start moving earlier --------------------------------------------------------------

select tests.clear_authentication();
insert into tests.ids values ('before', tests.create_subscription(
  tests.user_id('+9647802222222'), 'active', tests.today() - 40, 2, 1
));
update public.subscriptions set activated_at = now() - interval '40 days' where id = tests.id('before');

select tests.authenticate_as(tests.user_id('+9647504444444'));
-- Outside the books, A7's switch ticks it.
select public.admin_set_subscription_paid(tests.id('before'), true);
select public.admin_update_finance_settings(tests.today() - 45);
select is(
  tests.paid(tests.id('before')),
  false,
  'a subscription the earlier start brings into the books is unpaid while no payment covers it'
);

-- 3. Account deletion and void reasons -----------------------------------------------------

select tests.clear_authentication();
insert into tests.ids values ('done', tests.create_order(
  tests.user_id('+9647801111111'), 'completed', now() - interval '1 day', tests.id('crew')
));
insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, created_at)
values (tests.id('done'), 'in_progress', 'completed', tests.user_id('+9647703333333'), 'crew', now() - interval '1 day');

select tests.authenticate_as(tests.user_id('+9647504444444'));
insert into tests.ids values (
  'payment', public.admin_save_payment(null, tests.id('done'), null, null, tests.today(), tests.cash(), 10000, null)
);
select public.admin_void_payment(tests.id('payment'), 'أبو علي رجّعها لأن بيته بشارع السدرة');
insert into tests.ids values (
  'discount', public.admin_save_discount(null, tests.id('done'), null, 5000, 'خصم')
);
select public.admin_void_discount(tests.id('discount'), 'أبو علي ما يستاهل خصم، رقمه 07801111111');

select tests.authenticate_as(tests.user_id('+9647801111111'));
select public.delete_account();

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is_empty(
  $$ select 1 from public.finance_payments where order_id = tests.id('done') and void_reason like '%أبو علي%' $$,
  'deleting the account blanks the void reasons of its payments'
);
select is_empty(
  $$ select 1 from public.finance_discounts where order_id = tests.id('done') and void_reason like '%أبو علي%' $$,
  'and of its discounts'
);

select * from finish();
rollback;
