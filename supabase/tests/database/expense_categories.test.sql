-- expense_categories, admin_save_expense_category and
-- admin_delete_expense_category (spec §7, §8.3 A17; Phase 7, task 1).
--
-- The migration adds nine categories (wages and equipment have their own
-- kind, for payroll and equipment in later phases). Admins read them;
-- guests, customers and crews don't. Nobody writes the table directly.
--
-- admin_save_expense_category(id, name, kind, active): creates (id null;
-- general and active unless given) or changes a category (null keeps a
-- value). ZL048 name_taken; P0002 category_not_found. Logs
-- expense_category.create / expense_category.update with only what changed.
-- admin_delete_expense_category(id): refused while any expense, voided or
-- not, uses it (ZL045 category_in_use; switch it off instead). Logs
-- expense_category.delete.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(28);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

create function tests.cat(p_name text) returns bigint language sql stable security definer
as $$ select id from public.expense_categories where name = p_name $$;
create function tests.category(p_id bigint) returns public.expense_categories language sql stable security definer
as $$ select * from public.expense_categories where id = p_id $$;
create function tests.audit_count(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure ----------------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.expense_categories'::regclass),
  'RLS is on for expense_categories'
);
select is((select count(*)::int from public.expense_categories), 9, 'the migration adds nine categories');
select results_eq(
  $$ select kind::text, count(*)::int from public.expense_categories group by kind order by kind $$,
  $$ values ('equipment', 1), ('general', 7), ('wages', 1) $$,
  'one for wages and one for equipment'
);
select throws_ok(
  $$ insert into public.expense_categories (name) values (' فراغ') $$,
  '23514', null, 'names are trimmed'
);
select throws_ok(
  $$ insert into public.expense_categories (name) values ('مواد تعقيم وكلور') $$,
  '23505', null, 'and unique'
);

-- Reads --------------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.expense_categories $$, '42501', null, 'a guest cannot read them');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.expense_categories $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.expense_categories $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.expense_categories $$, 'nor a crew');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.expense_categories), 9, 'an admin reads them all');
select throws_ok(
  $$ insert into public.expense_categories (name) values ('مباشر') $$,
  '42501', null, 'but cannot write the table directly'
);

-- Save ---------------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_save_expense_category(null, 'كهرباء') $$,
  '42501', null, 'a guest cannot add a category'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_save_expense_category(null, 'كهرباء') $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_delete_expense_category(tests.cat('مصاريف أخرى')) $$,
  '42501', 'not_allowed', 'a crew cannot delete one'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok($$ select public.admin_save_expense_category(null, 'كهرباء') $$, 'an admin adds a category');
select is((tests.category(tests.cat('كهرباء'))).kind, 'general'::public.expense_category_kind, 'general by default');
select is(
  tests.last_diff('expense_category.create'),
  jsonb_build_object('name', 'كهرباء', 'kind', 'general', 'active', true),
  'logged as expense_category.create'
);
select throws_ok(
  $$ select public.admin_save_expense_category(null, 'وقود ونقل') $$,
  'ZL048', 'name_taken', 'a taken name is refused'
);
select throws_ok(
  $$ select public.admin_save_expense_category(tests.cat('كهرباء'), 'وقود ونقل') $$,
  'ZL048', 'name_taken', 'also on rename'
);
select lives_ok(
  $$ select public.admin_save_expense_category(tests.cat('كهرباء'), 'كهرباء ومولدة', null, false) $$,
  'an admin renames a category and switches it off'
);
select is(
  tests.last_diff('expense_category.update'),
  jsonb_build_object(
    'name', jsonb_build_object('from', 'كهرباء', 'to', 'كهرباء ومولدة'),
    'active', jsonb_build_object('from', true, 'to', false)
  ),
  'logged with only what changed'
);
select lives_ok(
  $$ select public.admin_save_expense_category(tests.cat('كهرباء ومولدة')) $$,
  'saving without changes works'
);
select is(tests.audit_count('expense_category.update'), 1, 'and logs nothing');
select throws_ok(
  $$ select public.admin_save_expense_category(999999, 'مفقودة') $$,
  'P0002', 'category_not_found', 'a missing category is refused'
);

-- Delete -------------------------------------------------------------------------------------

select tests.clear_authentication();
insert into public.expenses (spent_on, category_id, account_id, amount_iqd, created_by, voided_at, voided_by, void_reason)
select tests.today(), tests.cat('مصاريف أخرى'), a.id, 1000, tests.user_id('+9647504444444'),
  now(), tests.user_id('+9647504444444'), 'غلط'
from public.finance_accounts as a where a.kind = 'cash' limit 1;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.admin_delete_expense_category(tests.cat('مصاريف أخرى')) $$,
  'ZL045', 'category_in_use', 'a category a voided expense uses is still refused'
);
select lives_ok(
  $$ select public.admin_delete_expense_category(tests.cat('كهرباء ومولدة')) $$,
  'an admin deletes an unused category'
);
select is(tests.cat('كهرباء ومولدة'), null, 'it is gone');
select is(
  tests.last_diff('expense_category.delete'), jsonb_build_object('name', 'كهرباء ومولدة'),
  'logged as expense_category.delete'
);

select * from finish();
rollback;
