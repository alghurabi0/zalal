-- worker_days, admin_set_worker_days and admin_worker_crew_days (spec §7,
-- §8.3 A21; Phase 7, task 4).
--
-- Attendance for daily pay: one row per worker and day worked. Admins read
-- them; guests, customers and crews none. Nobody writes the table directly.
--
-- admin_set_worker_days(worker_id, month, days) makes the month's ticks
-- exactly the days given: each in that month (22023 invalid_date), between
-- the books' start and today (ZL042, ZL043); a switched-off worker gets no
-- new day (ZL044 worker_inactive) but loses ticks. A day in a closed month
-- is neither ticked nor unticked (ZL054). Logs worker_days.update with the
-- days added and removed; a save that changes nothing logs nothing.
-- admin_worker_crew_days(worker_id, month): the days the worker's crew
-- completed an order while the worker was in it, from the books' start
-- through today, which A21 offers to tick (42501 for non-admins).
--
-- The start day doesn't move past a ticked day or a live bonus or
-- deduction (ZL046 records_before_start).
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(25);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values
  ('crew_a', tests.create_crew('+9647703333333')),
  ('crew_b', tests.create_crew('+9647703333334'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;

insert into public.workers (name) values ('كرار'), ('موقوف');
update public.workers set active = false where name = 'موقوف';
insert into tests.ids select name, id from public.workers;

-- كرار is in crew A until the 10th of last month, then crew B.
insert into public.worker_crews (worker_id, crew_id, from_on, to_on, created_by) values
  (tests.id('كرار'), tests.id('crew_a'), tests.month(2), tests.month(1) + 9, tests.user_id('+9647504444444')),
  (tests.id('كرار'), tests.id('crew_b'), tests.month(1) + 10, null, tests.user_id('+9647504444444'));

create function tests.completed_order(p_crew uuid, p_on date, p_status text default 'completed')
returns uuid
language plpgsql
as $$
declare
  v_id uuid := tests.create_order(
    tests.user_id('+9647801111111'), p_status, p_on::timestamptz - interval '2 hours', p_crew
  );
begin
  insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, created_at)
  values (v_id, 'in_progress', 'completed', tests.user_id('+9647504444444'), 'admin',
    (p_on + time '12:00') at time zone 'Asia/Baghdad');
  return v_id;
end;
$$;

select tests.completed_order(tests.id('crew_a'), tests.month(1) + 2);   -- counted (crew A)
select tests.completed_order(tests.id('crew_a'), tests.month(1) + 2);   -- same day once
select tests.completed_order(tests.id('crew_a'), tests.month(1) + 12);  -- crew A after the move
select tests.completed_order(tests.id('crew_b'), tests.month(1) + 3);   -- crew B before the move
select tests.completed_order(tests.id('crew_b'), tests.month(1) + 15);  -- counted (crew B)
select tests.completed_order(tests.id('crew_b'), tests.month(1) + 16, 'in_progress'); -- not completed

create function tests.days(p_worker uuid) returns date[] language sql stable security definer
as $$ select coalesce(array_agg(d.worked_on order by d.worked_on), '{}') from public.worker_days as d where d.worker_id = p_worker $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.worker_days'::regclass),
  'RLS is on for worker_days'
);
insert into public.worker_days (worker_id, worked_on, created_by)
values (tests.id('كرار'), tests.month(1), tests.user_id('+9647504444444'));
select throws_ok(
  format(
    $$ insert into public.worker_days (worker_id, worked_on, created_by) values (%L, %L, %L) $$,
    tests.id('كرار'), tests.month(1), tests.user_id('+9647504444444')
  ),
  '23505', null, 'a day is ticked once'
);

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.worker_days $$, '42501', null, 'a guest cannot read attendance');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.worker_days $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.worker_days $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.worker_days $$, 'nor a crew');
select throws_ok(
  format($$ select public.admin_worker_crew_days(%L, %L) $$, tests.id('كرار'), tests.month(1)),
  '42501', 'not_allowed', 'nor reads its work days'
);
select throws_ok(
  format($$ select public.admin_set_worker_days(%L, %L, array[%L]::date[]) $$, tests.id('كرار'), tests.month(1), tests.month(1)),
  '42501', 'not_allowed', 'nor ticks a day'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  format($$ select public.admin_set_worker_days(%L, %L, array[%L]::date[]) $$, tests.id('كرار'), tests.month(1), tests.month(1)),
  '42501', 'not_allowed', 'nor does a customer'
);
select tests.authenticate_as_anon();
select throws_ok(
  format($$ select public.admin_set_worker_days(%L, %L, array[%L]::date[]) $$, tests.id('كرار'), tests.month(1), tests.month(1)),
  '42501', null, 'nor a guest'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.worker_days), 1, 'an admin reads them');
