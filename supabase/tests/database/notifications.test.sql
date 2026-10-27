-- The in-app notifications list (spec §5.7, §9.2, §7 notifications):
-- - Each user reads only their own rows, whatever their role (admins too:
--   nothing needs another user's notifications). Guests read nothing.
-- - Nobody writes the table through the API: rows come from the database's
--   own triggers and jobs. Read marks go through two RPCs:
--   - mark_notification_read(id): the caller's own row (P0002
--     notification_not_found otherwise); an already-read row keeps its time.
--   - mark_all_notifications_read(): every unread row of the caller; returns
--     how many.
--   Both refuse guests (42501).
-- - Rows are in the Realtime publication (the Home bell and the list).
begin;
\ir _helpers.psql

select plan(30);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;
create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;
create function tests.crew_user() returns uuid language sql stable
as $$ select tests.user_id('+9647703333333') $$;

insert into tests.ids values ('order_a', tests.create_order(tests.a(), 'confirmed'));

insert into public.notifications (id, user_id, type, data, order_id) values
  ('00000000-0000-4000-8000-000000000a01', tests.a(), 'order_confirmed', '{"number": 1001}', tests.id('order_a')),
  ('00000000-0000-4000-8000-000000000a02', tests.a(), 'support_message', '{"excerpt": "هلا"}', null),
  ('00000000-0000-4000-8000-000000000b01', tests.b(), 'support_message', '{"excerpt": "هلا"}', null),
  ('00000000-0000-4000-8000-000000000c01', tests.admin(), 'new_booking', '{"number": 1001}', tests.id('order_a')),
  ('00000000-0000-4000-8000-000000000d01', tests.crew_user(), 'new_job', '{"number": 1001}', tests.id('order_a'));
insert into tests.ids values
  ('a1', '00000000-0000-4000-8000-000000000a01'),
  ('a2', '00000000-0000-4000-8000-000000000a02'),
  ('b1', '00000000-0000-4000-8000-000000000b01'),
  ('c1', '00000000-0000-4000-8000-000000000c01');

-- The table ----------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.notifications'::regclass),
  'RLS is on'
);
select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ),
  'notifications are in the Realtime publication'
);
select is(
  (select data_type from information_schema.columns
   where table_schema = 'public' and table_name = 'notifications' and column_name = 'id'),
  'uuid', 'the key is a uuid (Realtime sends DELETE keys to everyone)'
);
select throws_ok(
  $$ insert into public.notifications (user_id, type, data) values (tests.a(), 'new_job', '[]') $$,
  '23514', null, 'data is an object'
);

-- Reads ----------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select 1 from public.notifications $$,
  '42501', null, 'guests can''t read notifications'
);

select tests.authenticate_as(tests.a());
select results_eq(
  $$ select id from public.notifications order by id $$,
  $$ values (tests.id('a1')), (tests.id('a2')) $$,
  'a customer reads only their own notifications'
);

select tests.authenticate_as(tests.b());
select results_eq(
  $$ select id from public.notifications $$,
  $$ values (tests.id('b1')) $$,
  'another customer reads only theirs'
);

select tests.authenticate_as(tests.admin());
select results_eq(
  $$ select id from public.notifications $$,
  $$ values (tests.id('c1')) $$,
  'an admin reads only their own, not customers'''
);

select tests.authenticate_as(tests.crew_user());
select results_eq(
  $$ select type::text from public.notifications $$,
  $$ values ('new_job') $$,
  'a crew reads only its own'
);

-- No writes --------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ insert into public.notifications (user_id, type) values (auth.uid(), 'support_message') $$,
  '42501', null, 'a customer can''t add notifications'
);
select throws_ok(
  $$ update public.notifications set read_at = now() where id = tests.id('a1') $$,
  '42501', null, 'nor mark them read directly'
);
select throws_ok(
  $$ delete from public.notifications where id = tests.id('a1') $$,
  '42501', null, 'nor delete them'
);

select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ update public.notifications set read_at = now() where id = tests.id('a1') $$,
  '42501', null, 'admins can''t write the table either'
);

-- mark_notification_read -----------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.mark_notification_read(tests.id('a1')) $$,
  '42501', null, 'guests can''t mark anything read'
);

select tests.authenticate_as(tests.b());
select throws_ok(
  $$ select public.mark_notification_read(tests.id('a1')) $$,
  'P0002', 'notification_not_found', 'another customer can''t mark A''s notification read'
);
select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ select public.mark_notification_read(tests.id('a1')) $$,
  'P0002', 'notification_not_found', 'nor can an admin'
);
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.mark_notification_read(gen_random_uuid()) $$,
  'P0002', 'notification_not_found', 'an unknown id is not found'
);

select lives_ok(
  $$ select public.mark_notification_read(tests.id('a1')) $$,
  'a customer marks their notification read'
);
select ok(
  (select read_at is not null from public.notifications where id = tests.id('a1')),
  'it is read'
);
select is(
  (select read_at from public.notifications where id = tests.id('a2')), null,
  'the other one is still unread'
);

-- An already-read notification keeps its time.
select tests.clear_authentication();
update public.notifications set read_at = now() - interval '1 day' where id = tests.id('a1');
select tests.authenticate_as(tests.a());
select public.mark_notification_read(tests.id('a1'));
select ok(
  (select read_at < now() - interval '23 hours' from public.notifications where id = tests.id('a1')),
  'marking a read notification again keeps its first time'
);

select tests.authenticate_as(tests.crew_user());
select lives_ok(
  $$ select public.mark_notification_read(id) from public.notifications $$,
  'a crew marks its own notification read'
);

-- mark_all_notifications_read --------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.mark_all_notifications_read() $$,
  '42501', null, 'guests can''t mark all read'
);

select tests.authenticate_as(tests.a());
select is(public.mark_all_notifications_read(), 1, 'marking all read returns how many were unread');
select is(
  (select count(*)::int from public.notifications where read_at is null), 0,
  'none of A''s are unread'
);
select is(public.mark_all_notifications_read(), 0, 'again: nothing left to mark');

select tests.clear_authentication();
select is(
  (select read_at from public.notifications where id = tests.id('b1')), null,
  'B''s notification is untouched'
);
select is(
  (select read_at from public.notifications where id = tests.id('c1')), null,
  'and so is the admin''s'
);

select tests.authenticate_as(tests.admin());
select is(public.mark_all_notifications_read(), 1, 'an admin marks their own read');

-- A deleted account (soft delete) can't mark anything.
select tests.clear_authentication();
update public.profiles set deleted_at = now() where id = tests.b();
select tests.authenticate_as(tests.b());
select throws_ok(
  $$ select public.mark_all_notifications_read() $$,
  '42501', null, 'a deleted account can''t mark notifications read'
);

select * from finish();
rollback;
