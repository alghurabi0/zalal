-- finance_accounts (the money boxes) and admin_save_finance_account (spec §7,
-- §8.3 A15 and A17; Phase 7, task 1).
--
-- The migration adds a cash box, a Zain Cash box and a bank box; every crew
-- gets its own box (kind crew, no name: it shows the crew's name), the ones
-- that exist and every new one. Admins read every box; guests, customers and
-- crews none (a crew not even its own). Nobody writes the table directly.
-- A crew's box goes with the crew, unless the box has records.
--
-- admin_save_finance_account(id, kind, name, opening_balance_iqd, active):
-- creates a box (id null; any kind but crew, 22023 invalid_kind; a name,
-- 22023 invalid_name) or changes one (null keeps a value). A crew box keeps
-- kind crew and no name. A taken name is ZL048 name_taken; a missing box
-- P0002 finance_account_not_found; an opening balance beyond ±1,000,000,000
-- 22023 invalid_amount. Logs finance_account.create / finance_account.update
-- with only what changed.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(38);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.box(p_name text) returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where name = p_name $$;
create function tests.crew_box() returns public.finance_accounts language sql stable security definer
as $$ select * from public.finance_accounts where crew_id = tests.id('crew') $$;
create function tests.account(p_id uuid) returns public.finance_accounts language sql stable security definer
as $$ select * from public.finance_accounts where id = p_id $$;
create function tests.audit_count(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure ----------------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.finance_accounts'::regclass),
  'RLS is on for finance_accounts'
);
select results_eq(
  $$ select kind::text from public.finance_accounts where crew_id is null order by kind $$,
  $$ values ('bank'), ('cash'), ('zain_cash') $$,
  'the migration adds a cash, a Zain Cash and a bank box'
);
select ok(
  (select bool_and(name is not null and active and opening_balance_iqd = 0)
   from public.finance_accounts where crew_id is null),
  'named, active and starting at zero'
);
select is(
  (select count(*)::int from public.crews as c
   where not exists (select 1 from public.finance_accounts as a where a.crew_id = c.id)),
  0,
  'every crew has a box'
);
select is((tests.crew_box()).kind, 'crew'::public.finance_account_kind, 'a new crew gets its box');
select is((tests.crew_box()).name, null, 'with no name of its own');
select throws_ok(
  $$ insert into public.finance_accounts (kind, name) values ('crew', 'عهدة') $$,
  '23514', null, 'a crew box needs its crew'
);
select throws_ok(
  $$ insert into public.finance_accounts (kind, crew_id, name) values ('cash', tests.id('crew'), 'صندوق') $$,
  '23514', null, 'only a crew box has a crew'
);
select throws_ok(
  $$ insert into public.finance_accounts (kind) values ('bank') $$,
  '23514', null, 'other boxes need a name'
);
select throws_ok(
  $$ insert into public.finance_accounts (kind, crew_id) values ('crew', tests.id('crew')) $$,
  '23505', null, 'one box per crew'
);

-- Reads --------------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.finance_accounts $$, '42501', null, 'a guest cannot read boxes');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.finance_accounts $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.finance_accounts $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.finance_accounts $$, 'nor a crew, not even its own box');
select tests.clear_authentication();
select count(*)::int as boxes from public.finance_accounts \gset
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.finance_accounts), :boxes, 'an admin reads every box');
select throws_ok(
  $$ insert into public.finance_accounts (kind, name) values ('bank', 'مباشر') $$,
  '42501', null, 'but cannot write the table directly'
);

