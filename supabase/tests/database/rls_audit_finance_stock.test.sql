-- RLS audit of migration finance_stock (Phase 7, task 6).
--
-- 1. A stock in that names an expense checks that the expense's category is
--    a general one, but locks only the expense (FOR SHARE), not its
--    category. admin_save_expense_category locks only the category (FOR
--    UPDATE) and its expense_categories_guard_stock trigger reads the stock
--    records without a lock. So an admin linking an in while another admin
--    moves the category to wages or equipment both pass their checks, both
--    commit, and a live in names an expense outside a general category
--    (the ZL064 / ZL067 rule broken). Two sessions can't run in one pgTAP
--    transaction, so the test checks the lock the fix needs: after the save,
--    the category row is share-locked by this transaction (as
--    private.finance_check_category does for admin_save_expense), so a
--    category save at the same moment waits and then sees the record.
--
-- 2. Quantities are numeric(12, 2) (below 10^10) when admin_stock_items and
--    admin_stock_month return them, but nothing capped an item's total:
--    eleven ins of the largest allowed quantity (10^9) made its quantity
--    1.1 * 10^10, and both reads then failed with 22003 (numeric field
--    overflow) for every item. An item now never holds more than 10^9
--    (22023 invalid_quantity).
--
-- 3. On a count's day the count absorbed the day's outs, so an out of more
--    than was there passed (the count's correction showed it). An out is now
--    checked against what was there before the count too (ZL065).
begin;
\ir _helpers.psql

create extension if not exists pgrowlocks with schema extensions;

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(7);

select tests.create_user('+9647504444444', 'admin');

update public.finance_settings as s set start_on = (date_trunc('month', tests.today()) - interval '1 month')::date,
  closed_through = null where s.id;
insert into public.finance_accounts (kind, name, opening_balance_iqd) values ('cash', 'قاصة التدقيق', 500000);
insert into public.expense_categories (name, kind) values ('مواد التدقيق', 'general');
insert into public.stock_items (name, unit, min_quantity) values ('كلور التدقيق', 'كيلو', 0), ('ماء التدقيق', 'لتر', 0);
insert into tests.ids select name, id from public.stock_items where name in ('كلور التدقيق', 'ماء التدقيق');
select id as category from public.expense_categories where name = 'مواد التدقيق' \gset

-- Inserted directly (not through admin_save_expense, which share-locks the
-- category itself), so only the stock save can have locked it.
insert into public.expenses (spent_on, category_id, account_id, amount_iqd, created_by)
select tests.today() - 3, :category, a.id, 50000, tests.user_id('+9647504444444')
from public.finance_accounts as a where a.name = 'قاصة التدقيق'
returning id as supplies \gset

select tests.authenticate_as(tests.user_id('+9647504444444'));

-- 1. The linked expense's category is locked -------------------------------------------------

select public.admin_save_stock_move(
  null, tests.id('كلور التدقيق'), tests.today() - 2, 'in', 10, null, :'supplies', null
);
select tests.clear_authentication();
-- The expense's insert above holds only a key-share lock on the category (its
-- foreign key), which a category save (FOR UPDATE) would also wait for, but
-- only until this transaction ends; the check needs a share lock or stronger.
select ok(
  exists (
    select 1
    from extensions.pgrowlocks('public.expense_categories') as l
    join public.expense_categories as c on c.ctid = l.locked_row
    where c.id = :category
      and l.modes && array['For Share', 'For No Key Update', 'For Update']
  ),
  'linking an in to an expense share-locks the expense''s category, so a move off general waits for it'
);

-- 2. Large quantities still read --------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_stock_move(null, tests.id('ماء التدقيق'), tests.today() - 1, 'in', 1000000000, null, null, null);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'in', 1, null, null, null) $$,
    tests.id('ماء التدقيق'), tests.today()),
  '22023', 'invalid_quantity', 'an item never holds more than 10^9'
);
select lives_ok(
  $$ select * from public.admin_stock_items() $$,
  'so the stock list always loads'
);
select lives_ok(
  format($$ select * from public.admin_stock_month(%L) $$, tests.today()),
  'and so does the month'
);

-- 3. A count doesn't hide an out of more than was there -------------------------------------

select public.admin_save_stock_move(null, tests.id('كلور التدقيق'), tests.today() - 1, 'count', 10, null, null, null);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'out', 1000, null, null, null) $$,
    tests.id('كلور التدقيق'), tests.today() - 1),
  'ZL065', 'stock_too_low', 'an out on a count''s day is checked against what was there before it'
);
select lives_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'out', 4, null, null, null) $$,
    tests.id('كلور التدقيق'), tests.today() - 1),
  'one within it is fine, and the count still sets the quantity'
);
select is(
  (select quantity from public.admin_stock_items() where id = tests.id('كلور التدقيق')), 10.00,
  'the count stands'
);

select * from finish();
rollback;
