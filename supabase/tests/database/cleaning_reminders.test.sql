-- Cleaning reminders (spec §9.2, §5.15): private.send_cleaning_reminders(day),
-- run by pg_cron daily at 07:03 UTC (10:03 Baghdad), writes a
-- cleaning_reminder notification for each certificate:
-- - "week": its next_due_on is 1–7 days ahead (on the 7th day before, or
--   later in that week if a run was missed)
-- - "due": its next_due_on is today or up to 6 days ago (a missed run
--   catches up)
-- only while the customer has reminders_enabled, the account isn't deleted,
-- the order's address still exists, no newer certificate covers that address
-- and no order there is still open (pending … in progress). Each kind goes
-- once per certificate and due date (cleaning_reminders): never twice, but a
-- certificate re-issued with a new date gets its own. A reminder held back
-- because reminders were off isn't recorded, so turning them on in time
-- still sends it. It returns how many it wrote. Nobody but pg_cron (postgres)
-- runs it, and the API roles can't touch cleaning_reminders.
begin;
\ir _helpers.psql

select plan(29);

update public.settings as s set cleaning_interval_months = 6 where s.id;
create function tests.t() returns date language sql immutable as $$ select date '2026-11-01' $$;

-- A customer with one completed order and its certificate due on p_due.
create function tests.certified(p_phone text, p_due date) returns uuid language plpgsql
as $$
declare
  v_order uuid := tests.create_order(tests.create_user(p_phone), 'completed', now() - interval '180 days');
  v_id uuid;
begin
  -- Issued six months before it is due, as transition_order would.
  insert into public.certificates (order_id, public_code, next_due_on, issued_at)
  values (v_order, private.new_certificate_code(), p_due, (p_due - interval '6 months')::timestamptz)
  returning id into v_id;
  return v_id;
end;
$$;
create function tests.kinds(p_phone text) returns setof text language sql stable
as $$
  select (n.data ->> 'kind') || ' ' || (n.data ->> 'due_on')
  from public.notifications as n
  where n.user_id = tests.user_id(p_phone) and n.type = 'cleaning_reminder'
  order by 1
$$;

insert into tests.ids values
  ('week7', tests.certified('+9647800000001', tests.t() + 7)),
  ('week3', tests.certified('+9647800000002', tests.t() + 3)),
  ('due0', tests.certified('+9647800000003', tests.t())),
  ('due6', tests.certified('+9647800000004', tests.t() - 6)),
  ('late7', tests.certified('+9647800000005', tests.t() - 7)),
  ('early8', tests.certified('+9647800000006', tests.t() + 8)),
  ('off', tests.certified('+9647800000007', tests.t() + 7)),
  ('deleted', tests.certified('+9647800000008', tests.t() + 7)),
  ('no_address', tests.certified('+9647800000009', tests.t() + 7)),
  ('superseded', tests.certified('+9647800000010', tests.t() + 7)),
  ('booked', tests.certified('+9647800000011', tests.t() + 7));

update public.profiles set reminders_enabled = false where id = tests.user_id('+9647800000007');
update public.profiles set deleted_at = now() where id = tests.user_id('+9647800000008');
update public.addresses set deleted_at = now(), is_default = false where user_id = tests.user_id('+9647800000009');
-- A newer certificate at the same address (due later).
insert into public.certificates (order_id, public_code, next_due_on)
values (
  tests.create_order(tests.user_id('+9647800000010'), 'completed', now() - interval '10 days'),
  private.new_certificate_code(), tests.t() + 170
);
-- An open order at the same address.
select tests.create_order(tests.user_id('+9647800000011'), 'confirmed', now() + interval '3 days');

-- First run ----------------------------------------------------------------------------------

select is(private.send_cleaning_reminders(tests.t()), 4, 'the first run writes four reminders');
select results_eq($$ select * from tests.kinds('+9647800000001') $$,
  $$ values ('week ' || (tests.t() + 7)) $$, '7 days before: the week reminder');
select results_eq($$ select * from tests.kinds('+9647800000002') $$,
  $$ values ('week ' || (tests.t() + 3)) $$, '3 days before (a missed run): the week reminder');
select results_eq($$ select * from tests.kinds('+9647800000003') $$,
  $$ values ('due ' || tests.t()) $$, 'on the due date: the due reminder');
select results_eq($$ select * from tests.kinds('+9647800000004') $$,
  $$ values ('due ' || (tests.t() - 6)) $$, '6 days after (missed runs): the due reminder catches up');
select is_empty($$ select * from tests.kinds('+9647800000005') $$, '7 days after: too late, nothing');
select is_empty($$ select * from tests.kinds('+9647800000006') $$, '8 days before: too early, nothing');
select is_empty($$ select * from tests.kinds('+9647800000007') $$, 'reminders off: nothing');
select is_empty($$ select * from tests.kinds('+9647800000008') $$, 'a deleted account: nothing');
select is_empty($$ select * from tests.kinds('+9647800000009') $$, 'a deleted address: nothing');
select is_empty($$ select * from tests.kinds('+9647800000010') $$, 'a newer certificate at the address: nothing');
select is_empty($$ select * from tests.kinds('+9647800000011') $$, 'an open order at the address: nothing');

