-- admin_expense_summary(from, to, voided, category_id, account_id, words)
-- (spec §8.3 A16; Phase 7, task 2): the count and total of the expenses A16
-- lists, in SQL rather than summed by the app a page at a time. The same
-- filters: the days, voided or live, a category, a box, words in the note
-- (any case; % and _ are plain characters). Admins only (42501 otherwise).
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(9);

select tests.create_user('+9647801111111');
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));
update public.finance_settings as s set start_on = tests.today() - 60 where s.id;

create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.cat(p_name text) returns bigint language sql stable security definer
as $$ select id from public.expense_categories where name = p_name $$;
grant execute on all functions in schema tests to anon, authenticated;

insert into public.expenses (spent_on, category_id, account_id, amount_iqd, note, created_by)
values
  (tests.today(), tests.cat('وقود ونقل'), tests.cash(), 10000, 'Benzin 100%', tests.user_id('+9647504444444')),
  (tests.today(), tests.cat('وقود ونقل'), tests.cash(), 5000, 'بانزين', tests.user_id('+9647504444444')),
  (tests.today(), tests.cat('إيجار ومكتب'), tests.cash(), 300000, null, tests.user_id('+9647504444444')),
  (tests.today() - 40, tests.cat('وقود ونقل'), tests.cash(), 7000, null, tests.user_id('+9647504444444'));
insert into public.expenses (spent_on, category_id, account_id, amount_iqd, created_by, voided_at, voided_by, void_reason)
values (tests.today(), tests.cat('وقود ونقل'), tests.cash(), 2000, tests.user_id('+9647504444444'), now(),
  tests.user_id('+9647504444444'), 'مكرر');

select tests.authenticate_as(tests.user_id('+9647504444444'));
select results_eq(
  $$ select count::int, total::int from public.admin_expense_summary(tests.today() - 1, tests.today(), false, null, null, null) $$,
  $$ values (3, 315000) $$,
  'the live expenses of the days'
);
select results_eq(
  $$ select count::int, total::int from public.admin_expense_summary(tests.today() - 1, tests.today(), true, null, null, null) $$,
  $$ values (1, 2000) $$,
  'or the voided ones'
);
select results_eq(
  $$ select count::int, total::int
     from public.admin_expense_summary(tests.today() - 1, tests.today(), false, tests.cat('وقود ونقل'), tests.cash(), null) $$,
  $$ values (2, 15000) $$,
  'a category and a box'
);
select results_eq(
  $$ select count::int, total::int from public.admin_expense_summary(tests.today() - 1, tests.today(), false, null, null, 'benzin') $$,
  $$ values (1, 10000) $$,
  'words in the note, any case'
);
select results_eq(
  $$ select count::int, total::int from public.admin_expense_summary(tests.today() - 1, tests.today(), false, null, null, '0%') $$,
  $$ values (1, 10000) $$,
  'with % as a plain character'
);
select results_eq(
  $$ select count::int, total::int from public.admin_expense_summary(tests.today(), tests.today(), false, null, gen_random_uuid(), null) $$,
  $$ values (0, 0) $$,
  'nothing matching is zero'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select * from public.admin_expense_summary(current_date, current_date, false, null, null, null) $$,
  '42501', 'not_allowed', 'a customer cannot read it'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select * from public.admin_expense_summary(current_date, current_date, false, null, null, null) $$,
  '42501', 'not_allowed', 'nor a crew'
);
select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.admin_expense_summary(current_date, current_date, false, null, null, null) $$,
  '42501', null, 'nor a guest'
);

select * from finish();
rollback;
