-- stock_items, admin_save_stock_item, admin_delete_stock_item and
-- admin_stock_items (spec §7, §8.3 A23; Phase 7, task 6).
--
-- The things the company keeps in stock (chlorine, brushes, gloves…): a
-- name (2–60, unique), a unit (1–20 characters), a minimum (0 or more, up
-- to 2 decimals), an optional note and a switch. Quantities only: stock
-- carries no value in the books (settled Oct 31, 2026). Admins read them;
-- guests, customers and crews none. Nobody writes the table directly.
--
-- admin_save_stock_item(id, name, unit, min_quantity, note, active) adds or
-- changes one (22023 invalid_name / invalid_unit / invalid_quantity /
-- invalid_note, ZL048 name_taken, P0002 stock_item_not_found), logged as
-- stock_item.create / .update. admin_delete_stock_item(id) deletes one no
-- stock record uses, voided ones included (ZL045 item_in_use), logged as
-- stock_item.delete. admin_stock_items() lists each item with its quantity
-- now and whether it is low (switched on and at or below its minimum).
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(33);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = (date_trunc('month', tests.today()) - interval '1 month')::date,
  closed_through = null where s.id;

insert into public.stock_items (name, unit, min_quantity) values ('كلور', 'كيلو', 5);
insert into tests.ids select name, id from public.stock_items;

create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.stock_items'::regclass), 'RLS is on for stock_items');
select throws_ok(
  $$ insert into public.stock_items (name, unit, min_quantity) values ('سالب', 'قطعة', -1) $$,
  '23514', null, 'a minimum is never below zero'
);

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.stock_items $$, '42501', null, 'a guest cannot read stock items');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.stock_items $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.stock_items $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.stock_items $$, 'nor a crew');
select throws_ok($$ select * from public.admin_stock_items() $$, '42501', 'not_allowed', 'a crew cannot list stock');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.stock_items), 1, 'an admin reads them');
select throws_ok(
  $$ update public.stock_items set min_quantity = 0 where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_save_stock_item(null, 'فرش', 'قطعة', 2, null, true) $$,
  '42501', null, 'a guest cannot add an item'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_save_stock_item(null, 'فرش', 'قطعة', 2, null, true) $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_save_stock_item(null, 'فرش', 'قطعة', 2, null, true) $$,
  '42501', 'not_allowed', 'nor a crew'
);
select throws_ok(
  format($$ select public.admin_delete_stock_item(%L) $$, tests.id('كلور')),
  '42501', 'not_allowed', 'nor delete one'
);

-- Save ---------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_stock_item(null, 'فرش', 'قطعة', 2.5, 'فرش يدوية', true) as brush \gset
select is(
  tests.last_diff('stock_item.create'),
  jsonb_build_object('name', 'فرش', 'unit', 'قطعة', 'min_quantity', 2.5, 'note', 'فرش يدوية', 'active', true),
  'an admin adds an item, logged as stock_item.create'
);
select throws_ok(
  $$ select public.admin_save_stock_item(null, 'ك', 'قطعة', 0, null, true) $$,
  '22023', 'invalid_name', 'a name has 2–60 characters'
);
select throws_ok(
  $$ select public.admin_save_stock_item(null, ' كفوف', 'قطعة', 0, null, true) $$,
  '22023', 'invalid_name', 'with no spaces around it'
);
select throws_ok(
  $$ select public.admin_save_stock_item(null, 'كفوف', '', 0, null, true) $$,
  '22023', 'invalid_unit', 'a unit is required'
);
select throws_ok(
  $$ select public.admin_save_stock_item(null, 'كفوف', repeat('و', 21), 0, null, true) $$,
  '22023', 'invalid_unit', 'and at most 20 characters'
);
select throws_ok(
  $$ select public.admin_save_stock_item(null, 'كفوف', 'زوج', -1, null, true) $$,
  '22023', 'invalid_quantity', 'the minimum is not below zero'
);
select throws_ok(
  $$ select public.admin_save_stock_item(null, 'كفوف', 'زوج', 1.005, null, true) $$,
  '22023', 'invalid_quantity', 'and has at most 2 decimals'
);
select throws_ok(
  $$ select public.admin_save_stock_item(null, 'كلور', 'كيلو', 1, null, true) $$,
  'ZL048', 'name_taken', 'a name is unique'
);
select throws_ok(
  $$ select public.admin_save_stock_item(gen_random_uuid(), 'كفوف', 'زوج', 1, null, true) $$,
  'P0002', 'stock_item_not_found', 'a missing item'
);

select public.admin_save_stock_item(:'brush', 'فرش', 'قطعة', 3, null, false);
select is(
  tests.last_diff('stock_item.update'),
  jsonb_build_object(
    'min_quantity', jsonb_build_object('from', 2.5, 'to', 3),
    'note', jsonb_build_object('from', 'فرش يدوية', 'to', null),
    'active', jsonb_build_object('from', true, 'to', false)
  ),
  'an edit logs what changed as stock_item.update'
);
select is(
  (select row(unit, min_quantity, active)::text from public.stock_items where id = :'brush'),
  row('قطعة', 3.00, false)::text,
  'and saves it'
);

-- The list -----------------------------------------------------------------------------------

select tests.clear_authentication();
insert into public.stock_moves (item_id, moved_on, kind, quantity, created_by)
values (tests.id('كلور'), tests.today(), 'in', 7, tests.user_id('+9647504444444'));
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is(
  (select row(quantity, low)::text from public.admin_stock_items() where id = tests.id('كلور')),
  row(7.00, false)::text,
  'the list gives each item its quantity now'
);
select tests.clear_authentication();
insert into public.stock_moves (item_id, moved_on, kind, quantity, created_by)
values (tests.id('كلور'), tests.today(), 'out', 2, tests.user_id('+9647504444444'));
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is(
  (select row(quantity, low)::text from public.admin_stock_items() where id = tests.id('كلور')),
  row(5.00, true)::text,
  'and is low at its minimum'
);
select is(
  (select row(quantity, low)::text from public.admin_stock_items() where id = :'brush'),
  row(0.00, false)::text,
  'a switched-off item is never low'
);
select is(
  (select last_moved_on from public.admin_stock_items() where id = tests.id('كلور')),
  tests.today(),
  'and names the day of its last record'
);

-- Delete -------------------------------------------------------------------------------------

select throws_ok(
  format($$ select public.admin_delete_stock_item(%L) $$, tests.id('كلور')),
  'ZL045', 'item_in_use', 'an item with records is switched off, never deleted'
);
select tests.clear_authentication();
update public.stock_moves set voided_at = now(), voided_by = tests.user_id('+9647504444444'), void_reason = 'خطأ'
where item_id = tests.id('كلور');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_delete_stock_item(%L) $$, tests.id('كلور')),
  'ZL045', 'item_in_use', 'voided records count too'
);
select lives_ok(format($$ select public.admin_delete_stock_item(%L) $$, :'brush'), 'an unused item is deleted');
select is(
  tests.last_diff('stock_item.delete'),
  jsonb_build_object('name', 'فرش', 'unit', 'قطعة'),
  'logged as stock_item.delete'
);
select throws_ok(
  format($$ select public.admin_delete_stock_item(%L) $$, :'brush'),
  'P0002', 'stock_item_not_found', 'once'
);

select * from finish();
rollback;
