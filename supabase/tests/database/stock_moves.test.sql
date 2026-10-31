-- stock_moves, admin_save_stock_move, admin_void_stock_move and
-- admin_stock_month (spec §7, §8.3 A23; Phase 7, task 6).
--
-- Every change to an item's stock, dated: "in" (a purchase or anything
-- received), "out" (a crew took it, or it was used up; may name the crew)
-- and "count" (a stock count: the quantity on hand at the end of its day).
-- Quantities have up to 2 decimals, above 0 for in and out, 0 or more for a
-- count. Admins read them; guests, customers and crews none. Nobody writes
-- the table directly.
--
-- An item's quantity at the end of a day is its latest count on or before
-- that day, plus the ins and less the outs after the count's day (all of
-- them with no count). It is never below zero at the end of any day: a
-- save, edit or void that would make it so is refused (ZL065
-- stock_too_low). One live count per item per day (ZL066 count_exists).
-- The day rules of every finance record (ZL042, ZL043, ZL054, ZL046); a
-- switched-off item takes no new record (ZL044 item_inactive); an edit keeps
-- its item and kind (22023 invalid_target); a crew only on an out (22023
-- invalid_crew); ZL047 once voided, ZL011 a void's reason. Logged as
-- stock_move.create / .update / .void.
--
-- Low stock: when a record takes a switched-on item from above its minimum
-- to at or below it, every admin gets a stock_low notification (once per
-- crossing). admin_stock_month(month): each item's opening quantity, ins,
-- outs, count corrections and closing quantity for the month.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(54);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;

insert into public.stock_items (name, unit, min_quantity) values ('كلور', 'كيلو', 5), ('كفوف', 'زوج', 0);
insert into public.stock_items (name, unit, active) values ('قديم', 'قطعة', false);
insert into tests.ids select name, id from public.stock_items;

create function tests.qty(p_id uuid) returns numeric language sql stable
as $$ select quantity from public.admin_stock_items() where id = p_id $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
create function tests.low_notices() returns int language sql stable security definer
as $$ select count(*)::int from public.notifications
      where type = 'stock_low' and user_id = tests.user_id('+9647504444444') $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.stock_moves'::regclass), 'RLS is on for stock_moves');
select throws_ok(
  format(
    $$ insert into public.stock_moves (item_id, moved_on, kind, quantity, created_by) values (%L, current_date, 'in', 0, %L) $$,
    tests.id('كفوف'), tests.user_id('+9647504444444')
  ),
  '23514', null, 'an in is above zero'
);
select throws_ok(
  format(
    $$ insert into public.stock_moves (item_id, moved_on, kind, quantity, crew_id, created_by)
       values (%L, current_date, 'in', 1, %L, %L) $$,
    tests.id('كفوف'), tests.id('crew'), tests.user_id('+9647504444444')
  ),
  '23514', null, 'only an out names a crew'
);

insert into public.stock_moves (item_id, moved_on, kind, quantity, created_by)
values (tests.id('كفوف'), tests.month(2) + 1, 'in', 4, tests.user_id('+9647504444444'));
insert into tests.ids select 'gloves in', id from public.stock_moves where item_id = tests.id('كفوف');

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.stock_moves $$, '42501', null, 'a guest cannot read stock records');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.stock_moves $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.stock_moves $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.stock_moves $$, 'nor a crew, even one it names');
select throws_ok(
  format($$ select * from public.admin_stock_month(%L) $$, tests.month(0)),
  '42501', 'not_allowed', 'nor the month''s figures'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.stock_moves), 1, 'an admin reads them');
select throws_ok(
  $$ delete from public.stock_moves where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, current_date, 'in', 1, null, null, null) $$, tests.id('كفوف')),
  '42501', null, 'a guest cannot record stock'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, current_date, 'in', 1, null, null, null) $$, tests.id('كفوف')),
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, current_date, 'out', 1, %L, null, null) $$,
    tests.id('كفوف'), tests.id('crew')),
  '42501', 'not_allowed', 'nor a crew'
);
select throws_ok(
  format($$ select public.admin_void_stock_move(%L, 'خطأ') $$, tests.id('gloves in')),
  '42501', 'not_allowed', 'nor void one'
);

