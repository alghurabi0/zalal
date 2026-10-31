-- Equipment spread over its life (spec §7, §8.3 A22; Phase 7, task 5):
-- expenses.useful_life_months, opening_equipment, equipment_disposals,
-- the finance_equipment and finance_depreciation views, admin_equipment.
--
-- A purchase in an equipment category is spread over its life in months,
-- straight line from its own month: each month cost ÷ life rounded down,
-- the last month the rest, so the months add up to the cost. A life only on
-- an equipment category (ZL060 life_not_allowed); a new expense in one, or
-- one moved into one, needs a life (22023 invalid_life, 1–240). Purchases
-- from before this task keep none and stay whole expenses. A category with
-- live spread purchases stays an equipment one (ZL060).
--
-- opening_equipment: what the company owned at the books' start, with its
-- value then and the months left, spread from the start day's month.
-- admin_save_opening_equipment / admin_void_opening_equipment, only while
-- no month is closed (ZL056 books_closed).
--
-- equipment_disposals: one live write-off per item, dated (the expense day
-- rules), on or after the item's day (22023 invalid_date), with an optional
-- sale price into a box (22023 invalid_payment: both or neither). The
-- disposal month has no depreciation; its result is the price less what
-- was left. An item with a live disposal isn't edited or voided, nor
-- disposed again (ZL062 equipment_disposed). 22023 invalid_target for an
-- item that isn't spread, or not exactly one item. ZL054 in a closed month.
--
-- admin_equipment(month): each item acquired by the month's end (or today)
-- and not disposed before the month, with its depreciation that month, so
-- far, the value left and, once disposed, the result. Admins only (42501).
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(63);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.month(3), closed_through = null where s.id;

insert into public.expense_categories (name, kind) values ('معدات اختبار', 'equipment'), ('عام اختبار', 'general');
create function tests.category(p_name text) returns bigint language sql stable security definer
as $$ select id from public.expense_categories where name = p_name $$;
insert into public.finance_accounts (kind, name, opening_balance_iqd) values ('cash', 'قاصة المعدات', 500000);
insert into tests.ids select name, id from public.finance_accounts where name = 'قاصة المعدات';

-- A purchase from before this task: an equipment category, no life.
insert into public.expenses (spent_on, category_id, account_id, amount_iqd, note, created_by)
values (tests.month(2) + 1, tests.category('معدات اختبار'), tests.id('قاصة المعدات'), 50000, 'قديمة', tests.user_id('+9647504444444'));
insert into tests.ids select 'old', id from public.expenses where note = 'قديمة';

create function tests.balance(p_id uuid) returns bigint language sql stable security definer
as $$ select balance_iqd from public.finance_account_balances where account_id = p_id $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure ----------------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.opening_equipment'::regclass), 'RLS is on for opening_equipment');
select ok((select relrowsecurity from pg_class where oid = 'public.equipment_disposals'::regclass), 'RLS is on for equipment_disposals');
select throws_ok(
  format($$ update public.expenses set useful_life_months = 0 where id = %L $$, tests.id('old')),
  '23514', null, 'a life is at least a month'
);
select throws_ok(
  format(
    $$ insert into public.equipment_disposals (disposed_on, created_by) values (current_date, %L) $$,
    tests.user_id('+9647504444444')
  ),
  '23514', null, 'a disposal is of exactly one item'
);

insert into public.opening_equipment (name, value_iqd, months_left, created_by)
values ('مولدة قديمة', 10000, 10, tests.user_id('+9647504444444'));
insert into tests.ids select 'seed opening', id from public.opening_equipment;
insert into public.equipment_disposals (opening_equipment_id, disposed_on, created_by)
values (tests.id('seed opening'), tests.today(), tests.user_id('+9647504444444'));

