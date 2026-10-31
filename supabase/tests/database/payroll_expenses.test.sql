-- expenses.worker_id: a wage paid to a worker (spec §7, §8.3 A16 and A21;
-- Phase 7, task 4).
--
-- admin_save_expense takes an optional worker (its 7th argument, so older
-- calls keep working): only on a category of kind wages (ZL057
-- worker_not_allowed), any worker, switched on or off (no ZL044
-- worker_inactive was dropped: a switched-off worker is still paid what
-- they're owed), P0002 worker_not_found.
-- A wage with no worker stays allowed (casual labour). The link is logged
-- with the expense (worker_id in expense.create when set, and in
-- expense.update when it changes). A category with live linked expenses
-- doesn't change its kind away from wages (ZL057). Guests, customers and
-- crews still can't save an expense.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(16);

select tests.create_user('+9647801111111');            -- customer
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.today() - 30, closed_through = null where s.id;

insert into public.workers (name) values ('علي'), ('موقوف');
insert into tests.ids select name, id from public.workers;
insert into public.expense_categories (name, kind) values ('أجور مؤقتة', 'wages');

create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.wages() returns bigint language sql stable security definer
as $$ select id from public.expense_categories where name = 'أجور مؤقتة' $$;
create function tests.fuel() returns bigint language sql stable security definer
as $$ select id from public.expense_categories where kind = 'general' order by id limit 1 $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  format($$ select public.admin_save_expense(null, current_date, %s, %L, 50000, null, %L) $$, tests.wages(), tests.cash(), tests.id('علي')),
  '42501', null, 'a guest cannot pay a worker'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  format($$ select public.admin_save_expense(null, current_date, %s, %L, 50000, null, %L) $$, tests.wages(), tests.cash(), tests.id('علي')),
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  format($$ select public.admin_save_expense(null, current_date, %s, %L, 50000, null, %L) $$, tests.wages(), tests.cash(), tests.id('علي')),
  '42501', 'not_allowed', 'nor a crew'
);

-- Linking ------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_expense(null, tests.today(), tests.wages(), tests.cash(), 50000, null, tests.id('علي')) as paid \gset
select is(
  (select e.worker_id from public.expenses as e where e.id = :'paid'),
  tests.id('علي'),
  'an admin pays a worker with a wage expense'
);
select is(
  tests.last_diff('expense.create') -> 'worker_id',
  to_jsonb(tests.id('علي')),
  'the worker is logged with the expense'
);
select public.admin_save_expense(null, tests.today(), tests.wages(), tests.cash(), 20000, 'عامل يومية') as casual \gset
select is(
  (select e.worker_id from public.expenses as e where e.id = :'casual'),
  null,
  'a wage may have no worker (casual labour)'
);
select ok(
  not (tests.last_diff('expense.create') ? 'worker_id'),
  'and then logs none'
);
select throws_ok(
  format($$ select public.admin_save_expense(null, current_date, %s, %L, 50000, null, %L) $$, tests.fuel(), tests.cash(), tests.id('علي')),
  'ZL057', 'worker_not_allowed', 'only a wage names a worker'
);
select throws_ok(
  format($$ select public.admin_save_expense(null, current_date, %s, %L, 50000, null, gen_random_uuid()) $$, tests.wages(), tests.cash()),
  'P0002', 'worker_not_found', 'a missing worker is refused'
);

select tests.clear_authentication();
update public.workers set active = false where name in ('علي', 'موقوف');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_expense(null, current_date, tests.wages(), tests.cash(), 50000, null, tests.id('موقوف')) as settled \gset
select is(
  (select e.worker_id from public.expenses as e where e.id = :'settled'),
  tests.id('موقوف'),
  'a switched-off worker is still paid what they''re owed'
);
select lives_ok(
  format($$ select public.admin_save_expense(%L, %L, %s, %L, 45000, null, %L) $$, :'paid', tests.today(), tests.wages(), tests.cash(), tests.id('علي')),
  'an edit that keeps a switched-off worker goes through'
);
select lives_ok(
  format($$ select public.admin_save_expense(%L, %L, %s, %L, 45000, null, %L) $$, :'paid', tests.today(), tests.wages(), tests.cash(), tests.id('موقوف')),
  'and a wage moves to a switched-off worker'
);
select lives_ok(
  format($$ select public.admin_save_expense(%L, %L, %s, %L, 45000, null, null) $$, :'paid', tests.today(), tests.wages(), tests.cash()),
  'an admin unlinks the worker'
);
select is(
  tests.last_diff('expense.update'),
  jsonb_build_object('worker_id', jsonb_build_object('from', tests.id('موقوف'), 'to', null)),
  'logged as the change'
);

-- The category's kind ------------------------------------------------------------------------

select tests.clear_authentication();
update public.workers set active = true where name = 'علي';
select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_expense(:'paid', tests.today(), tests.wages(), tests.cash(), 45000, null, tests.id('علي'));
select throws_ok(
  format($$ select public.admin_save_expense_category(%s, null, 'general', null) $$, tests.wages()),
  'ZL057', 'worker_not_allowed', 'a category paying a worker stays a wages category'
);
select public.admin_void_expense(:'paid', 'غلط');
select public.admin_void_expense(:'settled', 'غلط');
select lives_ok(
  format($$ select public.admin_save_expense_category(%s, null, 'general', null) $$, tests.wages()),
  'once that wage is voided, the kind changes'
);

select * from finish();
rollback;
