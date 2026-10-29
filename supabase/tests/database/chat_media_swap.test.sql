-- The chat-media swap (spec §13 "Chat media swap"; Phase 6, task 4; settled
-- Oct 28, 2026), fixed the way migration tickets_app fixed ticket-media:
-- - send_chat_message() locks the file while it attaches it (an update of
--   the storage object, not a plain read), so a delete running at the same
--   moment waits and then sees the file sent;
-- - private.chat_media_sent() is volatile, so that waiting delete re-checks
--   with a fresh snapshot;
-- - the chat-media upload policy refuses the name of a sent file, so if a
--   sent file is ever missing nobody can put other content under its name.
-- Unsent files keep working as before for customers and admins.
begin;
\ir _helpers.psql

select plan(9);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647504444444', 'admin');

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;
grant execute on all functions in schema tests to anon, authenticated;

update public.settings as s
set working_days = '{0,1,2,3,4,5,6}', working_hours_start = '00:00', working_hours_end = '24:00'
where s.id;

select is(
  (select provolatile::text from pg_proc where oid = 'private.chat_media_sent(text)'::regprocedure),
  'v',
  'private.chat_media_sent is volatile'
);
select ok(
  (select prosrc from pg_proc where oid = 'public.send_chat_message(uuid, uuid, text, text, numeric, uuid, public.chat_topic)'::regprocedure)
    ~ 'update storage\.objects',
  'send_chat_message locks the file it attaches'
);

select tests.create_object('chat-media', tests.a() || '/sent.jpg', tests.a());
select tests.create_object('chat-media', tests.admin() || '/answer.jpg', tests.admin());
select tests.authenticate_as(tests.a());
select lives_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/sent.jpg') $$,
  'a customer sends a file'
);
select tests.authenticate_as(tests.admin());
select lives_ok(
  $$ select public.send_chat_message(
       gen_random_uuid(), (select id from public.chat_threads where user_id = tests.a()),
       p_media_path => tests.admin() || '/answer.jpg') $$,
  'an admin sends a file'
);
select tests.clear_authentication();

-- The state after the race: the sent objects are gone.
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id = 'chat-media' and name in (tests.a() || '/sent.jpg', tests.admin() || '/answer.jpg');
select set_config('storage.allow_delete_query', 'false', true);

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('chat-media', auth.uid() || '/sent.jpg', auth.uid()::text, '{"mimetype": "image/png", "size": 66}') $$,
  '42501', null,
  'a customer cannot upload new content under the name of a sent file'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('chat-media', auth.uid() || '/fresh.jpg', auth.uid()::text, '{"mimetype": "image/png", "size": 66}') $$,
  'a new name still uploads'
);
select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('chat-media', auth.uid() || '/answer.jpg', auth.uid()::text, '{"mimetype": "image/png", "size": 66}') $$,
  '42501', null,
  'nor can an admin, under the name of a file they sent'
);
select tests.authenticate_as_anon();
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('chat-media', 'x/sent.jpg') $$,
  '42501', null, 'guests still upload nothing'
);
select tests.clear_authentication();

-- A file can't be sent twice (unchanged).
select tests.create_object('chat-media', tests.a() || '/twice.jpg', tests.a());
select tests.authenticate_as(tests.a());
select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/twice.jpg');
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/twice.jpg') $$,
  'ZL009', 'upload_not_found', 'a sent file is not sent again'
);
select tests.clear_authentication();

select * from finish();
rollback;