-- Reads ----------------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.opening_equipment $$, '42501', null, 'a guest cannot read opening equipment');
select throws_ok($$ select * from public.equipment_disposals $$, '42501', null, 'nor disposals');
select throws_ok($$ select * from public.finance_equipment $$, '42501', null, 'nor the equipment');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.opening_equipment $$, 'a customer reads no opening equipment');
select is_empty($$ select * from public.equipment_disposals $$, 'nor disposals');
select is_empty($$ select * from public.finance_equipment $$, 'nor the equipment');
select is_empty($$ select * from public.finance_depreciation $$, 'nor its depreciation');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.opening_equipment $$, 'another customer reads none');
select is_empty($$ select * from public.equipment_disposals $$, 'nor their disposals');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.opening_equipment $$, 'a crew reads none');
select is_empty($$ select * from public.equipment_disposals $$, 'nor disposals');
select is_empty($$ select * from public.finance_equipment $$, 'nor the equipment');
select throws_ok($$ select * from public.admin_equipment(current_date) $$, '42501', 'not_allowed', 'nor admin_equipment');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok($$ select * from public.admin_equipment(current_date) $$, '42501', 'not_allowed', 'nor does a customer');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.opening_equipment), 1, 'an admin reads opening equipment');
select is((select count(*)::int from public.equipment_disposals), 1, 'and disposals');
select throws_ok(
  $$ delete from public.equipment_disposals where true $$,
  '42501', null, 'but cannot write them directly'
);

-- Clear the fixtures the reads used.
select tests.clear_authentication();
delete from public.equipment_disposals;
delete from public.opening_equipment;

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_save_opening_equipment(null, 'سيارة', 90000, 9, null) $$,
  '42501', null, 'a guest cannot add opening equipment'
);
select throws_ok(
  format($$ select public.admin_save_equipment_disposal(null, %L, null, current_date, null, 0, null) $$, tests.id('old')),
  '42501', null, 'nor a disposal'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_save_opening_equipment(null, 'سيارة', 90000, 9, null) $$,
  '42501', 'not_allowed', 'nor can a customer'
);
select throws_ok(
  format($$ select public.admin_save_equipment_disposal(null, %L, null, current_date, null, 0, null) $$, tests.id('old')),
  '42501', 'not_allowed', 'a customer cannot dispose of equipment'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_save_opening_equipment(null, 'سيارة', 90000, 9, null) $$,
  '42501', 'not_allowed', 'nor can a crew'
);
select throws_ok(
  format($$ select public.admin_save_equipment_disposal(null, %L, null, current_date, null, 0, null) $$, tests.id('old')),
  '42501', 'not_allowed', 'a crew cannot dispose of equipment'
);

-- A purchase's life ----------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format(
    $$ select public.admin_save_expense(null, %L, %L, %L, 1000, null, null, 3) $$,
    tests.today(), tests.category('عام اختبار'), tests.id('قاصة المعدات')
  ),
  'ZL060', 'life_not_allowed', 'a life only on an equipment category'
);
select throws_ok(
  format(
    $$ select public.admin_save_expense(null, %L, %L, %L, 1000, null, null, null) $$,
    tests.today(), tests.category('معدات اختبار'), tests.id('قاصة المعدات')
  ),
  '22023', 'invalid_life', 'a new purchase in an equipment category needs a life'
);
select throws_ok(
  format(
    $$ select public.admin_save_expense(null, %L, %L, %L, 1000, null, null, 241) $$,
    tests.today(), tests.category('معدات اختبار'), tests.id('قاصة المعدات')
  ),
  '22023', 'invalid_life', 'of at most 240 months'
);
select public.admin_save_expense(
  null, tests.month(2) + 5, tests.category('معدات اختبار'), tests.id('قاصة المعدات'), 120000, 'مضخة', null, 3
) as pump \gset
select is(
  tests.last_diff('expense.create') -> 'useful_life_months', '3'::jsonb,
  'an admin records a purchase with its life, logged with the expense'
);
select public.admin_save_expense(
  null, tests.month(1) + 1, tests.category('معدات اختبار'), tests.id('قاصة المعدات'), 100000, 'مولدة', null, 3
) as generator \gset
select lives_ok(
  format(
    $$ select public.admin_save_expense(%L, %L, %L, %L, 50000, 'قديمة جداً', null, null) $$,
    tests.id('old'), tests.month(2) + 1, tests.category('معدات اختبار'), tests.id('قاصة المعدات')
  ),
  'a purchase from before keeps no life when edited'
);
select throws_ok(
  format(
    $$ select public.admin_save_expense(%L, %L, %L, %L, 100000, 'مولدة', null, null) $$,
    :'generator', tests.month(1) + 1, tests.category('معدات اختبار'), tests.id('قاصة المعدات')
  ),
  '22023', 'invalid_life', 'a spread purchase keeps a life'
);
select throws_ok(
  format($$ select public.admin_save_expense_category(%L, null, 'general', null) $$, tests.category('معدات اختبار')),
  'ZL060', 'life_not_allowed', 'a category with spread purchases stays an equipment one'
);