-- In, out, count -----------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_stock_move(null, tests.id('كلور'), tests.month(1) + 1, 'in', 10, null, null, 'شوالات') as buy \gset
select is(
  tests.last_diff('stock_move.create'),
  jsonb_build_object(
    'item_id', tests.id('كلور'), 'moved_on', tests.month(1) + 1, 'kind', 'in', 'quantity', 10,
    'crew_id', null, 'expense_id', null, 'note', 'شوالات'
  ),
  'an admin records an in, logged as stock_move.create'
);
select is(tests.qty(tests.id('كلور')), 10.00, 'which adds to the item');
select public.admin_save_stock_move(null, tests.id('كلور'), tests.month(1) + 5, 'out', 3, null, null, null) as use1 \gset
select is(tests.qty(tests.id('كلور')), 7.00, 'an out takes from it');
select is(tests.low_notices(), 0, 'still above the minimum: no notice');

select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'out', 8, null, null, null) $$,
    tests.id('كلور'), tests.month(1) + 6),
  'ZL065', 'stock_too_low', 'an out beyond what is there is refused'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'out', 1, null, null, null) $$,
    tests.id('كلور'), tests.month(1)),
  'ZL065', 'stock_too_low', 'so is one dated before the stock came in'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, current_date, 'in', 0, null, null, null) $$, tests.id('كلور')),
  '22023', 'invalid_quantity', 'an in is above zero'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, current_date, 'in', 1.005, null, null, null) $$, tests.id('كلور')),
  '22023', 'invalid_quantity', 'with at most 2 decimals'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, current_date, null, 1, null, null, null) $$, tests.id('كلور')),
  '22023', 'invalid_kind', 'a kind is required'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, current_date, 'in', 1, %L, null, null) $$,
    tests.id('كلور'), tests.id('crew')),
  '22023', 'invalid_crew', 'only an out names a crew'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, current_date, 'out', 1, gen_random_uuid(), null, null) $$,
    tests.id('كلور')),
  'P0002', 'crew_not_found', 'a missing crew'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, gen_random_uuid(), current_date, 'in', 1, null, null, null) $$),
  'P0002', 'stock_item_not_found', 'a missing item'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, current_date, 'in', 1, null, null, null) $$, tests.id('قديم')),
  'ZL044', 'item_inactive', 'a switched-off item takes nothing new'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'in', 1, null, null, null) $$,
    tests.id('كلور'), tests.month(2) - 1),
  'ZL042', 'before_finance_start', 'not before the books start'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'in', 1, null, null, null) $$,
    tests.id('كلور'), tests.today() + 1),
  'ZL043', 'date_in_future', 'nor after today'
);

select public.admin_save_stock_move(
  null, tests.id('كلور'), tests.month(1) + 2, 'out', 2.5, tests.id('crew'), null, null
) as use2 \gset
select is(tests.qty(tests.id('كلور')), 4.50, 'an out may name the crew that took it');
select is(tests.low_notices(), 1, 'dropping to the minimum or below tells every admin');
select is(
  (select data from public.notifications where type = 'stock_low' and user_id = tests.user_id('+9647504444444')),
  jsonb_build_object('item_id', tests.id('كلور'), 'quantity', 4.5, 'unit', 'كيلو', 'name', 'كلور'),
  'with the item, its unit and quantity'
);
select is(
  (select audience::text from public.notifications where type = 'stock_low' limit 1), 'admin', 'for admins only'
);

select public.admin_save_stock_move(null, tests.id('كلور'), tests.month(1) + 10, 'count', 6, null, null, 'جرد') as count1 \gset
select is(tests.qty(tests.id('كلور')), 6.00, 'a count sets the quantity');
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'count', 7, null, null, null) $$,
    tests.id('كلور'), tests.month(1) + 10),
  'ZL066', 'count_exists', 'one count per item a day'
);
select public.admin_save_stock_move(null, tests.id('كلور'), tests.month(1) + 3, 'in', 4, null, null, null) as late \gset
select is(tests.qty(tests.id('كلور')), 6.00, 'an in dated before a count leaves the counted quantity');
select public.admin_save_stock_move(null, tests.id('كلور'), tests.today(), 'out', 1, null, null, null) as use3 \gset
select is(tests.qty(tests.id('كلور')), 5.00, 'an out after the count takes from it');
select is(tests.low_notices(), 2, 'and crossing again tells admins again');
select public.admin_save_stock_move(null, tests.id('كلور'), tests.today(), 'out', 0.5, null, null, null);
select is(tests.low_notices(), 2, 'but not while it stays low');

