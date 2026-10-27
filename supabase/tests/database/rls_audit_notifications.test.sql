-- RLS audit of migration notifications (notifications, push_subscriptions,
-- cleaning_reminders, the notify_* triggers, queue_push / invoke_send_push,
-- the reminder and retention jobs).
--
-- Finding (fixed): staff rows outlived the staff role. With a SELECT policy
-- of only `user_id = auth.uid()`, an admin removed with admin_remove_admin
-- (now a customer), or a deleted admin, kept reading the admin notifications
-- written while they were an admin, for up to 90 days: other customers' chat
-- excerpts (customer_message), cancel reasons (customer_cancelled), order
-- numbers, days, slots and districts (new_booking), ticket categories and
-- stars (new_ticket), although chat_messages, orders and tickets check
-- private.is_admin() on each read. The same went, with less at stake, for a
-- switched-off crew's new_job / job_changed rows. The policy now also
-- requires the row's audience (generated from its type) to be the reader's
-- current role, and an active crew for crew rows.
--
-- The rest are attacks that held (passing): Realtime INSERT/UPDATE events go
-- through RLS and DELETE events carry only the notification's own uuid; the
-- endpoint allow-list against SSRF tricks; no API role runs the private
-- notification functions or touches the tables beyond SELECT on its own
-- notifications; the data copied for customers and crews carries no staff
-- reason, staff identity or other customer's data; an admin reading a thread
-- doesn't mark the customer's notifications read.
begin;
\ir _helpers.psql

select plan(28);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444441', 'admin');   -- admin X (removed later)
select tests.create_user('+9647504444442', 'admin');   -- admin Y
select tests.create_user('+9647504444443', 'admin');   -- admin Z (deleted later)
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;
create function tests.x() returns uuid language sql stable
as $$ select tests.user_id('+9647504444441') $$;
create function tests.y() returns uuid language sql stable
as $$ select tests.user_id('+9647504444442') $$;
create function tests.z() returns uuid language sql stable
as $$ select tests.user_id('+9647504444443') $$;
create function tests.crew_user() returns uuid language sql stable
as $$ select tests.user_id('+9647703333333') $$;

-- Rows read past RLS (the test runner).
create function tests.data_of(p_user uuid, p_type text) returns jsonb
language sql stable security definer
as $$
  select n.data from public.notifications as n
  where n.user_id = p_user and n.type::text = p_type
  order by n.created_at desc limit 1
$$;
create function tests.save(p_endpoint text) returns void language sql
as $$ select public.save_push_subscription(p_endpoint, 'B' || repeat('a', 86), repeat('b', 22), 'UA') $$;

-- Realtime: a wal2json (v2) record as Realtime feeds it to apply_rls, and
-- what one subscription receives (rls_audit_live_job.test.sql).
create function tests.wal(p_action text, p_table regclass, p_row jsonb)
returns jsonb language sql stable
as $$
  with cols as (
    select a.attname as name, format_type(a.atttypid, null) as type, a.atttypid::int as typeoid,
      exists (
        select 1 from pg_index i
        where i.indrelid = p_table and i.indisprimary and a.attnum = any(i.indkey)
      ) as is_pk
    from pg_attribute a
    where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped
  )
  select jsonb_build_object(
    'action', p_action,
    'schema', (select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = p_table),
    'table', (select c.relname from pg_class c where c.oid = p_table),
    'timestamp', now(),
    'pk', (select jsonb_agg(jsonb_build_object('name', name, 'type', type, 'typeoid', typeoid)) from cols where is_pk),
    'identity', (select jsonb_agg(jsonb_build_object('name', name, 'type', type, 'typeoid', typeoid, 'value', p_row -> name)) from cols where is_pk),
    'columns', case when p_action = 'D' then '[]'::jsonb else
      (select jsonb_agg(jsonb_build_object('name', name, 'type', type, 'typeoid', typeoid, 'value', p_row -> name)) from cols) end
  );
$$;
create function tests.delivered(p_sub uuid, p_wal jsonb)
returns setof jsonb language sql volatile
as $$
  select r.wal from realtime.apply_rls(p_wal) as r
  where p_sub = any(r.subscription_ids) and cardinality(r.errors) = 0;
$$;
grant execute on all functions in schema tests to anon, authenticated;

-- Fixtures: chat open all day, a confirmed job for the crew, B's message.
update public.settings as s
set working_days = '{0,1,2,3,4,5,6}', working_hours_start = '00:00', working_hours_end = '24:00'
where s.id;
insert into tests.ids values
  ('pending', tests.create_order(tests.a(), 'pending_confirmation', p_crew_id => tests.id('crew'))),
  ('cancel_me', tests.create_order(tests.a(), 'confirmed', p_crew_id => tests.id('crew'))),
  ('ns', tests.create_order(tests.a(), 'confirmed', now() + interval '1 hour', tests.id('crew')));