select is(
  (select n.data - 'kind' - 'due_on' from public.notifications as n
   where n.user_id = tests.user_id('+9647800000003')),
  '{"months": 6, "label": "home"}'::jsonb,
  'a reminder carries the interval and the address label'
);
select is(
  (select n.order_id from public.notifications as n where n.user_id = tests.user_id('+9647800000003')),
  (select order_id from public.certificates where id = tests.id('due0')),
  'and the certified order'
);

-- Never twice -------------------------------------------------------------------------------

select is(private.send_cleaning_reminders(tests.t()), 0, 'running again the same day writes nothing');
select is(
  private.send_cleaning_reminders(tests.t() + 1), 1,
  'the next day only the certificate now 7 days away gets one'
);
select results_eq($$ select * from tests.kinds('+9647800000006') $$,
  $$ values ('week ' || (tests.t() + 8)) $$, 'its week reminder');
select is(
  (select count(*)::int from tests.kinds('+9647800000002')), 1,
  'the week reminder went once'
);

-- On its due day the 7-day certificate gets the due reminder.
select is(
  private.send_cleaning_reminders(tests.t() + 7), 2,
  'on the 7-day certificate''s due day: its due reminder, and the 3-day one''s catches up'
);
select results_eq($$ select * from tests.kinds('+9647800000001') $$,
  $$ values ('due ' || (tests.t() + 7)), ('week ' || (tests.t() + 7)) $$,
  'the week reminder and then the due reminder');

-- Turning reminders on in time still sends it.
update public.profiles set reminders_enabled = true where id = tests.user_id('+9647800000007');
select private.send_cleaning_reminders(tests.t() + 1);
select results_eq($$ select * from tests.kinds('+9647800000007') $$,
  $$ values ('week ' || (tests.t() + 7)) $$,
  'reminders turned back on within the week: the week reminder goes');

-- A re-issued certificate with a new date gets its own reminders.
update public.certificates set next_due_on = tests.t() + 30 where id = tests.id('week3');
select private.send_cleaning_reminders(tests.t() + 23);
select results_eq($$ select * from tests.kinds('+9647800000002') $$,
  $$ values ('due ' || (tests.t() + 3)), ('week ' || (tests.t() + 3)), ('week ' || (tests.t() + 30)) $$,
  'a certificate with a new date is reminded again');

-- Two certificates for one address due the same day: one reminder.
select tests.create_order(tests.create_user('+9647800000012'), 'completed', now() - interval '180 days');
insert into public.certificates (order_id, public_code, next_due_on, issued_at)
select o.id, private.new_certificate_code(), tests.t() + 40, (tests.t() + 40 - interval '6 months')::timestamptz
from public.orders as o where o.customer_id = tests.user_id('+9647800000012');
insert into public.certificates (order_id, public_code, next_due_on, issued_at)
values (
  tests.create_order(tests.user_id('+9647800000012'), 'completed', now() - interval '180 days'),
  private.new_certificate_code(), tests.t() + 40, (tests.t() + 40 - interval '6 months')::timestamptz
);
select private.send_cleaning_reminders(tests.t() + 40);
select is(
  (select count(*)::int from tests.kinds('+9647800000012')), 1,
  'two certificates for one address due the same day send one reminder'
);

-- The months come from the certificate, not today's setting.
update public.settings as s set cleaning_interval_months = 12 where s.id;
select is(
  (select (n.data ->> 'months')::int from public.notifications as n
   where n.user_id = tests.user_id('+9647800000012')),
  6, 'a changed interval setting doesn''t change what an older certificate''s reminder says'
);

-- Access --------------------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.cleaning_reminders'::regclass),
  'RLS is on for cleaning_reminders'
);
select tests.authenticate_as(tests.user_id('+9647800000001'));
select throws_ok(
  $$ select 1 from public.cleaning_reminders $$, '42501', null,
  'a customer can''t read cleaning_reminders'
);
select tests.clear_authentication();
select ok(
  not has_function_privilege('authenticated', 'private.send_cleaning_reminders(date)', 'execute')
    and not has_function_privilege('service_role', 'private.send_cleaning_reminders(date)', 'execute'),
  'only pg_cron runs the reminders'
);

select is(
  (select schedule from cron.job where jobname = 'notifications-reminders'),
  '3 7 * * *', 'reminders run daily at 07:03 UTC (10:03 Baghdad)'
);
select is(
  (select command from cron.job where jobname = 'notifications-reminders'),
  'select private.send_cleaning_reminders()', 'for the Baghdad day'
);

select * from finish();
rollback;