-- Opening equipment --------------------------------------------------------------------------

select public.admin_save_opening_equipment(null, 'سيارة', 90000, 9, null) as car \gset
select is(
  tests.last_diff('opening_equipment.create'),
  jsonb_build_object('name', 'سيارة', 'value_iqd', 90000, 'months_left', 9, 'note', null),
  'an admin adds what the company owned at the start, logged as opening_equipment.create'
);
select throws_ok(
  $$ select public.admin_save_opening_equipment(null, 'س', 90000, 9, null) $$,
  '22023', 'invalid_name', 'it has a name'
);
select throws_ok(
  $$ select public.admin_save_opening_equipment(null, 'سيارة ثانية', 0, 9, null) $$,
  '22023', 'invalid_amount', 'a value'
);
select throws_ok(
  $$ select public.admin_save_opening_equipment(null, 'سيارة ثانية', 90000, 0, null) $$,
  '22023', 'invalid_life', 'and months left'
);
select public.admin_save_opening_equipment(:'car', 'سيارة بيك أب', 90000, 9, null);
select is(
  tests.last_diff('opening_equipment.update'),
  jsonb_build_object('name', jsonb_build_object('from', 'سيارة', 'to', 'سيارة بيك أب')),
  'an edit logs what changed'
);

-- Disposals ----------------------------------------------------------------------------------

select throws_ok(
  format($$ select public.admin_save_equipment_disposal(null, %L, null, current_date, null, 0, null) $$, tests.id('old')),
  '22023', 'invalid_target', 'only a spread purchase is disposed of'
);
select throws_ok(
  format($$ select public.admin_save_equipment_disposal(null, %L, %L, current_date, null, 0, null) $$, :'pump', :'car'),
  '22023', 'invalid_target', 'one item at a time'
);
select throws_ok(
  format($$ select public.admin_save_equipment_disposal(null, %L, null, current_date, null, 5000, null) $$, :'pump'),
  '22023', 'invalid_payment', 'a sale price goes into a box'
);
select throws_ok(
  format($$ select public.admin_save_equipment_disposal(null, %L, null, %L, null, 0, null) $$, :'pump', tests.month(2) + 4),
  '22023', 'invalid_date', 'not before it was bought'
);
select public.admin_save_equipment_disposal(
  null, :'pump', null, tests.month(0), tests.id('قاصة المعدات'), 50000, 'بعناها'
) as sold \gset
select is(
  tests.last_diff('equipment_disposal.create'),
  jsonb_build_object(
    'expense_id', :'pump', 'opening_equipment_id', null, 'disposed_on', tests.month(0),
    'account_id', tests.id('قاصة المعدات'), 'proceeds_iqd', 50000, 'note', 'بعناها'
  ),
  'an admin sells a pump, logged as equipment_disposal.create'
);
select is(
  tests.balance(tests.id('قاصة المعدات')), (500000 - 50000 - 120000 - 100000 + 50000)::bigint,
  'the sale price is in its box'
);
select throws_ok(
  format($$ select public.admin_save_equipment_disposal(null, %L, null, current_date, null, 0, null) $$, :'pump'),
  'ZL062', 'equipment_disposed', 'an item is disposed of once'
);
select throws_ok(
  format(
    $$ select public.admin_save_expense(%L, %L, %L, %L, 120000, 'مضخة كبيرة', null, 3) $$,
    :'pump', tests.month(2) + 5, tests.category('معدات اختبار'), tests.id('قاصة المعدات')
  ),
  'ZL062', 'equipment_disposed', 'a disposed purchase isn''t edited'
);
select throws_ok(
  format($$ select public.admin_void_expense(%L, 'غلط') $$, :'pump'),
  'ZL062', 'equipment_disposed', 'nor voided'
);

-- admin_equipment ------------------------------------------------------------------------------

