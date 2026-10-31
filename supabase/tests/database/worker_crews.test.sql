-- worker_crews, admin_save_worker_crew, admin_move_worker and
-- admin_delete_worker_crew (spec §7, §8.3 A21; Phase 7, task 4).
--
-- A worker's crew membership, with its first and last day (from_on, to_on;
-- to_on null while current). A move between crews is kept: the old row ends
-- the day before the new one starts. A worker is in at most one crew on any
-- day (ZL058 membership_overlap), and may be in none (a driver). Admins
-- read them; guests, customers and crews none. Nobody writes the table
-- directly.
--
-- admin_save_worker_crew(id, worker_id, crew_id, from_on, to_on) adds or
-- corrects a row: to_on is empty or on or after from_on (22023
-- invalid_date), neither after today (ZL043); the worker is kept on an edit
-- (22023 invalid_target); P0002 worker_not_found / crew_not_found /
-- membership_not_found; a switched-off worker takes no new row (ZL044
-- worker_inactive). admin_move_worker(worker_id, crew_id, on) ends the
-- current row the day before and starts the new crew on that day (no crew:
-- the worker leaves crews); 22023 invalid_date when the current row starts
-- on or after that day, same_crew for the crew it is in, P0002
-- membership_not_found to leave with no current row.
-- admin_delete_worker_crew(id) removes a row entered by mistake.
--
-- Month close: membership decides per-visit pay, so no change reaches a
-- day in a closed month (ZL054, trigger worker_crews_refuse_closed): a new
-- row may not start in one, an end moved from or to a day in one is
-- refused, and a row starting in one is not deleted. A move on the first
-- day of the open month (ending the old row on the closed month's last
-- day) goes through. Logs worker_crew.create / .update / .delete.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(32);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values
  ('crew_a', tests.create_crew('+9647703333333')),
  ('crew_b', tests.create_crew('+9647703333334'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;

insert into public.workers (name) values ('علي'), ('حسن'), ('موقوف');
update public.workers set active = false where name = 'موقوف';
insert into tests.ids select name, id from public.workers;

create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.worker_crews'::regclass),
  'RLS is on for worker_crews'
);
select throws_ok(
  format(
    $$ insert into public.worker_crews (worker_id, crew_id, from_on, to_on, created_by) values (%L, %L, %L, %L, %L) $$,
    tests.id('علي'), tests.id('crew_a'), tests.today(), tests.today() - 1, tests.user_id('+9647504444444')
  ),
  '23514', null, 'a membership ends on or after its first day'
);

insert into public.worker_crews (worker_id, crew_id, from_on, created_by)
values (tests.id('حسن'), tests.id('crew_b'), tests.month(2), tests.user_id('+9647504444444'));

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.worker_crews $$, '42501', null, 'a guest cannot read memberships');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.worker_crews $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.worker_crews $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333334'));
select is_empty($$ select * from public.worker_crews $$, 'nor a crew, not even its own workers');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.worker_crews), 1, 'an admin reads them');
select throws_ok(
  $$ delete from public.worker_crews where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  format($$ select public.admin_save_worker_crew(null, %L, %L, current_date, null) $$, tests.id('علي'), tests.id('crew_a')),
  '42501', null, 'a guest cannot add a membership'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  format($$ select public.admin_move_worker(%L, %L, current_date) $$, tests.id('حسن'), tests.id('crew_a')),
  '42501', 'not_allowed', 'nor a customer move a worker'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  format($$ select public.admin_move_worker(%L, %L, current_date) $$, tests.id('حسن'), tests.id('crew_a')),
  '42501', 'not_allowed', 'nor a crew take a worker'
);
select throws_ok(
  $$ select public.admin_delete_worker_crew((select id from public.worker_crews limit 1)) $$,
  '42501', 'not_allowed', 'or delete a membership'
);

