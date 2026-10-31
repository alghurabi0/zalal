-- RLS audit of migration finance_payroll (spec §7 "Accounting", §8.3 A21;
-- Phase 7, task 4). No hole found: these are the checks the audit ran that
-- the payroll tests (workers, worker_crews, worker_rates,
-- payroll_adjustments, worker_days, payroll_expenses, admin_payroll) don't
-- already make.
--
-- 1. Privileges: no API role uses the payroll identity sequences, no payroll
--    table is in the Realtime publication, guests run none of the payroll
--    RPCs, and an admin writes expenses.worker_id only through
--    admin_save_expense.
-- 2. A demoted admin (now a customer) reads no worker and runs no payroll
--    RPC; a crew can't list its workers' crew days.
-- 3. Month close: a new worker can't bring an opening balance while a month
--    is closed (it would change every closed month's balance); a wage dated
--    in a closed month keeps its worker; a membership that started in a
--    closed month keeps its crew and first day, while a membership that
--    ended on the closed month's last day may run on (only open days move).
--
-- Not testable here (two transactions): admin_save_worker_crew on an
-- existing row locked the membership, then the worker, while
-- admin_move_worker locks the worker, then the current membership; run
-- together for one worker they deadlocked (40P01). Fixed before merge:
-- every membership writer now locks the worker first.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(17);

select tests.create_user('+9647801111111');            -- customer
select tests.create_user('+9647504444444', 'admin');
select tests.create_user('+9647504444445', 'admin');   -- demoted below
insert into tests.ids values
  ('crew_a', tests.create_crew('+9647703333333')),
  ('crew_b', tests.create_crew('+9647703333334'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;

insert into public.workers (name) values ('علي'), ('حسن');
insert into tests.ids select name, id from public.workers;
insert into public.expense_categories (name, kind) values ('أجور تدقيق', 'wages');

create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.wages() returns bigint language sql stable security definer
as $$ select id from public.expense_categories where name = 'أجور تدقيق' $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Records in what becomes the closed months, made while they are open.
select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_expense(
  null, tests.month(1) + 3, tests.wages(), tests.cash(), 40000, null, tests.id('علي')
) as wage \gset
select public.admin_save_worker_crew(null, tests.id('علي'), tests.id('crew_a'), tests.month(2), null) as ali_m \gset
select public.admin_save_worker_crew(
  null, tests.id('حسن'), tests.id('crew_a'), tests.month(2), tests.month(0) - 1
) as hasan_m \gset
select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(0) - 1 where s.id;

-- 1. Privileges --------------------------------------------------------------------------------

select ok(
  not exists (
    select 1
    from unnest(array['worker_crews_id_seq', 'worker_rates_id_seq', 'payroll_adjustments_id_seq']) as s(name)
    cross join unnest(array['anon', 'authenticated']) as r(role)
    where has_sequence_privilege(r.role, 'public.' || s.name, 'usage')
      or has_sequence_privilege(r.role, 'public.' || s.name, 'update')
  ),
  'no API role uses the payroll identity sequences'
);
select is_empty(
  $$ select tablename from pg_publication_tables
     where pubname = 'supabase_realtime'
       and tablename in ('workers', 'worker_crews', 'worker_rates', 'payroll_adjustments', 'worker_days', 'expenses') $$,
  'no payroll table sends Realtime events'
);
select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_proc as p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in (
         'admin_save_worker', 'admin_save_worker_crew', 'admin_move_worker', 'admin_delete_worker_crew',
         'admin_save_worker_rate', 'admin_void_worker_rate', 'admin_save_payroll_adjustment',
         'admin_void_payroll_adjustment', 'admin_set_worker_days', 'admin_save_expense',
         'admin_worker_crew_days', 'admin_payroll'
       )
       and has_function_privilege('anon', p.oid, 'execute') $$,
  'guests run none of the payroll RPCs'
);
select ok(
  not has_column_privilege('authenticated', 'public.expenses', 'worker_id', 'update')
    and not has_column_privilege('authenticated', 'public.expenses', 'worker_id', 'insert'),
  'no API role writes expenses.worker_id directly'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ update public.expenses set worker_id = %L where id = %L $$, tests.id('حسن'), :'wage'),
  '42501', null, 'not even an admin moves a wage to another worker by hand'
);

-- 2. Demoted admin, crew -----------------------------------------------------------------------

select tests.clear_authentication();
update public.profiles set role = 'customer' where id = tests.user_id('+9647504444445');
select tests.authenticate_as(tests.user_id('+9647504444445'));
select is_empty($$ select * from public.workers $$, 'a demoted admin reads no worker');
select throws_ok(
  $$ select public.admin_save_worker(null, 'عامل جديد') $$,
  '42501', 'not_allowed', 'nor adds one'
);
select throws_ok(
  format($$ select * from public.admin_payroll(%L, %L) $$, tests.month(1), tests.month(0)),
  '42501', 'not_allowed', 'nor reads the payroll'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  format($$ select * from public.admin_worker_crew_days(%L, %L) $$, tests.id('علي'), tests.month(0)),
  '42501', 'not_allowed', 'a crew does not list its own worker''s days'
);

-- 3. Month close -------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.admin_save_worker(null, 'عامل بسلفة', null, null, -50000) $$,
  'ZL056', 'books_closed', 'a new worker brings no opening balance while a month is closed'
);
select lives_ok(
  $$ select public.admin_save_worker(null, 'عامل بلا رصيد') $$,
  'a new worker with none is fine'
);
select throws_ok(
  format($$ select public.admin_save_expense(%L, %L, %s, %L, 40000, null, %L) $$,
    :'wage', tests.month(1) + 3, tests.wages(), tests.cash(), tests.id('حسن')),
  'ZL054', 'month_closed', 'a wage in a closed month keeps its worker'
);
select throws_ok(
  format($$ select public.admin_save_expense(%L, %L, %s, %L, 40000, null, null) $$,
    :'wage', tests.month(1) + 3, tests.wages(), tests.cash()),
  'ZL054', 'month_closed', 'and is not unlinked'
);
select throws_ok(
  format($$ select public.admin_save_worker_crew(%s, %L, %L, %L, null) $$,
    :ali_m, tests.id('علي'), tests.id('crew_b'), tests.month(2)),
  'ZL054', 'month_closed', 'a membership that started in a closed month keeps its crew'
);
select throws_ok(
  format($$ select public.admin_save_worker_crew(%s, %L, %L, %L, null) $$,
    :ali_m, tests.id('علي'), tests.id('crew_a'), tests.month(1) + 5),
  'ZL054', 'month_closed', 'and its first day'
);
select lives_ok(
  format($$ select public.admin_save_worker_crew(%s, %L, %L, %L, null) $$,
    :hasan_m, tests.id('حسن'), tests.id('crew_a'), tests.month(2)),
  'a membership that ended on the closed month''s last day runs on (only open days change)'
);
select is(
  (select m.to_on from public.worker_crews as m where m.id = :hasan_m),
  null::date,
  'and is current again'
);

select * from finish();
rollback;
