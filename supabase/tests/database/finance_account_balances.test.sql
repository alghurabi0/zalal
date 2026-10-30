-- finance_account_balances (spec §7, §8.3 A15; Phase 7, task 1): each box's
-- balance = opening balance + transfers in − transfers out − expenses, voided
-- records left out. A view with security_invoker, so the boxes' rules hold:
-- admins read every balance; guests, customers and crews none.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(9);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.crew_box() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where crew_id = tests.id('crew') $$;
create function tests.cat() returns bigint language sql stable security definer
as $$ select id from public.expense_categories order by id limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

update public.finance_accounts set opening_balance_iqd = 100000 where id = tests.cash();
update public.finance_accounts set opening_balance_iqd = 20000 where id = tests.crew_box();
insert into public.expenses (spent_on, category_id, account_id, amount_iqd, created_by)
values
  (current_date, tests.cat(), tests.cash(), 30000, tests.user_id('+9647504444444')),
  (current_date, tests.cat(), tests.crew_box(), 5000, tests.user_id('+9647504444444'));
insert into public.expenses (spent_on, category_id, account_id, amount_iqd, created_by, voided_at, voided_by, void_reason)
values (current_date, tests.cat(), tests.cash(), 999000, tests.user_id('+9647504444444'), now(), tests.user_id('+9647504444444'), 'غلط');
insert into public.finance_transfers (moved_on, from_account_id, to_account_id, amount_iqd, created_by)
values (current_date, tests.crew_box(), tests.cash(), 10000, tests.user_id('+9647504444444'));
insert into public.finance_transfers (moved_on, from_account_id, to_account_id, amount_iqd, created_by, voided_at, voided_by, void_reason)
values (current_date, tests.cash(), tests.crew_box(), 777000, tests.user_id('+9647504444444'), now(), tests.user_id('+9647504444444'), 'غلط');

select is(
  (select c.relkind::text from pg_class as c where c.oid = 'public.finance_account_balances'::regclass),
  'v', 'finance_account_balances is a view'
);
select ok(
  (select 'security_invoker=true' = any (c.reloptions) from pg_class as c
   where c.oid = 'public.finance_account_balances'::regclass),
  'with security_invoker'
);

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.finance_account_balances $$, '42501', null, 'a guest cannot read balances');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.finance_account_balances $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.finance_account_balances $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.finance_account_balances $$, 'nor a crew, not even its own');

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is(
  (select balance_iqd from public.finance_account_balances where account_id = tests.cash()),
  80000::bigint,
  'cash: 100,000 opening − 30,000 spent + 10,000 handed in; voided records left out'
);
select is(
  (select balance_iqd from public.finance_account_balances where account_id = tests.crew_box()),
  5000::bigint,
  'the crew box: 20,000 opening − 5,000 spent − 10,000 handed in'
);
select is(
  (select count(*)::int from public.finance_account_balances),
  (select count(*)::int from public.finance_accounts),
  'every box has a balance'
);

select * from finish();
rollback;