delete from public.notifications;

select tests.authenticate_as(tests.b());
select public.send_chat_message(gen_random_uuid(), p_body => 'رقمي الثاني 07701234567 والبيت قرب المدرسة');
select tests.authenticate_as(tests.x());
select public.transition_order(tests.id('pending'), 'confirmed');
select tests.clear_authentication();

-- Finding: staff notifications outlive the staff role -----------------------------------

select tests.authenticate_as(tests.x());
select ok(
  (select count(*) from public.notifications where type = 'customer_message') = 1,
  'precondition: admin X reads the customer_message row while an admin'
);

select tests.authenticate_as(tests.y());
select public.admin_remove_admin(tests.x());

select tests.authenticate_as(tests.x());
select is_empty(
  $$ select 1 from public.notifications where type = 'customer_message' $$,
  'an admin removed with admin_remove_admin no longer reads customers'' chat excerpts'
);
select is_empty(
  $$ select 1 from public.notifications where data::text like '%07701234567%' $$,
  'no row shows the removed admin another customer''s message'
);
select is_empty(
  $$ select 1 from public.chat_messages where customer_id = tests.b() $$,
  'control: the removed admin already reads none of B''s chat (chat checks is_admin())'
);

select tests.clear_authentication();
update public.profiles set deleted_at = now() where id = tests.z();
select tests.authenticate_as(tests.z());
select is_empty(
  $$ select 1 from public.notifications where type in ('customer_message', 'new_booking', 'customer_cancelled', 'new_ticket', 'customer_rescheduled') $$,
  'a deleted admin reads no admin notifications'
);

select tests.authenticate_as(tests.crew_user());
select ok(
  (select count(*) from public.notifications where type = 'new_job') = 1,
  'precondition: the crew reads its new_job row while active'
);
select tests.clear_authentication();
update public.crews set active = false where id = tests.id('crew');
select tests.authenticate_as(tests.crew_user());
select is_empty(
  $$ select 1 from public.orders where id = tests.id('pending') $$,
  'control: a switched-off crew no longer reads the order'
);
select is_empty(
  $$ select 1 from public.notifications where type in ('new_job', 'job_changed') $$,
  'a switched-off crew no longer reads the order''s number, day, slot and district in new_job'
);
select tests.clear_authentication();
update public.crews set active = true where id = tests.id('crew');

-- Held: Realtime ------------------------------------------------------------------------------

create table tests.row_b as
select to_jsonb(n) as r from public.notifications as n
where n.user_id = tests.y() and n.type = 'customer_message';

insert into realtime.subscription (subscription_id, entity, claims)
values
  ('00000000-0000-4000-8000-00000000000a', 'public.notifications',
   jsonb_build_object('role', 'authenticated', 'sub', tests.a())),
  ('00000000-0000-4000-8000-00000000000c', 'public.notifications',
   jsonb_build_object('role', 'authenticated', 'sub', tests.y())),
  ('00000000-0000-4000-8000-00000000000e', 'public.notifications',
   jsonb_build_object('role', 'anon'));

select is_empty(
  $$ select * from tests.delivered('00000000-0000-4000-8000-00000000000a',
       tests.wal('I', 'public.notifications', (select r from tests.row_b))) $$,
  'a customer gets no INSERT event for an admin''s notification'
);
select is_empty(
  $$ select * from tests.delivered('00000000-0000-4000-8000-00000000000a',
       tests.wal('U', 'public.notifications', (select r from tests.row_b))) $$,
  'nor its UPDATE event (read marks)'
);
select is_empty(
  $$ select * from tests.delivered('00000000-0000-4000-8000-00000000000e',
       tests.wal('I', 'public.notifications', (select r from tests.row_b))) $$,
  'a guest subscription gets nothing'
);
select is(
  (select count(*)::int from tests.delivered('00000000-0000-4000-8000-00000000000c',
     tests.wal('I', 'public.notifications', (select r from tests.row_b)))),
  1, 'the admin it belongs to gets it'
);
select is(
  (select array_agg(k order by k) from tests.delivered('00000000-0000-4000-8000-00000000000a',
     tests.wal('D', 'public.notifications', (select r from tests.row_b))) as d,
     jsonb_object_keys(d -> 'old_record') as k),
  array['id'],
  'a pruned or cascaded DELETE event shows another subscriber only the row''s own uuid'
);
select is(
  (select relreplident::text from pg_class where oid = 'public.notifications'::regclass), 'd',
  'notifications keep replica identity default (DELETE events carry the key only)'
);

