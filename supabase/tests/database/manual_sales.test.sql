-- manual_sales, admin_save_manual_sale and admin_void_manual_sale (spec §7,
-- §8.3 "Revenue and debts"; Phase 7, task 2).
--
-- Work done outside the app (phone bookings, hotels and مواكب, outside
-- Karbala): not an order. Admins read every sale; guests, customers and crews
-- none. Nobody writes the table directly.
--
-- admin_save_manual_sale(id, sold_on, customer_name, customer_phone,
-- service, place, amount_iqd, crew_id, note, paid_account_id): records (id
-- null) or edits a sale. The expenses' day rules (ZL042, ZL043); a name of
-- 2–80 characters (22023 invalid_name), an optional E.164 phone (22023
-- invalid_phone), a service of 2–120 (22023 invalid_service), an optional
-- place up to 120 (22023 invalid_place), an amount of 1–1,000,000,000, an
-- optional crew (P0002 crew_not_found) and note. paid_account_id, for a new
-- sale only (22023 invalid_payment), records a payment of the whole amount
-- into that box on the sale's day. Logs sale.create / sale.update.
-- admin_void_manual_sale(id, reason): voids the sale and its live payments
-- (each logged as payment.void); once only (ZL047), and a voided sale can't
-- be edited. Logs sale.void.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(34);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.today() - 30 where s.id;

create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.sale(p_id uuid) returns public.manual_sales language sql stable security definer
as $$ select * from public.manual_sales where id = p_id $$;
create function tests.live_payments(p_id uuid) returns int language sql stable security definer
as $$ select count(*)::int from public.finance_payments where sale_id = p_id and voided_at is null $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.manual_sales'::regclass),
  'RLS is on for manual_sales'
);
select throws_ok(
  $$ insert into public.manual_sales (sold_on, customer_name, customer_phone, service, amount_iqd, created_by)
     values (current_date, 'فندق الكوثر', '07801234567', 'تنظيف', 1000, tests.user_id('+9647504444444')) $$,
  '23514', null, 'a phone is stored as E.164'
);
select throws_ok(
  $$ insert into public.manual_sales (sold_on, customer_name, service, amount_iqd, created_by)
     values (current_date, ' فندق ', 'تنظيف', 1000, tests.user_id('+9647504444444')) $$,
  '23514', null, 'a name is trimmed'
);

insert into public.manual_sales (sold_on, customer_name, service, amount_iqd, created_by)
values (tests.today(), 'موكب', 'تنظيف خزانات', 50000, tests.user_id('+9647504444444'));

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.manual_sales $$, '42501', null, 'a guest cannot read sales');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.manual_sales $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.manual_sales $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.manual_sales $$, 'nor a crew');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.manual_sales), 1, 'an admin reads them');
select throws_ok(
  $$ update public.manual_sales set amount_iqd = 1 where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_save_manual_sale(null, current_date, 'موكب', null, 'تنظيف', null, 5000, null, null, null) $$,
  '42501', null, 'a guest cannot record a sale'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_save_manual_sale(null, current_date, 'موكب', null, 'تنظيف', null, 5000, null, null, null) $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_save_manual_sale(null, current_date, 'موكب', null, 'تنظيف', null, 5000, null, null, null) $$,
  '42501', 'not_allowed', 'nor a crew'
);
select throws_ok(
  $$ select public.admin_void_manual_sale((select id from public.manual_sales limit 1), 'غلط') $$,
  '42501', 'not_allowed', 'and a crew cannot void one'
);

