-- RLS audit of migration tickets_app (create_ticket, ticket_media,
-- ticket_notes, admin_set_ticket_status, admin_add_ticket_note,
-- admin_rating_summary, tickets in the Realtime publication, the ticket-media
-- Storage policies with private.ticket_media_attached): the attempts the
-- feature's own tests don't make.
--
-- Finding (failing until fixed):
-- - The ticket-media INSERT policy doesn't ask whether a ticket has attached
--   the name. create_ticket() reads the storage object without a lock, and
--   the delete policy's private.ticket_media_attached() can't see a
--   ticket_media row that isn't committed yet. So a customer who deletes a
--   file (Storage API) while create_ticket() attaches it gets both through:
--   the ticket keeps a ticket_media row whose object is gone (reproduced with
--   two sessions against the local database). The customer can then upload
--   different content under the attached name, and support sees it as the
--   report's evidence. The test sets up the state after that race (the
--   attached object gone) and expects the re-upload to be refused.
--
-- The rest are attacks that held (passing): Realtime INSERT/UPDATE events on
-- tickets for another customer, a crew, a removed admin and a deleted admin,
-- the tickets DELETE payload, the admin RPCs and notes for removed and
-- deleted admins, attaching a file planted in the customer's folder by
-- someone else, client-id reuse across customers, a deleted customer
-- reporting, and an upsert over an attached file.
begin;
\ir _helpers.psql

select plan(23);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B (attacker)
select tests.create_user('+9647504444444', 'admin');
select tests.create_user('+9647505555555', 'admin');   -- removed later (admin_remove_admin)
select tests.create_user('+9647506666666', 'admin');   -- deleted later
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;
create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;
create function tests.ex() returns uuid language sql stable
as $$ select tests.user_id('+9647505555555') $$;
create function tests.gone() returns uuid language sql stable
as $$ select tests.user_id('+9647506666666') $$;

insert into tests.ids values
  ('order_a', tests.create_order(tests.a(), 'completed', now() - interval '2 days')),
  ('client_a', gen_random_uuid());

grant execute on all functions in schema tests to anon, authenticated;

-- A wal2json (v2) record for one row of a table, as Realtime feeds it to
-- apply_rls (rls_audit_live_job.test.sql).
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

-- A's report, with a file and an order, then taken in hand by support.
select tests.create_object('ticket-media', tests.a() || '/sent.jpg', tests.a());
select tests.authenticate_as(tests.a());
select public.create_ticket(
  tests.id('client_a'), 'leak', 'تسريب من الغطاء بعد التنظيف', tests.id('order_a'),
  jsonb_build_array(jsonb_build_object('path', tests.a() || '/sent.jpg'))
);
select tests.clear_authentication();
insert into tests.ids select 'ticket_a', id from public.tickets where client_id = tests.id('client_a');

select tests.authenticate_as(tests.admin());
select public.admin_set_ticket_status(tests.id('ticket_a'), 'in_progress');
select public.admin_add_ticket_note(tests.id('ticket_a'), 'اتصلنا بيه');
select public.admin_remove_admin(tests.ex());
select tests.clear_authentication();
update public.profiles set deleted_at = now() where id = tests.gone();

create table tests.row_a as
select to_jsonb(t) as r from public.tickets as t where t.id = tests.id('ticket_a');

-- Subscriptions as the Realtime server stores them (postgres_changes, `*`).
insert into realtime.subscription (subscription_id, entity, claims)
select s.id::uuid, 'public.tickets', jsonb_build_object('role', 'authenticated', 'sub', s.sub)
from (values
  ('00000000-0000-4000-8000-00000000000a', tests.a()),
  ('00000000-0000-4000-8000-00000000000b', tests.b()),
  ('00000000-0000-4000-8000-00000000000c', tests.user_id('+9647703333333')),
  ('00000000-0000-4000-8000-0000000000ad', tests.admin()),
  ('00000000-0000-4000-8000-0000000000e0', tests.ex()),
  ('00000000-0000-4000-8000-0000000000e1', tests.gone())
) as s (id, sub);

-- Finding: re-upload under an attached name ----------------------------------------------

-- The state after the race: the attached object was deleted while
-- create_ticket() attached it (the Storage API sets allow_delete_query).
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('ticket-media', auth.uid() || '/sent.jpg', auth.uid()::text, '{"mimetype": "image/png", "size": 66}')
     on conflict (bucket_id, name collate "C") where not is_versioned
     do update set metadata = excluded.metadata $$,
  '42501', null, 'held: a customer cannot upsert over a file their ticket attached'
);
select tests.clear_authentication();
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'ticket-media' and name = tests.a() || '/sent.jpg';
select set_config('storage.allow_delete_query', 'false', true);

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('ticket-media', auth.uid() || '/sent.jpg', auth.uid()::text, '{"mimetype": "image/png", "size": 66}') $$,
  '42501', null,
  'a customer cannot upload new content under a name a ticket has attached'
);
select tests.clear_authentication();

-- Held: Realtime events on tickets ------------------------------------------------------------