select throws_ok(
  $$ delete from public.worker_days where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- The crew's work days -----------------------------------------------------------------------

select is(
  (select array_agg(d order by d) from public.admin_worker_crew_days(tests.id('كرار'), tests.month(1) + 20) as d),
  array[tests.month(1) + 2, tests.month(1) + 15],
  'the days their crew completed an order while they were in it, once each'
);

-- Ticking ------------------------------------------------------------------------------------

select lives_ok(
  format(
    $$ select public.admin_set_worker_days(%L, %L, array[%L, %L, %L]::date[]) $$,
    tests.id('كرار'), tests.month(1), tests.month(1) + 2, tests.month(1) + 15, tests.month(1) + 16
  ),
  'an admin sets the month''s days'
);
select is(
  tests.days(tests.id('كرار')),
  array[tests.month(1) + 2, tests.month(1) + 15, tests.month(1) + 16],
  'they replace the month''s ticks'
);
select is(
  tests.last_diff('worker_days.update'),
  jsonb_build_object(
    'month', tests.month(1),
    'added', jsonb_build_array(tests.month(1) + 2, tests.month(1) + 15, tests.month(1) + 16),
    'removed', jsonb_build_array(tests.month(1))
  ),
  'logged with the days added and removed'
);
select throws_ok(
  format($$ select public.admin_set_worker_days(%L, %L, array[%L]::date[]) $$, tests.id('كرار'), tests.month(1), tests.month(0)),
  '22023', 'invalid_date', 'every day is in the month'
);
select throws_ok(
  format($$ select public.admin_set_worker_days(%L, %L, array[%L]::date[]) $$, tests.id('كرار'), tests.month(3), tests.month(3)),
  'ZL042', 'before_finance_start', 'and in the books'
);
select throws_ok(
  format($$ select public.admin_set_worker_days(%L, %L, array[%L]::date[]) $$, tests.id('كرار'), tests.month(0), tests.today() + 1),
  'ZL043', 'date_in_future', 'and not after today'
);
select throws_ok(
  format($$ select public.admin_set_worker_days(%L, %L, array[%L]::date[]) $$, tests.id('موقوف'), tests.month(1), tests.month(1)),
  'ZL044', 'worker_inactive', 'a switched-off worker gets no new day'
);

-- The start day and month close --------------------------------------------------------------

select throws_ok(
  format($$ select public.admin_update_finance_settings(%L) $$, tests.month(1) + 3),
  'ZL046', 'records_before_start', 'the start day does not move past a ticked day'
);
select public.admin_set_worker_days(tests.id('كرار'), tests.month(1), array[]::date[]);
select lives_ok(
  format(
    $$ select public.admin_save_payroll_adjustment(null, %L, %L, 'bonus', 5000, 'عيد') $$,
    tests.id('كرار'), tests.month(1) + 1
  ),
  '(a bonus)'
);
select throws_ok(
  format($$ select public.admin_update_finance_settings(%L) $$, tests.month(1) + 3),
  'ZL046', 'records_before_start', 'nor past a live bonus'
);

select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(0) - 1 where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_set_worker_days(%L, %L, array[%L]::date[]) $$, tests.id('كرار'), tests.month(1), tests.month(1) + 4),
  'ZL054', 'month_closed', 'no day is ticked in a closed month'
);
select tests.clear_authentication();
update public.finance_settings as s set closed_through = null where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_set_worker_days(tests.id('كرار'), tests.month(1), array[tests.month(1) + 4]);
select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(0) - 1 where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_set_worker_days(%L, %L, array[]::date[]) $$, tests.id('كرار'), tests.month(1)),
  'ZL054', 'month_closed', 'nor unticked'
);

select * from finish();
rollback;