-- Held: endpoint allow-list ---------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok($$ select tests.save('https://fcm.googleapis.com:8443/fcm/send/x') $$,
  '22023', 'invalid_endpoint', 'a port is refused');
select throws_ok($$ select tests.save('https://fcm.googleapis.com\@127.0.0.1/x') $$,
  '22023', 'invalid_endpoint', 'a backslash (WHATWG reads it as /) is refused');
select throws_ok($$ select tests.save('https://fcm.googleapis.com./x') $$,
  '22023', 'invalid_endpoint', 'a trailing-dot host is refused');
select throws_ok($$ select tests.save('https://FCM.googleapis.com.evil.example/x') $$,
  '22023', 'invalid_endpoint', 'case games are refused');
select throws_ok($$ select tests.save('https://fcm%2egoogleapis.com/x') $$,
  '22023', 'invalid_endpoint', 'a percent-encoded host is refused');
select throws_ok($$ select tests.save(E'https://fcm.googleapis.com\t.evil.example/x') $$,
  '22023', 'invalid_endpoint', 'a tab (WHATWG drops it) is refused');
select throws_ok($$ select tests.save('https://evil.example#.push.services.mozilla.com/x') $$,
  '22023', 'invalid_endpoint', 'an allowed host after # is refused');
select throws_ok($$ select tests.save('https://a.b.notify.windows.com.evil.example/x') $$,
  '22023', 'invalid_endpoint', 'an allowed suffix inside a longer host is refused');
select tests.clear_authentication();

-- Held: privileges --------------------------------------------------------------------------------

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc as p
   cross join (values ('anon'), ('authenticated'), ('service_role')) as r (rolname)
   where p.pronamespace = 'private'::regnamespace
     and p.proname in (
       'notify_user', 'notify_admins', 'notify_crew', 'order_notice', 'notify_order_event',
       'notify_crew_change', 'notify_chat_message', 'read_chat_notifications', 'notify_ticket',
       'notify_rating_ticket', 'invoke_send_push', 'queue_push', 'send_cleaning_reminders',
       'prune_notifications'
     )
     and has_function_privilege(r.rolname, p.oid, 'execute')),
  null::text[],
  'no API role (anon, authenticated, service_role) runs a private notification function'
);
select is(
  (select array_agg(t.n || ' ' || r.rolname || ' ' || p.priv order by 1)
   from (values ('notifications'), ('push_subscriptions'), ('cleaning_reminders')) as t (n)
   cross join (values ('anon'), ('authenticated')) as r (rolname)
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p (priv)
   where has_table_privilege(r.rolname, ('public.' || t.n)::regclass, p.priv)),
  array['notifications authenticated SELECT'],
  'the API roles hold only SELECT on notifications (no TRUNCATE, REFERENCES, TRIGGER either)'
);

-- Held: what customers and crews are told -----------------------------------------------------

select tests.authenticate_as(tests.a());
select public.transition_order(tests.id('cancel_me'), 'cancelled', '{"cancel_reason": "time_unsuitable"}');
select tests.authenticate_as(tests.crew_user());
select public.transition_order(tests.id('ns'), 'no_show', '{"reason": "ما فتحوا الباب"}');
select tests.authenticate_as(tests.y());
select public.send_chat_message(
  gen_random_uuid(), (select id from public.chat_threads where user_id = tests.b()), 'تمام'
);
select tests.clear_authentication();

select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.data_of(tests.crew_user(), 'job_changed')) as k),
  array['change', 'district', 'number', 'service_date', 'slot_end_at', 'slot_start_at'],
  'the crew''s job_changed carries no customer cancel reason'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.data_of(tests.a(), 'order_no_show')) as k),
  array['district', 'number', 'service_date', 'slot_end_at', 'slot_start_at'],
  'the customer''s order_no_show carries no crew reason'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.data_of(tests.b(), 'support_message')) as k),
  array['excerpt'],
  'support''s reply names no admin and carries no thread or sender'
);

-- An admin reading the thread doesn't mark the customer's notifications read.
select tests.authenticate_as(tests.y());
select public.mark_chat_read((select id from public.chat_threads where user_id = tests.b()));
select tests.clear_authentication();
select is(
  (select count(*)::int from public.notifications
   where user_id = tests.b() and type = 'support_message' and read_at is null),
  1, 'an admin opening the thread leaves the customer''s support_message unread'
);

select * from finish();
rollback;
