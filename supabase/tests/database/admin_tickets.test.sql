-- A5 tickets and A12 ratings (spec §8.2, §7; Phase 5, task 2).
--
-- admin_set_ticket_status(ticket_id, status): admins move a ticket to any
-- status (open, in progress, closed, and back), logged as ticket.status with
-- the old and new value; the same status changes and logs nothing.
-- admin_add_ticket_note(ticket_id, note): an internal note (1–1000
-- characters, trimmed), logged as ticket.note. ticket_notes is read by
-- admins only and written only by that RPC. Other roles get 42501, a
-- missing ticket P0002 ticket_not_found.
-- admin_rating_summary(): the number of ratings for each star 1–5, admins
-- only. tickets is in the Realtime publication; settings has
-- ticket_response_hours (1–72, default 1).
begin;
\ir _helpers.psql

select plan(32);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;

insert into tests.ids values
  ('oa1', tests.create_order(tests.a(), 'completed')),
  ('oa2', tests.create_order(tests.a(), 'completed')),
  ('ob', tests.create_order(tests.user_id('+9647802222222'), 'completed'));

insert into public.tickets (user_id, source, category, description)
values (tests.a(), 'app', 'smell', 'الماي بيه ريحة كلور قوية');
insert into tests.ids select 'ticket', id from public.tickets where user_id = tests.a();

-- Settings and Realtime ----------------------------------------------------------------------

select is(
  (select ticket_response_hours from public.settings),
  1::smallint,
  'the Issue report promises an answer within 1 hour by default'
);
select throws_ok(
  $$ update public.settings as s set ticket_response_hours = 0 where s.id $$,
  '23514', null, 'at least 1 hour'
);
select throws_ok(
  $$ update public.settings as s set ticket_response_hours = 73 where s.id $$,
  '23514', null, 'at most 72'
);
select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tickets'
  ),
  'tickets are in the Realtime publication'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.ticket_notes'::regclass),
  'RLS is on for ticket_notes'
);
select throws_ok(
  $$ insert into public.tickets (user_id, source, category, description, client_id)
     values
       (tests.a(), 'app', 'other', 'بلاغ أول للتجربة', '00000000-0000-0000-0000-000000000001'),
       (tests.a(), 'app', 'other', 'بلاغ ثاني للتجربة', '00000000-0000-0000-0000-000000000001') $$,
  '23505', null, 'a client id is used once per customer'
);

-- Status ------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.admin_set_ticket_status(tests.id('ticket'), 'closed') $$,
  '42501', 'not_allowed', 'a customer cannot change a ticket''s status'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_set_ticket_status(tests.id('ticket'), 'closed') $$,
  '42501', 'not_allowed', 'nor can a crew'
);
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_set_ticket_status(tests.id('ticket'), 'closed') $$,
  '42501', null, 'nor a guest'
);

select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ select public.admin_set_ticket_status(gen_random_uuid(), 'closed') $$,
  'P0002', 'ticket_not_found', 'a missing ticket'
);
select throws_ok(
  $$ select public.admin_set_ticket_status(tests.id('ticket'), null) $$,
  '22023', 'invalid_status', 'a status is required'
);
select lives_ok(
  $$ select public.admin_set_ticket_status(tests.id('ticket'), 'in_progress') $$,
  'an admin takes a ticket in hand'
);
select is(
  (select status::text from public.tickets where id = tests.id('ticket')),
  'in_progress',
  'its status is in progress'
);
select results_eq(
  $$ select admin_id, action, entity, entity_id, diff from public.admin_audit_log
     where entity = 'ticket' $$,
  $$ values (
       tests.admin(), 'ticket.status', 'ticket', tests.id('ticket')::text,
       '{"status": {"from": "open", "to": "in_progress"}}'::jsonb
     ) $$,
  'logged as ticket.status with the old and new status'
);
select lives_ok(
  $$ select public.admin_set_ticket_status(tests.id('ticket'), 'in_progress') $$,
  'setting the same status again'
);
select is(
  (select count(*)::int from public.admin_audit_log where entity = 'ticket'),
  1,
  'logs nothing'
);
select lives_ok(
  $$ select public.admin_set_ticket_status(tests.id('ticket'), 'closed') $$,
  'an admin closes it'
);
select lives_ok(
  $$ select public.admin_set_ticket_status(tests.id('ticket'), 'open') $$,
  'and opens it again'
);
select is(
  (select count(*)::int from public.admin_audit_log where action = 'ticket.status'),
  3,
  'each change is logged'
);

-- Notes -------------------------------------------------------------------------------------------

select throws_ok(
  $$ select public.admin_add_ticket_note(tests.id('ticket'), '   ') $$,
  '22023', 'invalid_note', 'an empty note is refused'
);
select throws_ok(
  $$ select public.admin_add_ticket_note(tests.id('ticket'), repeat('ا', 1001)) $$,
  '22023', 'invalid_note', 'and one over 1000 characters'
);
select throws_ok(
  $$ select public.admin_add_ticket_note(gen_random_uuid(), 'ملاحظة') $$,
  'P0002', 'ticket_not_found', 'a note on a missing ticket'
);
select lives_ok(
  $$ select public.admin_add_ticket_note(tests.id('ticket'), '  اتصلنا بيه، نرجع الفريق باجر  ') $$,
  'an admin adds a note'
);
select results_eq(
  $$ select ticket_id, author_id, note from public.ticket_notes $$,
  $$ values (tests.id('ticket'), tests.admin(), 'اتصلنا بيه، نرجع الفريق باجر') $$,
  'the note is kept, trimmed, with its author'
);
select results_eq(
  $$ select action, diff from public.admin_audit_log where action = 'ticket.note' $$,
  $$ values ('ticket.note', '{"note": {"to": "اتصلنا بيه، نرجع الفريق باجر"}}'::jsonb) $$,
  'logged as ticket.note'
);
select throws_ok(
  $$ insert into public.ticket_notes (ticket_id, author_id, note) values (tests.id('ticket'), auth.uid(), 'x') $$,
  '42501', null, 'admins write notes only through the RPC'
);

select tests.authenticate_as(tests.a());
select is_empty($$ select 1 from public.ticket_notes $$, 'the customer never reads the notes');
select throws_ok(
  $$ select public.admin_add_ticket_note(tests.id('ticket'), 'ملاحظة') $$,
  '42501', 'not_allowed', 'or adds one'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select 1 from public.ticket_notes $$, 'a crew reads none');
select tests.authenticate_as_anon();
select throws_ok($$ select 1 from public.ticket_notes $$, '42501', null, 'guests have no access');

-- Rating summary ------------------------------------------------------------------------------

select tests.clear_authentication();
delete from public.ratings;
insert into public.ratings (order_id, stars) values
  (tests.id('oa1'), 5), (tests.id('oa2'), 5), (tests.id('ob'), 2);

select tests.authenticate_as(tests.admin());
select results_eq(
  $$ select stars, ratings from public.admin_rating_summary() $$,
  $$ values (1, 0::bigint), (2, 1::bigint), (3, 0::bigint), (4, 0::bigint), (5, 2::bigint) $$,
  'admins get the number of ratings for each star'
);
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select * from public.admin_rating_summary() $$,
  '42501', 'not_allowed', 'customers don''t'
);

select * from finish();
rollback;
