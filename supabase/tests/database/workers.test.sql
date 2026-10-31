-- workers and admin_save_worker (spec §7, §8.3 A21; Phase 7, task 4).
--
-- Workers are internal records for payroll, with no login: a name (2–60,
-- unique), an optional phone (E.164), an optional note (≤ 300), an opening
-- balance at the books' start (±1,000,000,000: above 0 the company owed the
-- worker, below 0 the worker held an advance) and a switch. Admins read
-- them; guests, customers and crews none. Nobody writes the table directly.
--
-- admin_save_worker(id, name, phone, note, opening_balance_iqd, active):
-- adds (id null; opening 0 and switched on unless given) or edits a worker
-- (every value given each time). 22023 invalid_name / invalid_phone /
-- invalid_note / invalid_amount; ZL048 name_taken; P0002 worker_not_found.
-- The opening balance doesn't change while a month is closed (ZL056
-- books_closed), like the start day. Logs worker.create / worker.update
-- with only what changed.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(24);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s
set start_on = (date_trunc('month', tests.today()) - interval '2 months')::date, closed_through = null
where s.id;

create function tests.worker(p_id uuid) returns public.workers language sql stable security definer
as $$ select * from public.workers where id = p_id $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.workers'::regclass),
  'RLS is on for workers'
);
select throws_ok(
  $$ insert into public.workers (name) values (' علي') $$,
  '23514', null, 'a name is trimmed'
);
select throws_ok(
  $$ insert into public.workers (name, phone) values ('علي', '07801234567') $$,
  '23514', null, 'a phone is stored as E.164'
);

insert into public.workers (name) values ('عامل قديم');

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.workers $$, '42501', null, 'a guest cannot read workers');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.workers $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.workers $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.workers $$, 'nor a crew');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.workers), 1, 'an admin reads them');
select throws_ok(
  $$ update public.workers set active = false where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_save_worker(null, 'علي', null, null, null, null) $$,
  '42501', null, 'a guest cannot add a worker'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_save_worker(null, 'علي', null, null, null, null) $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_save_worker(null, 'علي', null, null, null, null) $$,
  '42501', 'not_allowed', 'nor a crew'
);

-- Save and edit ------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_worker(null, 'علي', '+9647801234567', null, null, null) as ali \gset
select is(
  (select (w.name, w.phone, w.opening_balance_iqd, w.active)::text from tests.worker(:'ali') as w),
  ('علي', '+9647801234567', 0, true)::text,
  'an admin adds a worker, switched on with no opening balance'
);
select is(
  tests.last_diff('worker.create'),
  jsonb_build_object('name', 'علي', 'phone', '+9647801234567', 'note', null, 'opening_balance_iqd', 0, 'active', true),
  'logged as worker.create'
);
select throws_ok(
  $$ select public.admin_save_worker(null, 'عامل قديم', null, null, null, null) $$,
  'ZL048', 'name_taken', 'two workers have different names'
);
select throws_ok(
  $$ select public.admin_save_worker(null, 'ع', null, null, null, null) $$,
  '22023', 'invalid_name', 'a name has at least 2 characters'
);
select throws_ok(
  $$ select public.admin_save_worker(null, 'حسن', '0780', null, null, null) $$,
  '22023', 'invalid_phone', 'a phone is a valid Iraqi mobile'
);
select throws_ok(
  $$ select public.admin_save_worker(null, 'حسن', null, null, 1000000001, null) $$,
  '22023', 'invalid_amount', 'the opening balance is within a billion'
);
select lives_ok(
  format($$ select public.admin_save_worker(%L, 'علي كاظم', '+9647801234567', 'سائق', -25000, true) $$, :'ali'),
  'an admin edits a worker, with an advance held at the start'
);
select is(
  tests.last_diff('worker.update'),
  jsonb_build_object(
    'name', jsonb_build_object('from', 'علي', 'to', 'علي كاظم'),
    'note', jsonb_build_object('from', null, 'to', 'سائق'),
    'opening_balance_iqd', jsonb_build_object('from', 0, 'to', -25000)
  ),
  'logged with only what changed'
);
select throws_ok(
  $$ select public.admin_save_worker(gen_random_uuid(), 'حسن', null, null, 0, true) $$,
  'P0002', 'worker_not_found', 'a missing worker is refused'
);

-- A closed month locks the opening balance ---------------------------------------------------

select tests.clear_authentication();
update public.finance_settings as s
set closed_through = (date_trunc('month', tests.today()) - interval '1 month' - interval '1 day')::date
where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_save_worker(%L, 'علي كاظم', '+9647801234567', 'سائق', 0, true) $$, :'ali'),
  'ZL056', 'books_closed', 'the opening balance does not change while a month is closed'
);
select lives_ok(
  format($$ select public.admin_save_worker(%L, 'علي كاظم', null, 'سائق', -25000, false) $$, :'ali'),
  'the rest still does'
);
select is((tests.worker(:'ali')).active, false, 'and the worker is switched off');

select * from finish();
rollback;
