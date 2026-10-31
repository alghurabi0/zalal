-- Stock purchases linked to their expense (spec §7, §8.3 A16 and A23;
-- Phase 7, task 6).
--
-- An "in" may name the expense that paid for it: a live expense in a
-- general category, dated on or before the in (ZL067 expense_not_allowed;
-- P0002 expense_not_found). One expense may cover several items. Only an in
-- names one (ZL067). Stock carries no value: the profit and the balance
-- sheet are the same with or without stock records.
--
-- While a live in names it, the expense is not voided, moved to a wages or
-- equipment category, or dated after the in (ZL064 expense_has_stock),
-- and its category doesn't move off general (ZL064): void the stock record
-- first.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(17);

select tests.create_user('+9647504444444', 'admin');

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;
insert into public.finance_accounts (kind, name, opening_balance_iqd) values ('cash', 'قاصة المخزن', 500000);
insert into tests.ids select 'cash', id from public.finance_accounts where name = 'قاصة المخزن';
insert into public.expense_categories (name, kind) values
  ('مواد اختبار', 'general'), ('أجور اختبار', 'wages'), ('معدات اختبار', 'equipment');
insert into public.stock_items (name, unit, min_quantity) values ('كلور', 'كيلو', 0), ('فرش', 'قطعة', 0);
insert into tests.ids select name, id from public.stock_items;

create function tests.category(p_name text) returns bigint language sql stable security definer
as $$ select id from public.expense_categories where name = p_name $$;
grant execute on all functions in schema tests to anon, authenticated;

select tests.authenticate_as(tests.user_id('+9647504444444'));

select public.admin_save_expense(
  null, tests.month(1) + 1, tests.category('مواد اختبار'), tests.id('cash'), 90000, 'مواد', null, null
) as supplies \gset
select public.admin_save_expense(
  null, tests.month(1) + 1, tests.category('أجور اختبار'), tests.id('cash'), 20000, null, null, null
) as wage \gset
select public.admin_save_expense(
  null, tests.month(1) + 1, tests.category('معدات اختبار'), tests.id('cash'), 300000, 'مضخة', null, 36
) as pump \gset
select public.admin_save_expense(
  null, tests.month(1) + 1, tests.category('مواد اختبار'), tests.id('cash'), 1000, null, null, null
) as dropped \gset
select public.admin_void_expense(:'dropped', 'خطأ');

select row(revenue_iqd, expenses_iqd, profit_iqd, paid_out_iqd)::text as pnl
from public.admin_profit_and_loss(tests.month(1), tests.month(1)) \gset
select row(assets_iqd, liabilities_iqd, equity_iqd, balanced)::text as sheet
from public.admin_balance_sheet(tests.month(0)) \gset

-- Linking ------------------------------------------------------------------------------------

select public.admin_save_stock_move(
  null, tests.id('كلور'), tests.month(1) + 1, 'in', 20, null, :'supplies', null
) as chlorine \gset
select is(
  (select expense_id from public.stock_moves where id = :'chlorine'), :'supplies'::uuid,
  'an in names the expense that paid for it'
);
select lives_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'in', 5, null, %L, null) $$,
    tests.id('فرش'), tests.month(1) + 4, :'supplies'),
  'one expense covers several items, received on its day or later'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'in', 1, null, %L, null) $$,
    tests.id('فرش'), tests.month(1), :'supplies'),
  'ZL067', 'expense_not_allowed', 'not before the expense''s day'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'in', 1, null, %L, null) $$,
    tests.id('فرش'), tests.month(1) + 1, :'wage'),
  'ZL067', 'expense_not_allowed', 'not a wage'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'in', 1, null, %L, null) $$,
    tests.id('فرش'), tests.month(1) + 1, :'pump'),
  'ZL067', 'expense_not_allowed', 'nor equipment'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'in', 1, null, %L, null) $$,
    tests.id('فرش'), tests.month(1) + 1, :'dropped'),
  'ZL067', 'expense_not_allowed', 'nor a voided expense'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'out', 1, null, %L, null) $$,
    tests.id('كلور'), tests.month(1) + 2, :'supplies'),
  'ZL067', 'expense_not_allowed', 'only an in names an expense'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'in', 1, null, gen_random_uuid(), null) $$,
    tests.id('فرش'), tests.month(1) + 1),
  'P0002', 'expense_not_found', 'a missing expense'
);

-- The books don't change ---------------------------------------------------------------------

select is(
  (select row(revenue_iqd, expenses_iqd, profit_iqd, paid_out_iqd)::text
   from public.admin_profit_and_loss(tests.month(1), tests.month(1))),
  :'pnl',
  'stock records leave the profit and loss as it was'
);
select is(
  (select row(assets_iqd, liabilities_iqd, equity_iqd, balanced)::text from public.admin_balance_sheet(tests.month(0))),
  :'sheet',
  'and the balance sheet, which still balances'
);

-- The linked expense holds -------------------------------------------------------------------

select throws_ok(
  format($$ select public.admin_void_expense(%L, 'خطأ') $$, :'supplies'),
  'ZL064', 'expense_has_stock', 'an expense a live in names is not voided'
);
select throws_ok(
  format($$ select public.admin_save_expense(%L, %L, %L, %L, 90000, 'مواد', null, null) $$,
    :'supplies', tests.month(1) + 2, tests.category('مواد اختبار'), tests.id('cash')),
  'ZL064', 'expense_has_stock', 'nor dated after the in'
);
select throws_ok(
  format($$ select public.admin_save_expense(%L, %L, %L, %L, 90000, 'مواد', null, null) $$,
    :'supplies', tests.month(1) + 1, tests.category('أجور اختبار'), tests.id('cash')),
  'ZL064', 'expense_has_stock', 'nor moved to a wages category'
);
select throws_ok(
  format($$ select public.admin_save_expense_category(%L, 'مواد اختبار', 'wages', true) $$, tests.category('مواد اختبار')),
  'ZL064', 'expense_has_stock', 'and its category stays general'
);
select lives_ok(
  format($$ select public.admin_save_expense(%L, %L, %L, %L, 95000, 'مواد وفرش', null, null) $$,
    :'supplies', tests.month(1) + 1, tests.category('مواد اختبار'), tests.id('cash')),
  'its amount and note still change'
);

select public.admin_void_stock_move(id, 'خطأ') from public.stock_moves where expense_id = :'supplies';
select lives_ok(
  format($$ select public.admin_void_expense(%L, 'خطأ') $$, :'supplies'),
  'once its stock records are voided, the expense is voided'
);
select lives_ok(
  format($$ select public.admin_save_expense_category(%L, 'مواد اختبار', 'wages', true) $$, tests.category('مواد اختبار')),
  'and its category moves'
);

select * from finish();
rollback;