-- Save ---------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_manual_sale(
  null, tests.today() - 1, '  فندق الكوثر ', '+9647801234567', ' تنظيف 4 خزانات ', '  ', 120000,
  tests.id('crew'), null, tests.cash()
) as sale \gset
select is((tests.sale(:'sale')).customer_name, 'فندق الكوثر', 'an admin records a sale, trimmed');
select is((tests.sale(:'sale')).place, null, 'a blank place is none');
select is(
  tests.last_diff('sale.create'),
  jsonb_build_object(
    'sold_on', tests.today() - 1, 'customer_name', 'فندق الكوثر', 'customer_phone', '+9647801234567',
    'service', 'تنظيف 4 خزانات', 'place', null, 'amount_iqd', 120000, 'crew_id', tests.id('crew'),
    'note', null
  ),
  'logged as sale.create'
);
select results_eq(
  format(
    $$ select paid_on, account_id, amount_iqd, automatic from public.finance_payments where sale_id = %L $$,
    :'sale'
  ),
  $$ values (tests.today() - 1, tests.cash(), 120000, false) $$,
  'paid now records the whole amount into the box on the sale''s day'
);
select is(tests.last_diff('payment.create') ->> 'amount_iqd', '120000', 'logged as payment.create');
select throws_ok(
  $$ select public.admin_save_manual_sale(null, tests.today() + 1, 'موكب', null, 'تنظيف', null, 5000, null, null, null) $$,
  'ZL043', 'date_in_future', 'a day after today is refused'
);
select throws_ok(
  $$ select public.admin_save_manual_sale(null, tests.today() - 31, 'موكب', null, 'تنظيف', null, 5000, null, null, null) $$,
  'ZL042', 'before_finance_start', 'so is a day before the books start'
);
select throws_ok(
  $$ select public.admin_save_manual_sale(null, tests.today(), 'م', null, 'تنظيف', null, 5000, null, null, null) $$,
  '22023', 'invalid_name', 'a name has 2–80 characters'
);
select throws_ok(
  $$ select public.admin_save_manual_sale(null, tests.today(), 'موكب', '0780', 'تنظيف', null, 5000, null, null, null) $$,
  '22023', 'invalid_phone', 'a phone is a 07X number'
);
select throws_ok(
  $$ select public.admin_save_manual_sale(null, tests.today(), 'موكب', null, ' ', null, 5000, null, null, null) $$,
  '22023', 'invalid_service', 'a service is required'
);
select throws_ok(
  $$ select public.admin_save_manual_sale(null, tests.today(), 'موكب', null, 'تنظيف', repeat('ا', 121), 5000, null, null, null) $$,
  '22023', 'invalid_place', 'a place is at most 120 characters'
);
select throws_ok(
  $$ select public.admin_save_manual_sale(null, tests.today(), 'موكب', null, 'تنظيف', null, 0, null, null, null) $$,
  '22023', 'invalid_amount', 'an amount is positive'
);
select throws_ok(
  $$ select public.admin_save_manual_sale(null, tests.today(), 'موكب', null, 'تنظيف', null, 5000, gen_random_uuid(), null, null) $$,
  'P0002', 'crew_not_found', 'a missing crew'
);

-- Edit and void ------------------------------------------------------------------------------

select lives_ok(
  format(
    $$ select public.admin_save_manual_sale(%L, tests.today() - 1, 'فندق الكوثر', '+9647801234567',
         'تنظيف 4 خزانات', 'شارع الجمهورية', 120000, tests.id('crew'), null, null) $$,
    :'sale'
  ),
  'an admin edits a sale'
);
select is(
  tests.last_diff('sale.update'),
  '{"place": {"from": null, "to": "شارع الجمهورية"}}'::jsonb,
  'logged as sale.update with only what changed'
);
select throws_ok(
  format(
    $$ select public.admin_save_manual_sale(%L, tests.today() - 1, 'فندق الكوثر', null,
         'تنظيف', null, 120000, null, null, tests.cash()) $$,
    :'sale'
  ),
  '22023', 'invalid_payment', 'paid now is for a new sale only'
);
select lives_ok(format($$ select public.admin_void_manual_sale(%L, 'مكرر') $$, :'sale'), 'an admin voids a sale');
select is(tests.live_payments(:'sale'), 0, 'and its payments with it');
select is(tests.last_diff('sale.void'), '{"reason": "مكرر"}'::jsonb, 'logged as sale.void');
select throws_ok(
  format($$ select public.admin_void_manual_sale(%L, 'مكرر') $$, :'sale'),
  'ZL047', 'record_voided', 'once only'
);
select throws_ok(
  format(
    $$ select public.admin_save_manual_sale(%L, tests.today(), 'فندق', null, 'تنظيف', null, 1000, null, null, null) $$,
    :'sale'
  ),
  'ZL047', 'record_voided', 'and a voided sale cannot be edited'
);

select * from finish();
rollback;
