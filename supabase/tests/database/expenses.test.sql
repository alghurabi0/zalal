-- expenses, admin_save_expense and admin_void_expense (spec §7, §8.3 A16;
-- Phase 7, task 1).
--
-- Admins read every expense, voided ones too; guests, customers and crews
-- none. Nobody writes the table directly.
--
-- admin_save_expense(id, spent_on, category_id, account_id, amount_iqd,
-- note): records (id null) or edits an expense. The day is between the
-- books' start (ZL042 before_finance_start) and today in Baghdad (ZL043
-- date_in_future); the amount 1–1,000,000,000 (22023 invalid_amount); the
-- note optional, at most 300 characters (22023 invalid_note), blank = none.
-- A switched-off category or box is refused for a new expense or a change
-- to it (ZL044 category_inactive / account_inactive), and kept when an edit
-- leaves it as it was. A voided expense can't be edited (ZL047
-- record_voided). P0002 expense_not_found, category_not_found,
-- finance_account_not_found. Logs expense.create / expense.update (only what
-- changed).
-- admin_void_expense(id, reason): a reason of 1–300 characters (ZL011
-- reason_required); once only (ZL047). Logs expense.void.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(40);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.today() - 30 where s.id;
insert into public.finance_accounts (kind, name, active) values ('bank', 'مصرف مطفأ', false);
insert into public.expense_categories (name, active) values ('باب مطفأ', false);

create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.box(p_name text) returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where name = p_name $$;
create function tests.crew_box() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where crew_id = tests.id('crew') $$;
create function tests.cat(p_name text) returns bigint language sql stable security definer
as $$ select id from public.expense_categories where name = p_name $$;
create function tests.expense(p_id uuid) returns public.expenses language sql stable security definer
as $$ select * from public.expenses where id = p_id $$;
create function tests.audit_count(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.expenses'::regclass),
  'RLS is on for expenses'
);
select throws_ok(
  $$ insert into public.expenses (spent_on, category_id, account_id, amount_iqd, created_by)
     values (current_date, tests.cat('وقود ونقل'), tests.cash(), 0, tests.user_id('+9647504444444')) $$,
  '23514', null, 'an amount is positive'
);
select throws_ok(
  $$ insert into public.expenses (spent_on, category_id, account_id, amount_iqd, created_by, voided_at)
     values (current_date, tests.cat('وقود ونقل'), tests.cash(), 1000, tests.user_id('+9647504444444'), now()) $$,
  '23514', null, 'a voided expense names who voided it and why'
);

insert into public.expenses (spent_on, category_id, account_id, amount_iqd, note, created_by)
values (tests.today(), tests.cat('وقود ونقل'), tests.crew_box(), 12000, 'بانزين', tests.user_id('+9647504444444'));

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.expenses $$, '42501', null, 'a guest cannot read expenses');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.expenses $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.expenses $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.expenses $$, 'nor a crew, not even one paid from its box');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.expenses), 1, 'an admin reads them');
select throws_ok(
  $$ update public.expenses set amount_iqd = 1 where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_save_expense(null, current_date, tests.cat('وقود ونقل'), tests.cash(), 5000, null) $$,
  '42501', null, 'a guest cannot record an expense'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_save_expense(null, current_date, tests.cat('وقود ونقل'), tests.cash(), 5000, null) $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_save_expense(null, current_date, tests.cat('وقود ونقل'), tests.crew_box(), 5000, null) $$,
  '42501', 'not_allowed', 'nor a crew, not even from its own box'
);
select throws_ok(
  $$ select public.admin_void_expense((select id from public.expenses limit 1), 'غلط') $$,
  '42501', 'not_allowed', 'and a crew cannot void one'
);

