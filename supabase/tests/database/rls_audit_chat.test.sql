-- RLS audit of migration chat (chat_threads, chat_messages, send_chat_message,
-- mark_chat_read, chat_thread, admin_chat_inbox, the system-message
-- triggers, chat-media Storage policies): the attempts the feature's own tests
-- don't make.
--
-- Findings (fixed in the migration before merge: "sent" is checked without
-- RLS by private.chat_media_sent, and the retry lookup stays in the thread):
-- - The chat-media delete policy's `not exists (… chat_messages …)` runs
--   under the caller's RLS. An uploader who can no longer see the message
--   that carries their file passes it: an admin removed through
--   admin_remove_admin (now a customer) or a deleted admin, with a live
--   session. The own-folder SELECT branch keeps the object visible, so the
--   delete goes through. The removed admin can then upload new content under
--   the same path (own folder, customer role), and every customer they once
--   answered sees it as support's attachment.
-- - send_chat_message's retry lookup (sender_id, client_id) has no thread
--   check, so a removed admin gets back, by client id, a message they sent
--   as admin in another customer's thread: its customer, thread and whether
--   the customer has read it.
--
-- The rest are attacks that held (passing): what a removed or deleted admin
-- can still do through the RPCs, attaching uploads that aren't the sender's,
-- overwriting a sent file, forging ticket and no-show messages, client-id
-- reuse across customers, and the unread counters after all of it.
begin;
\ir _helpers.psql

select plan(23);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
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

-- Who send_chat_message's answer belongs to for this client id: the
-- returned message's customer, or null when the call fails.
create function tests.retry_owner(p_client_id uuid) returns uuid
language plpgsql
as $$
declare
  v_customer uuid;
begin
  select m.customer_id into v_customer
  from public.send_chat_message(p_client_id, p_body => 'نفس الرسالة') as m;
  return v_customer;
exception when others then
  return null;
end;
$$;

-- Always open, so no automatic replies.
update public.settings as s
set working_days = '{0,1,2,3,4,5,6}', working_hours_start = '00:00', working_hours_end = '24:00'
where s.id;

insert into tests.ids values
  ('order_a', tests.create_order(tests.a(), 'confirmed', now() + interval '1 day')),
  ('client_a', gen_random_uuid()),
  ('client_ex', gen_random_uuid());

select tests.create_object('chat-media', tests.a() || '/sent.jpg', tests.a());
select tests.create_object('chat-media', tests.a() || '/draft.jpg', tests.a());
select tests.create_object('chat-media', tests.a() || '/planted.jpg', tests.admin());
select tests.create_object('chat-media', tests.admin() || '/draft.jpg', tests.admin());
select tests.create_object('chat-media', tests.ex() || '/answer.jpg', tests.ex());
select tests.create_object('chat-media', tests.gone() || '/answer.jpg', tests.gone());

select tests.authenticate_as(tests.a());
select public.send_chat_message(tests.id('client_a'), p_body => 'عندي سؤال', p_media_path => tests.a() || '/sent.jpg');
insert into tests.ids values ('thread_a', public.chat_thread());
select tests.authenticate_as(tests.b());
select public.send_chat_message(gen_random_uuid(), p_body => 'من علي');

select tests.authenticate_as(tests.ex());
select public.send_chat_message(
  tests.id('client_ex'), tests.id('thread_a'), 'هذا الجواب', p_media_path => tests.ex() || '/answer.jpg'
);
select tests.authenticate_as(tests.gone());
select public.send_chat_message(
  gen_random_uuid(), tests.id('thread_a'), p_media_path => tests.gone() || '/answer.jpg'
);

-- One admin removed (admin_remove_admin sets the role back to customer),
-- one deleted; both keep their session.
select tests.clear_authentication();
update public.profiles set role = 'customer' where id = tests.ex();
update public.profiles set deleted_at = now() where id = tests.gone();
set local storage.allow_delete_query = 'true';

-- Finding: files sent as admin are deleted and replaced -------------------------

select tests.authenticate_as(tests.ex());
select is_empty(
  $$ delete from storage.objects
     where bucket_id = 'chat-media' and name = tests.ex() || '/answer.jpg' returning 1 $$,
  'a removed admin cannot delete a file they sent to a customer'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('chat-media', auth.uid() || '/answer.jpg', auth.uid(), auth.uid()::text,
             '{"mimetype": "image/png", "size": 66}') $$,
  null, null,
  'nor upload new content under its path'
);

