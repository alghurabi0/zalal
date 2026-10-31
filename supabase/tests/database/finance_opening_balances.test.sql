-- Box opening balances while a month is closed (spec §8.3 A17, §13; Phase 7,
-- task 5).
--
-- The balance sheet (A22) shows a box's balance at a past month's end, so a
-- box's opening balance now holds while any month is closed (ZL056
-- books_closed), like the start day and the worker and partner opening
-- balances: no change to one, and no new box with one. Everything else
-- about a box still changes.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(5);

select tests.create_user('+9647504444444', 'admin');
update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;
insert into public.finance_accounts (kind, name, opening_balance_iqd) values ('cash', 'قاصة الافتتاح', 1000);
insert into tests.ids select name, id from public.finance_accounts where name = 'قاصة الافتتاح';
grant execute on all functions in schema tests to anon, authenticated;

select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  format($$ select public.admin_save_finance_account(%L, null, null, 2000, null) $$, tests.id('قاصة الافتتاح')),
  'an opening balance changes while no month is closed'
);

select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(1) - 1 where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_save_finance_account(%L, null, null, 3000, null) $$, tests.id('قاصة الافتتاح')),
  'ZL056', 'books_closed', 'it holds while a month is closed'
);
select throws_ok(
  $$ select public.admin_save_finance_account(null, 'bank', 'مصرف جديد', 500, null) $$,
  'ZL056', 'books_closed', 'so a new box starts with none'
);
select lives_ok(
  format($$ select public.admin_save_finance_account(%L, null, 'قاصة المكتب', 2000, null) $$, tests.id('قاصة الافتتاح')),
  'the rest of a box still changes'
);
select isnt(
  (select public.admin_save_finance_account(null, 'bank', 'مصرف جديد', 0, null)), null,
  'and a box with no opening balance is added'
);

select * from finish();
rollback;
