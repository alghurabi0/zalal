-- chat_threads and chat_messages (spec §5.16, §7, §8.2 A4).
--
-- One thread per customer. A customer reads only their own thread and its
-- messages; admins read every thread; crews and guests read nothing. Nobody
-- writes the tables directly: messages go through send_chat_message() and the
-- system triggers, read marks through mark_chat_read(). Each new message
-- moves the thread's last_message_at and adds one to the other side's unread
-- count. A message's order tag must be an order of the thread's customer, and
-- its thread must be that customer's (foreign keys through customer_id).
-- Both tables are in the Realtime publication.
begin;
\ir _helpers.psql

select plan(36);

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

insert into public.chat_threads (user_id) values (tests.a()), (tests.b());
insert into tests.ids
select 'thread_' || case when user_id = tests.a() then 'a' else 'b' end, id
from public.chat_threads;

insert into tests.ids values ('order_a', tests.create_order(tests.a()));
insert into tests.ids values ('order_b', tests.create_order(tests.b()));

-- A message as the test runner, past the RPCs.
create function tests.msg(p_thread text, p_author text, p_body text) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_customer uuid := (select t.user_id from public.chat_threads as t where t.id = tests.id(p_thread));
begin
  insert into public.chat_messages (thread_id, customer_id, author, sender_id, body, client_id)
  values (
    tests.id(p_thread), v_customer, p_author::public.chat_author,
    case p_author when 'customer' then v_customer when 'admin' then tests.admin() end,
    p_body, gen_random_uuid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

select tests.msg('thread_a', 'customer', 'مرحبا');
select tests.msg('thread_a', 'admin', 'هلا بيك');
select tests.msg('thread_a', 'customer', 'شكراً');
select tests.msg('thread_b', 'customer', 'سؤال');

-- Shape ----------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.chat_threads'::regclass),
  'chat_threads has RLS on'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.chat_messages'::regclass),
  'chat_messages has RLS on'
);
select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_threads'
  ),
  'chat_threads is in the Realtime publication'
);
select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ),
  'chat_messages is in the Realtime publication'
);
select col_type_is('public', 'chat_threads', 'id', 'uuid', 'thread keys say nothing (uuid)');
select col_type_is('public', 'chat_messages', 'id', 'uuid', 'message keys say nothing (uuid)');

-- Counters -------------------------------------------------------------------------

select results_eq(
  $$ select admin_unread, customer_unread, last_message_at is not null
     from public.chat_threads where id = tests.id('thread_a') $$,
  $$ values (2, 1, true) $$,
  'each message counts as unread for the other side and moves last_message_at'
);
select results_eq(
  $$ select admin_unread, customer_unread from public.chat_threads where id = tests.id('thread_b') $$,
  $$ values (1, 0) $$,
  'threads count on their own'
);

-- Reads ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  'select * from public.chat_threads', '42501', null, 'a guest cannot read threads'
);
select throws_ok(
  'select * from public.chat_messages', '42501', null, 'a guest cannot read messages'
);

select tests.authenticate_as(tests.a());
select results_eq(
  'select id from public.chat_threads',
  $$ values (tests.id('thread_a')) $$,
  'a customer reads only their own thread'
);
select is(
  (select count(*)::int from public.chat_messages),
  3,
  'a customer reads the messages of their own thread'
);
select is_empty(
  $$ select 1 from public.chat_messages where thread_id = tests.id('thread_b') $$,
  'a customer cannot read another customer''s messages'
);