select tests.authenticate_as(tests.a());
select results_eq(
  $$ select o.metadata ->> 'size'
     from public.chat_messages as m
     join storage.objects as o on o.bucket_id = 'chat-media' and o.name = m.media_path
     where m.sender_id = tests.ex() $$,
  $$ values ('1000') $$,
  'the customer still gets the file support sent, not a replacement'
);

select tests.authenticate_as(tests.gone());
select is_empty(
  $$ delete from storage.objects
     where bucket_id = 'chat-media' and name = tests.gone() || '/answer.jpg' returning 1 $$,
  'a deleted admin cannot delete a file they sent'
);

-- Finding: the retry lookup crosses threads ----------------------------------------

select tests.authenticate_as(tests.ex());
select ok(
  tests.retry_owner(tests.id('client_ex')) is distinct from tests.a(),
  'a removed admin cannot read back, by client id, a message they sent in a customer''s thread'
);

-- Held: a removed or deleted admin through the RPCs ----------------------------------

select is_empty('select 1 from public.chat_threads where user_id <> auth.uid()', 'a removed admin reads no one else''s thread');
select is_empty('select 1 from public.chat_messages where customer_id <> auth.uid()', 'nor their messages');
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), tests.id('thread_a'), 'x') $$,
  'P0002', 'thread_not_found', 'a removed admin cannot write in a customer''s thread'
);
select throws_ok(
  $$ select public.mark_chat_read(tests.id('thread_a')) $$,
  'P0002', 'thread_not_found', 'nor mark it read'
);
select throws_ok(
  'select * from public.admin_chat_inbox()', '42501', 'not_allowed', 'nor read the inbox'
);
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'chat-media' and name = tests.a() || '/sent.jpg' $$,
  'nor the customer''s files'
);

select tests.authenticate_as(tests.gone());
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), tests.id('thread_a'), 'x') $$,
  '42501', 'not_allowed', 'a deleted admin cannot send'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('chat-media', auth.uid() || '/new.jpg', auth.uid()::text) $$,
  '42501', null, 'nor upload'
);

-- Held: uploads that aren't the sender's -------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/planted.jpg') $$,
  'ZL009', 'upload_not_found', 'a file in the customer''s folder that someone else owns is refused'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => tests.admin() || '/draft.jpg') $$,
  'ZL009', 'upload_not_found', 'support''s unsent upload is refused'
);

select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), tests.id('thread_a'), p_media_path => tests.a() || '/draft.jpg') $$,
  'ZL009', 'upload_not_found', 'an admin cannot attach a customer''s upload'
);

-- Held: overwriting a sent file ------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('chat-media', auth.uid() || '/sent.jpg', auth.uid()::text) $$,
  '23505', null, 'a customer cannot upload again over a file they sent'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('chat-media', auth.uid() || '/sent.jpg', auth.uid()::text)
     on conflict (bucket_id, name collate "C") where archived_at is null
     do update set metadata = '{"size": 1}' $$,
  '42501', null, 'nor upsert over it (x-upsert)'
);

-- Held: forging system messages ------------------------------------------------------

select throws_ok(
  $$ insert into public.tickets (user_id) values (auth.uid()) $$,
  '42501', null, 'a customer cannot open a ticket directly, and with it a ticket message'
);
select throws_ok(
  $$ select public.transition_order(tests.id('order_a'), 'no_show', '{"reason": "x"}') $$,
  'ZL010', 'invalid_transition', 'nor mark their own order a no-show'
);
select is_empty(
  $$ select 1 from public.chat_messages where author = 'system' $$,
  'so no system message was posted'
);

-- Held: client ids belong to their sender --------------------------------------------

select tests.authenticate_as(tests.b());
select is(
  tests.retry_owner(tests.id('client_a')), tests.b(),
  'another customer reusing a customer''s client id gets a new message in their own thread'
);

-- Held: counters ----------------------------------------------------------------------

select tests.clear_authentication();
select results_eq(
  $$ select t.id, t.admin_unread, t.customer_unread from public.chat_threads as t order by t.id $$,
  $$ select t.id,
       (select count(*)::int from public.chat_messages as m
        where m.thread_id = t.id and m.author = 'customer' and m.read_at is null),
       (select count(*)::int from public.chat_messages as m
        where m.thread_id = t.id and m.author <> 'customer' and m.read_at is null)
     from public.chat_threads as t order by t.id $$,
  'every thread''s unread counts match its messages after the attempts'
);

select * from finish();
rollback;