select results_eq(
  format(
    $$ select name, cost_iqd, life_months, monthly_iqd, depreciated_iqd, book_value_iqd, result_iqd
       from public.admin_equipment(%L) order by acquired_on $$,
    tests.month(0) + 2
  ),
  $$ values
       ('سيارة بيك أب', 90000::bigint, 9, 10000::bigint, 40000::bigint, 50000::bigint, null::bigint),
       ('مضخة', 120000::bigint, 3, 0::bigint, 80000::bigint, 0::bigint, 10000::bigint),
       ('مولدة', 100000::bigint, 3, 33333::bigint, 66666::bigint, 33334::bigint, null::bigint) $$,
  'this month: each item''s depreciation, so far and left; the pump sold for 10,000 above what was left'
);
select results_eq(
  format(
    $$ select name, monthly_iqd, depreciated_iqd, book_value_iqd, disposed_on
       from public.admin_equipment(%L) order by acquired_on $$,
    tests.month(2)
  ),
  $$ values
       ('سيارة بيك أب', 10000::bigint, 20000::bigint, 70000::bigint, null::date),
       ('مضخة', 40000::bigint, 40000::bigint, 80000::bigint, null::date) $$,
  'a past month: what was owned then, before the sale'
);
select is(
  (select sum(amount_iqd)::bigint from public.finance_depreciation where item_id = :'generator'),
  100000::bigint, 'a purchase''s months add up to its cost'
);
select throws_ok(
  $$ select * from public.admin_equipment(null) $$,
  '22023', 'invalid_date', 'a month is required'
);

select throws_ok(
  format($$ select public.admin_void_equipment_disposal(%L, '') $$, :'sold'),
  'ZL011', 'reason_required', 'a void has a reason'
);
select public.admin_void_equipment_disposal(:'sold', 'ما انباعت');
select is(
  (select row(monthly_iqd, depreciated_iqd, book_value_iqd)::text from public.admin_equipment(tests.month(0)) where name = 'مضخة'),
  row(40000::bigint, 120000::bigint, 0::bigint)::text,
  'a voided disposal counts nowhere: the pump runs to the end of its life'
);
select throws_ok(
  format($$ select public.admin_void_equipment_disposal(%L, 'مرة ثانية') $$, :'sold'),
  'ZL047', 'record_voided', 'a voided disposal stays as it is'
);
select public.admin_save_equipment_disposal(null, null, :'car', tests.today(), null, 0, 'انقلبت') as wreck \gset
select throws_ok(
  format($$ select public.admin_save_opening_equipment(%L, 'سيارة', 90000, 9, null) $$, :'car'),
  'ZL062', 'equipment_disposed', 'disposed opening equipment isn''t edited'
);
select throws_ok(
  format($$ select public.admin_void_opening_equipment(%L, 'غلط') $$, :'car'),
  'ZL062', 'equipment_disposed', 'nor voided'
);
select public.admin_void_equipment_disposal(:'wreck', 'تصلحت');
select public.admin_void_opening_equipment(:'car', 'مو إلنا');
select is_empty(
  format($$ select 1 from public.admin_equipment(%L) where opening_equipment_id = %L $$, tests.today(), :'car'),
  'voided opening equipment counts nowhere'
);

-- Month close --------------------------------------------------------------------------------

select public.admin_save_opening_equipment(null, 'ماطور', 30000, 3, null) as motor \gset
select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(1) - 1 where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.admin_save_opening_equipment(null, 'سيارة ثانية', 90000, 9, null) $$,
  'ZL056', 'books_closed', 'no opening equipment is added while a month is closed'
);
select throws_ok(
  format($$ select public.admin_save_opening_equipment(%L, 'ماطور', 40000, 3, null) $$, :'motor'),
  'ZL056', 'books_closed', 'nor changed'
);
select throws_ok(
  format($$ select public.admin_void_opening_equipment(%L, 'غلط') $$, :'motor'),
  'ZL056', 'books_closed', 'nor voided'
);
select throws_ok(
  format($$ select public.admin_save_equipment_disposal(null, %L, null, %L, null, 0, null) $$, :'pump', tests.month(2) + 20),
  'ZL054', 'month_closed', 'nothing is disposed of in a closed month'
);
select lives_ok(
  format($$ select public.admin_save_equipment_disposal(null, null, %L, %L, null, 0, null) $$, :'motor', tests.today()),
  'but opening equipment is disposed of in an open one'
);

select * from finish();
rollback;