-- Save ---------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_expense(
  null, tests.today() - 2, tests.cat('مواد تعقيم وكلور'), tests.cash(), 45000, '  جلنين كلور  '
) as first \gset
select isnt(:'first'::uuid, null::uuid, 'an admin records an expense');
select is((tests.expense(:'first')).note, 'جلنين كلور', 'the note is trimmed');
select is((tests.expense(:'first')).created_by, tests.user_id('+9647504444444'), 'and names who recorded it');
select is(
  tests.last_diff('expense.create'),
  jsonb_build_object(
    'spent_on', tests.today() - 2, 'category_id', tests.cat('مواد تعقيم وكلور'),
    'account_id', tests.cash(), 'amount_iqd', 45000, 'note', 'جلنين كلور'
  ),
  'logged as expense.create'
);
select is(
  (tests.expense(public.admin_save_expense(null, tests.today(), tests.cat('وقود ونقل'), tests.cash(), 3000, '   '))).note,
  null, 'a blank note is none'
);
select throws_ok(
  $$ select public.admin_save_expense(null, tests.today() + 1, tests.cat('وقود ونقل'), tests.cash(), 5000, null) $$,
  'ZL043', 'date_in_future', 'a day after today is refused'
);
select throws_ok(
  $$ select public.admin_save_expense(null, tests.today() - 31, tests.cat('وقود ونقل'), tests.cash(), 5000, null) $$,
  'ZL042', 'before_finance_start', 'so is a day before the books start'
);
select lives_ok(
  $$ select public.admin_save_expense(null, tests.today() - 30, tests.cat('وقود ونقل'), tests.cash(), 5000, null) $$,
  'the start day itself is fine'
);
select throws_ok(
  $$ select public.admin_save_expense(null, current_date, tests.cat('وقود ونقل'), tests.cash(), 0, null) $$,
  '22023', 'invalid_amount', 'an amount is positive'
);
select throws_ok(
  $$ select public.admin_save_expense(null, current_date, tests.cat('وقود ونقل'), tests.cash(), 1000000001, null) $$,
  '22023', 'invalid_amount', 'and at most a billion'
);
select throws_ok(
  $$ select public.admin_save_expense(null, current_date, tests.cat('وقود ونقل'), tests.cash(), 5000, repeat('ا', 301)) $$,
  '22023', 'invalid_note', 'a note is at most 300 characters'
);
select throws_ok(
  $$ select public.admin_save_expense(null, current_date, tests.cat('باب مطفأ'), tests.cash(), 5000, null) $$,
  'ZL044', 'category_inactive', 'a switched-off category is refused'
);
select throws_ok(
  $$ select public.admin_save_expense(null, current_date, tests.cat('وقود ونقل'), tests.box('مصرف مطفأ'), 5000, null) $$,
  'ZL044', 'account_inactive', 'so is a switched-off box'
);
select throws_ok(
  $$ select public.admin_save_expense(null, current_date, 999999, tests.cash(), 5000, null) $$,
  'P0002', 'category_not_found', 'a missing category is refused'
);
select throws_ok(
  $$ select public.admin_save_expense(null, current_date, tests.cat('وقود ونقل'), gen_random_uuid(), 5000, null) $$,
  'P0002', 'finance_account_not_found', 'so is a missing box'
);

-- Edit ---------------------------------------------------------------------------------------

select lives_ok(
  format(
    $$ select public.admin_save_expense(%L, %L, %s, %L, 40000, 'جلنين كلور') $$,
    :'first', tests.today() - 2, tests.cat('مواد تعقيم وكلور'), tests.crew_box()
  ),
  'an admin edits an expense'
);
select is(
  tests.last_diff('expense.update'),
  jsonb_build_object(
    'account_id', jsonb_build_object('from', tests.cash(), 'to', tests.crew_box()),
    'amount_iqd', jsonb_build_object('from', 45000, 'to', 40000)
  ),
  'logged with only what changed'
);
select lives_ok(
  format(
    $$ select public.admin_save_expense(%L, %L, %s, %L, 40000, 'جلنين كلور') $$,
    :'first', tests.today() - 2, tests.cat('مواد تعقيم وكلور'), tests.crew_box()
  ),
  'saving without changes works'
);
select is(tests.audit_count('expense.update'), 1, 'and logs nothing');

-- A category switched off after the expense was recorded stays on it.
select tests.clear_authentication();
update public.expense_categories set active = false where id = tests.cat('مواد تعقيم وكلور');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  format(
    $$ select public.admin_save_expense(%L, %L, %s, %L, 41000, 'جلنين كلور') $$,
    :'first', tests.today() - 2, tests.cat('مواد تعقيم وكلور'), tests.crew_box()
  ),
  'an edit keeps a category switched off since'
);
select throws_ok(
  $$ select public.admin_save_expense(gen_random_uuid(), current_date, tests.cat('وقود ونقل'), tests.cash(), 5000, null) $$,
  'P0002', 'expense_not_found', 'a missing expense is refused'
);

-- Void ---------------------------------------------------------------------------------------

select throws_ok(
  format($$ select public.admin_void_expense(%L, '  ') $$, :'first'),
  'ZL011', 'reason_required', 'voiding needs a reason'
);
select lives_ok(
  format($$ select public.admin_void_expense(%L, 'انسجل مرتين') $$, :'first'),
  'an admin voids an expense'
);
select ok(
  (select voided_at is not null and voided_by = tests.user_id('+9647504444444') and void_reason = 'انسجل مرتين'
   from public.expenses where id = :'first'),
  'it keeps who voided it, when and why'
);
select is(
  tests.last_diff('expense.void'),
  jsonb_build_object(
    'spent_on', tests.today() - 2, 'amount_iqd', 41000, 'reason', 'انسجل مرتين'
  ),
  'logged as expense.void'
);
select throws_ok(
  format($$ select public.admin_void_expense(%L, 'مرة ثانية') $$, :'first'),
  'ZL047', 'record_voided', 'a voided expense cannot be voided again'
);
select throws_ok(
  format(
    $$ select public.admin_save_expense(%L, %L, %s, %L, 1000, null) $$,
    :'first', tests.today() - 2, tests.cat('وقود ونقل'), tests.cash()
  ),
  'ZL047', 'record_voided', 'nor edited'
);

select * from finish();
rollback;