select is_empty(
  $$ select * from tests.delivered('00000000-0000-4000-8000-00000000000b',
       tests.wal('I', 'public.tickets', (select r from tests.row_a))) $$,
  'another customer gets no INSERT event for a ticket'
);
select is_empty(
  $$ select * from tests.delivered('00000000-0000-4000-8000-00000000000b',
       tests.wal('U', 'public.tickets', (select r from tests.row_a))) $$,
  'nor its UPDATE event (a status change)'
);
select is_empty(
  $$ select * from tests.delivered('00000000-0000-4000-8000-00000000000c',
       tests.wal('U', 'public.tickets', (select r from tests.row_a))) $$,
  'a crew gets none'
);
select is_empty(
  $$ select * from tests.delivered('00000000-0000-4000-8000-0000000000e0',
       tests.wal('U', 'public.tickets', (select r from tests.row_a))) $$,
  'a removed admin''s live subscription gets none'
);
select is_empty(
  $$ select * from tests.delivered('00000000-0000-4000-8000-0000000000e1',
       tests.wal('U', 'public.tickets', (select r from tests.row_a))) $$,
  'nor a deleted admin''s'
);
select is(
  (select count(*)::int from tests.delivered('00000000-0000-4000-8000-00000000000a',
     tests.wal('U', 'public.tickets', (select r from tests.row_a)))),
  1,
  'the ticket''s customer gets the status change'
);
select is(
  (select count(*)::int from tests.delivered('00000000-0000-4000-8000-0000000000ad',
     tests.wal('U', 'public.tickets', (select r from tests.row_a)))),
  1,
  'and so does an admin'
);
select is(
  (select count(*)::int from tests.delivered(
     '00000000-0000-4000-8000-00000000000b',
     tests.wal('D', 'public.tickets', (select r from tests.row_a))) as d
   where (d -> 'old_record')::text like '%' || tests.a()::text || '%'
      or (d -> 'old_record')::text like '%' || tests.id('order_a')::text || '%'
      or d -> 'old_record' ?| array['user_id', 'order_id', 'number', 'client_id']),
  0,
  'a tickets DELETE event gives another customer no user, order, number or client id'
);

-- Held: removed and deleted admins --------------------------------------------------------------

select tests.authenticate_as(tests.ex());
select throws_ok(
  $$ select public.admin_set_ticket_status(tests.id('ticket_a'), 'closed') $$,
  '42501', 'not_allowed', 'a removed admin cannot change a ticket''s status'
);
select throws_ok(
  $$ select public.admin_add_ticket_note(tests.id('ticket_a'), 'ملاحظة') $$,
  '42501', 'not_allowed', 'nor add a note'
);
select is_empty($$ select 1 from public.ticket_notes $$, 'nor read the notes');
select is_empty(
  $$ select 1 from public.tickets where user_id <> auth.uid()
     union all select 1 from public.ticket_media where user_id <> auth.uid() $$,
  'nor read customers'' tickets or their files'
);
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'ticket-media' $$,
  'nor list ticket-media'
);
select throws_ok(
  $$ select * from public.admin_rating_summary() $$,
  '42501', 'not_allowed', 'nor read the rating summary'
);

select tests.authenticate_as(tests.gone());
select throws_ok(
  $$ select public.admin_set_ticket_status(tests.id('ticket_a'), 'closed') $$,
  '42501', 'not_allowed', 'a deleted admin cannot change a ticket''s status'
);
select is_empty($$ select 1 from public.ticket_notes $$, 'nor read the notes');

-- Held: create_ticket ---------------------------------------------------------------------------

-- A file in A's folder that someone else owns (only the server could put it
-- there; the INSERT policy pins the folder).
select tests.clear_authentication();
select tests.create_object('ticket-media', tests.a() || '/planted.jpg', tests.b());

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.create_ticket(
       gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
       jsonb_build_array(jsonb_build_object('path', tests.a() || '/planted.jpg'))
     ) $$,
  'ZL009', 'upload_not_found', 'a file in the customer''s folder that someone else owns is refused'
);

select tests.authenticate_as(tests.b());
select isnt(
  (select ticket_id from public.create_ticket(tests.id('client_a'), 'other', 'بلاغ الزبون الثاني هنا')),
  tests.id('ticket_a'),
  'another customer reusing a customer''s client id does not get that customer''s ticket'
);
select is(
  (select count(*)::int from public.tickets where client_id = tests.id('client_a')),
  1,
  'they get a new ticket of their own'
);

select tests.clear_authentication();
update public.profiles set deleted_at = now() where id = tests.b();
select tests.authenticate_as(tests.b());
select throws_ok(
  $$ select public.create_ticket(gen_random_uuid(), 'other', 'بلاغ من حساب محذوف') $$,
  '42501', 'not_allowed', 'a deleted customer cannot report'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('ticket-media', auth.uid() || '/late.jpg', auth.uid()::text) $$,
  '42501', null, 'nor upload a ticket file'
);

select * from finish();
rollback;