-- Save, move, delete -------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_worker_crew(null, tests.id('علي'), tests.id('crew_a'), tests.month(2), null) as ali_a \gset
select is(
  tests.last_diff('worker_crew.create'),
  jsonb_build_object(
    'worker_id', tests.id('علي'), 'crew_id', tests.id('crew_a'), 'from_on', tests.month(2), 'to_on', null
  ),
  'an admin puts a worker in a crew, logged as worker_crew.create'
);
select throws_ok(
  format($$ select public.admin_save_worker_crew(null, %L, %L, %L, null) $$, tests.id('علي'), tests.id('crew_b'), tests.month(1)),
  'ZL058', 'membership_overlap', 'a worker is in one crew at a time'
);
select throws_ok(
  format($$ select public.admin_save_worker_crew(null, %L, %L, %L, %L) $$,
    tests.id('علي'), tests.id('crew_b'), tests.month(3), tests.month(2)),
  'ZL058', 'membership_overlap', 'the first and last days count'
);
select throws_ok(
  format($$ select public.admin_save_worker_crew(null, %L, %L, %L, null) $$, tests.id('علي'), tests.id('crew_b'), tests.today() + 1),
  'ZL043', 'date_in_future', 'a membership does not start after today'
);
select throws_ok(
  format($$ select public.admin_save_worker_crew(null, %L, %L, current_date, null) $$, tests.id('موقوف'), tests.id('crew_b')),
  'ZL044', 'worker_inactive', 'a switched-off worker joins no crew'
);
select throws_ok(
  format($$ select public.admin_save_worker_crew(null, %L, gen_random_uuid(), current_date, null) $$, tests.id('حسن')),
  'P0002', 'crew_not_found', 'a missing crew is refused'
);
select throws_ok(
  format($$ select public.admin_save_worker_crew(%s, %L, %L, %L, null) $$,
    :ali_a, tests.id('حسن'), tests.id('crew_a'), tests.month(2)),
  '22023', 'invalid_target', 'an edit keeps the worker'
);
select throws_ok(
  format($$ select public.admin_move_worker(%L, %L, %L) $$, tests.id('علي'), tests.id('crew_a'), tests.today()),
  '22023', 'same_crew', 'a move goes to another crew'
);
select throws_ok(
  format($$ select public.admin_move_worker(%L, %L, %L) $$, tests.id('علي'), tests.id('crew_b'), tests.month(2)),
  '22023', 'invalid_date', 'a move is after the current crew started'
);

-- Month close --------------------------------------------------------------------------------

select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(0) - 1 where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_move_worker(%L, %L, %L) $$, tests.id('علي'), tests.id('crew_b'), tests.month(1) + 10),
  'ZL054', 'month_closed', 'a move inside a closed month is refused'
);
select throws_ok(
  format($$ select public.admin_save_worker_crew(null, %L, %L, %L, %L) $$,
    tests.id('موقوف'), tests.id('crew_b'), tests.month(1), tests.month(1) + 3),
  'ZL044', 'worker_inactive', '(a switched-off worker is checked first)'
);
select throws_ok(
  format($$ select public.admin_delete_worker_crew(%s) $$, :ali_a),
  'ZL054', 'month_closed', 'a membership that started in a closed month is not deleted'
);
select lives_ok(
  format($$ select public.admin_move_worker(%L, %L, %L) $$, tests.id('علي'), tests.id('crew_b'), tests.month(0)),
  'a move on the first day of the open month goes through'
);
select is(
  (select array_agg((m.crew_id, m.from_on, m.to_on)::text order by m.from_on) from public.worker_crews as m where m.worker_id = tests.id('علي')),
  array[(tests.id('crew_a'), tests.month(2), tests.month(0) - 1)::text, (tests.id('crew_b'), tests.month(0), null::date)::text],
  'the old crew ends on the closed month''s last day and the new one starts the next'
);
select is(
  tests.last_diff('worker_crew.update'),
  jsonb_build_object('to_on', jsonb_build_object('from', null, 'to', tests.month(0) - 1)),
  'the end is logged as worker_crew.update'
);
select throws_ok(
  format($$ select public.admin_save_worker_crew(%s, %L, %L, %L, %L) $$,
    :ali_a, tests.id('علي'), tests.id('crew_a'), tests.month(2), tests.month(1) + 5),
  'ZL054', 'month_closed', 'an end is not moved into a closed month'
);
select lives_ok(
  format($$ select public.admin_move_worker(%L, null, %L) $$, tests.id('حسن'), tests.today()),
  'a worker leaves crews from today'
);
select is(
  (select m.to_on from public.worker_crews as m where m.worker_id = tests.id('حسن')),
  tests.today() - 1,
  'their last day in the crew is yesterday'
);
select lives_ok(
  format(
    $$ select public.admin_delete_worker_crew(%s) $$,
    (select m.id from public.worker_crews as m where m.worker_id = tests.id('علي') and m.from_on = tests.month(0))
  ),
  'a membership starting in the open month is deleted'
);
select is(
  tests.last_diff('worker_crew.delete'),
  jsonb_build_object('worker_id', tests.id('علي'), 'crew_id', tests.id('crew_b'), 'from_on', tests.month(0), 'to_on', null),
  'logged as worker_crew.delete'
);

select * from finish();
rollback;