-- The month ----------------------------------------------------------------------------------

select is(
  (select row(opening_quantity, in_quantity, out_quantity, correction_quantity, closing_quantity)::text
   from public.admin_stock_month(tests.month(1)) where item_id = tests.id('كلور')),
  row(0.00, 14.00, 5.50, -2.50, 6.00)::text,
  'a month: opening, ins, outs, the count''s correction and closing'
);
select is(
  (select row(opening_quantity, in_quantity, out_quantity, correction_quantity, closing_quantity)::text
   from public.admin_stock_month(tests.month(0)) where item_id = tests.id('كلور')),
  row(6.00, 0.00, 1.50, 0.00, 4.50)::text,
  'and the next month opens where it closed'
);
select throws_ok(
  format($$ select * from public.admin_stock_month(%L) $$, tests.month(3)),
  '22023', 'invalid_date', 'no month before the books'
);

-- Edit and void ------------------------------------------------------------------------------

select public.admin_save_stock_move(:'use1', tests.id('كلور'), tests.month(1) + 5, 'out', 2, null, null, 'تصحيح');
select is(
  tests.last_diff('stock_move.update'),
  jsonb_build_object(
    'quantity', jsonb_build_object('from', 3, 'to', 2),
    'note', jsonb_build_object('from', null, 'to', 'تصحيح'),
    'item_id', tests.id('كلور')
  ),
  'an edit logs what changed, with its item'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(%L, %L, %L, 'in', 2, null, null, null) $$,
    :'use1', tests.id('كلور'), tests.month(1) + 5),
  '22023', 'invalid_target', 'an edit keeps its kind'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(%L, %L, %L, 'out', 2, null, null, null) $$,
    :'use1', tests.id('كفوف'), tests.month(1) + 5),
  '22023', 'invalid_target', 'and its item'
);
select throws_ok(
  format($$ select public.admin_void_stock_move(%L, 'خطأ') $$, :'buy'),
  'ZL065', 'stock_too_low', 'a void that would leave the stock below zero is refused'
);
select throws_ok(
  format($$ select public.admin_void_stock_move(%L, ' ') $$, :'late'),
  'ZL011', 'reason_required', 'a void takes a reason'
);
select lives_ok(format($$ select public.admin_void_stock_move(%L, 'مكرر') $$, :'late'), 'an admin voids a record');
select is(
  tests.last_diff('stock_move.void'),
  jsonb_build_object('item_id', tests.id('كلور'), 'moved_on', tests.month(1) + 3, 'kind', 'in', 'quantity', 4, 'reason', 'مكرر'),
  'logged as stock_move.void'
);
select throws_ok(
  format($$ select public.admin_void_stock_move(%L, 'مرة ثانية') $$, :'late'),
  'ZL047', 'record_voided', 'once'
);
select throws_ok(
  format($$ select public.admin_save_stock_move(%L, %L, %L, 'in', 5, null, null, null) $$,
    :'late', tests.id('كلور'), tests.month(1) + 3),
  'ZL047', 'record_voided', 'and a voided record is not edited'
);

-- The start day and closed months ------------------------------------------------------------

select throws_ok(
  format($$ select public.admin_update_finance_settings(%L) $$, tests.month(1)),
  'ZL046', 'records_before_start', 'the start day does not move past a live record'
);
select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(1) - 1 where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_save_stock_move(null, %L, %L, 'in', 1, null, null, null) $$,
    tests.id('كفوف'), tests.month(2) + 2),
  'ZL054', 'month_closed', 'nothing is added in a closed month'
);
select throws_ok(
  format($$ select public.admin_void_stock_move(%L, 'خطأ') $$, tests.id('gloves in')),
  'ZL054', 'month_closed', 'nor voided'
);

select * from finish();
rollback;