-- admin_save_finance_account -----------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_save_finance_account(null, 'bank', 'مصرف الرافدين') $$,
  '42501', null, 'a guest cannot add a box'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_save_finance_account(null, 'bank', 'مصرف الرافدين') $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_save_finance_account((tests.crew_box()).id, p_opening_balance_iqd => 5000) $$,
  '42501', 'not_allowed', 'nor a crew, not even on its own box'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select public.admin_save_finance_account(null, 'bank', 'مصرف الرافدين', 250000) $$,
  'an admin adds a box'
);
select is((tests.account(tests.box('مصرف الرافدين'))).opening_balance_iqd, 250000, 'with its opening balance');
select is(
  tests.last_diff('finance_account.create'),
  jsonb_build_object('kind', 'bank', 'name', 'مصرف الرافدين', 'opening_balance_iqd', 250000, 'active', true),
  'logged as finance_account.create'
);
select throws_ok(
  $$ select public.admin_save_finance_account(null, 'crew', 'عهدة ثانية') $$,
  '22023', 'invalid_kind', 'crew boxes come only with their crew'
);
select throws_ok(
  $$ select public.admin_save_finance_account(null, 'cash', null) $$,
  '22023', 'invalid_name', 'a new box needs a name'
);
select throws_ok(
  $$ select public.admin_save_finance_account(null, 'bank', 'مصرف الرافدين') $$,
  'ZL048', 'name_taken', 'a taken name is refused'
);
select throws_ok(
  $$ select public.admin_save_finance_account(null, 'bank', 'مصرف كبير', 1000000001) $$,
  '22023', 'invalid_amount', 'an opening balance stays within a billion'
);
select lives_ok(
  $$ select public.admin_save_finance_account(tests.box('مصرف الرافدين'), null, 'مصرف الرشيد', -20000, false) $$,
  'an admin renames a box, changes its opening balance and switches it off'
);
select is(
  tests.last_diff('finance_account.update'),
  jsonb_build_object(
    'name', jsonb_build_object('from', 'مصرف الرافدين', 'to', 'مصرف الرشيد'),
    'opening_balance_iqd', jsonb_build_object('from', 250000, 'to', -20000),
    'active', jsonb_build_object('from', true, 'to', false)
  ),
  'logged with only what changed'
);
select lives_ok(
  $$ select public.admin_save_finance_account(tests.box('مصرف الرشيد')) $$,
  'saving without changes works'
);
select is(tests.audit_count('finance_account.update'), 1, 'and logs nothing');
select lives_ok(
  $$ select public.admin_save_finance_account((tests.crew_box()).id, p_opening_balance_iqd => 15000) $$,
  'a crew box takes an opening balance'
);
select is((tests.crew_box()).opening_balance_iqd, 15000, 'which is saved');
select throws_ok(
  $$ select public.admin_save_finance_account((tests.crew_box()).id, p_name => 'عهدة') $$,
  '22023', 'invalid_name', 'but no name of its own'
);
select throws_ok(
  $$ select public.admin_save_finance_account((tests.crew_box()).id, 'cash') $$,
  '22023', 'invalid_kind', 'and stays a crew box'
);
select throws_ok(
  $$ select public.admin_save_finance_account(tests.box('مصرف الرشيد'), 'crew') $$,
  '22023', 'invalid_kind', 'another box cannot become a crew box'
);
select throws_ok(
  $$ select public.admin_save_finance_account(gen_random_uuid(), null, 'مفقود') $$,
  'P0002', 'finance_account_not_found', 'a missing box is refused'
);

-- A crew's box goes with the crew, unless the box has records.
select tests.clear_authentication();
insert into tests.ids values ('crew2', tests.create_crew('+9647705555555'));
insert into tests.ids values ('crew3', tests.create_crew('+9647706666666'));
insert into public.expenses (spent_on, category_id, account_id, amount_iqd, created_by)
select current_date, (select id from public.expense_categories order by id limit 1), a.id, 1000,
  tests.user_id('+9647504444444')
from public.finance_accounts as a where a.crew_id = tests.id('crew3');
delete from public.crews where id = tests.id('crew2');
select is(
  (select count(*)::int from public.finance_accounts where crew_id = tests.id('crew2')), 0,
  'deleting a crew deletes its unused box'
);
select throws_ok(
  $$ delete from public.crews where id = tests.id('crew3') $$,
  '23503', null, 'but a box with records holds its crew back'
);

select * from finish();
rollback;
