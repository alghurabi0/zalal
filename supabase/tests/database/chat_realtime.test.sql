-- Realtime for chat (spec §3, §5.16, §8.2 A4). Events run through
-- realtime.apply_rls(), the SQL the Realtime server calls for each change.
-- INSERT and UPDATE events of chat_threads and chat_messages reach only the
-- thread's customer and admins. A DELETE event (none happen today, but
-- Realtime would send one to every subscriber without RLS) carries only the
-- row's own uuid key: no thread, customer, order or text.
begin;
\ir _helpers.psql

select plan(10);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));
insert into tests.ids values ('order_a', tests.create_order(tests.user_id('+9647801111111')));

update public.settings as s
set working_days = '{0,1,2,3,4,5,6}', working_hours_start = '00:00', working_hours_end = '24:00'
where s.id;

select tests.authenticate_as(tests.user_id('+9647801111111'));
select public.send_chat_message(gen_random_uuid(), p_body => 'سر', p_order_id => tests.id('order_a'));
select tests.clear_authentication();

create table tests.msg as select to_jsonb(m) as r from public.chat_messages as m;
create table tests.thread as select to_jsonb(t) as r from public.chat_threads as t;

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
    'schema', 'public',
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

-- Subscriptions: …a = customer A, …b = customer B, …c = crew, …d = admin;
-- 1… on chat_messages, 2… on chat_threads.
insert into realtime.subscription (subscription_id, entity, claims)
select ('00000000-0000-4000-8000-' || lpad(t.n || s.n, 12, '0'))::uuid, t.entity,
  jsonb_build_object('role', 'authenticated', 'sub', tests.user_id(s.phone))
from (values ('1', 'public.chat_messages'::regclass), ('2', 'public.chat_threads'::regclass)) as t (n, entity),
  (values ('a', '+9647801111111'), ('b', '+9647802222222'), ('c', '+9647703333333'), ('d', '+9647504444444')) as s (n, phone);

create function tests.sub(p_table text, p_who text) returns uuid language sql immutable
as $$ select ('00000000-0000-4000-8000-' || lpad(p_table || p_who, 12, '0'))::uuid $$;

select is(
  (select count(*)::int from tests.delivered(tests.sub('1', 'a'), tests.wal('I', 'public.chat_messages', (select r from tests.msg)))),
  1, 'the customer gets their new message'
);
select is(
  (select count(*)::int from tests.delivered(tests.sub('1', 'd'), tests.wal('I', 'public.chat_messages', (select r from tests.msg)))),
  1, 'an admin gets it'
);
select is_empty(
  $$ select * from tests.delivered(tests.sub('1', 'b'), tests.wal('I', 'public.chat_messages', (select r from tests.msg))) $$,
  'another customer does not'
);
select is_empty(
  $$ select * from tests.delivered(tests.sub('1', 'c'), tests.wal('U', 'public.chat_messages', (select r from tests.msg))) $$,
  'a crew gets no message updates'
);
select is_empty(
  $$ select * from tests.delivered(tests.sub('1', 'b'), tests.wal('U', 'public.chat_messages', (select r from tests.msg))) $$,
  'another customer gets no read receipts'
);
select is(
  (select count(*)::int from tests.delivered(tests.sub('2', 'a'), tests.wal('U', 'public.chat_threads', (select r from tests.thread)))),
  1, 'the customer gets their thread''s unread count'
);
select is_empty(
  $$ select * from tests.delivered(tests.sub('2', 'b'), tests.wal('U', 'public.chat_threads', (select r from tests.thread))) $$,
  'another customer does not'
);
select is(
  (select count(*)::int from tests.delivered(tests.sub('2', 'd'), tests.wal('U', 'public.chat_threads', (select r from tests.thread)))),
  1, 'an admin gets every thread''s'
);

select is(
  (select count(*)::int from tests.delivered(tests.sub('1', 'b'), tests.wal('D', 'public.chat_messages', (select r from tests.msg))) as d
   where (d -> 'old_record')::text ~ ((select r ->> 'thread_id' from tests.msg) || '|' || tests.id('order_a') || '|' || tests.user_id('+9647801111111') || '|سر')),
  0, 'a message DELETE event carries no thread, order, customer or text'
);
select is(
  (select count(*)::int from tests.delivered(tests.sub('2', 'b'), tests.wal('D', 'public.chat_threads', (select r from tests.thread))) as d
   where (d -> 'old_record')::text like '%' || tests.user_id('+9647801111111') || '%'),
  0, 'a thread DELETE event carries no customer id'
);

select * from finish();
rollback;