select tests.authenticate_as(tests.b());
select results_eq(
  'select id from public.chat_threads',
  $$ values (tests.id('thread_b')) $$,
  'another customer reads only theirs'
);
select is(
  (select count(*)::int from public.chat_messages), 1, 'and only their own messages'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty('select 1 from public.chat_threads', 'a crew reads no threads');
select is_empty('select 1 from public.chat_messages', 'a crew reads no messages');

select tests.authenticate_as(tests.admin());
select is((select count(*)::int from public.chat_threads), 2, 'an admin reads every thread');
select is((select count(*)::int from public.chat_messages), 4, 'an admin reads every message');

-- No direct writes -----------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ insert into public.chat_messages (thread_id, customer_id, author, sender_id, body, client_id)
     values (tests.id('thread_a'), auth.uid(), 'customer', auth.uid(), 'x', gen_random_uuid()) $$,
  '42501', null, 'a customer cannot insert messages directly'
);
select throws_ok(
  $$ update public.chat_messages set read_at = now() $$,
  '42501', null, 'a customer cannot mark messages read directly'
);
select throws_ok(
  $$ update public.chat_threads set admin_unread = 0 $$,
  '42501', null, 'a customer cannot change their thread'
);
select throws_ok(
  $$ insert into public.chat_threads (user_id) values (auth.uid()) $$,
  '42501', null, 'a customer cannot create a thread directly'
);
select throws_ok(
  $$ delete from public.chat_messages $$,
  '42501', null, 'a customer cannot delete messages'
);

select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ insert into public.chat_messages (thread_id, customer_id, author, sender_id, body, client_id)
     values (tests.id('thread_a'), tests.a(), 'admin', auth.uid(), 'x', gen_random_uuid()) $$,
  '42501', null, 'an admin cannot insert messages directly either'
);
select throws_ok(
  $$ update public.chat_threads set customer_unread = 0 $$,
  '42501', null, 'an admin cannot change threads directly'
);
select throws_ok(
  $$ delete from public.chat_threads $$,
  '42501', null, 'an admin cannot delete threads'
);

-- Constraints ----------------------------------------------------------------------

select tests.clear_authentication();

select throws_ok(
  $$ insert into public.chat_threads (user_id) values (tests.a()) $$,
  '23505', null, 'one thread per customer'
);
select throws_ok(
  $$ insert into public.chat_messages (thread_id, customer_id, author, sender_id, body, client_id)
     values (tests.id('thread_a'), tests.b(), 'customer', tests.b(), 'x', gen_random_uuid()) $$,
  '23503', null, 'a message belongs to its thread''s customer'
);
select throws_ok(
  $$ insert into public.chat_messages (thread_id, customer_id, author, sender_id, body, order_id, client_id)
     values (tests.id('thread_a'), tests.a(), 'customer', tests.a(), 'x', tests.id('order_b'), gen_random_uuid()) $$,
  '23503', null, 'an order tag must be an order of the thread''s customer'
);
select throws_ok(
  $$ insert into public.chat_messages (thread_id, customer_id, author, sender_id, client_id)
     values (tests.id('thread_a'), tests.a(), 'customer', tests.a(), gen_random_uuid()) $$,
  '23514', null, 'a message needs text, a file or a topic'
);
select throws_ok(
  $$ insert into public.chat_messages (thread_id, customer_id, author, sender_id, body, client_id)
     values (tests.id('thread_a'), tests.a(), 'customer', tests.a(), repeat('x', 2001), gen_random_uuid()) $$,
  '23514', null, 'text is at most 2,000 characters'
);
select throws_ok(
  $$ insert into public.chat_messages (thread_id, customer_id, author, sender_id, topic, client_id)
     values (tests.id('thread_a'), tests.a(), 'customer', tests.a(), 'cancel', gen_random_uuid()) $$,
  '23514', null, 'the cancel and reschedule topics need an order'
);
select throws_ok(
  $$ insert into public.chat_messages (thread_id, customer_id, author, sender_id, kind, body)
     values (tests.id('thread_a'), tests.a(), 'system', tests.admin(), 'auto_reply', 'x') $$,
  '23514', null, 'a system message has no sender'
);
select throws_ok(
  $$ insert into public.chat_messages (thread_id, customer_id, author, kind, order_id)
     values (tests.id('thread_a'), tests.a(), 'customer', 'no_show', tests.id('order_a')) $$,
  '23514', null, 'only the system writes no-show, ticket and auto-reply messages'
);
select throws_ok(
  $$ insert into public.chat_messages (thread_id, customer_id, author, sender_id, body, client_id)
     select thread_id, customer_id, author, sender_id, 'again', client_id
     from public.chat_messages where thread_id = tests.id('thread_b') $$,
  '23505', null, 'a sender''s client id is used once'
);

select * from finish();
rollback;
