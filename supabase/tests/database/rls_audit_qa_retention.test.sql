-- RLS audit of migration qa_retention (private.purge_expired_media,
-- private.scrub_audit_text and the re-created delete_account, the
-- certificate folder of unattached_media / media-cleanup, and the chat-media
-- swap fix: send_chat_message's lock, the volatile chat_media_sent and the
-- new upload policy): the attempts the feature's own tests don't make.
--
-- Finding (fixed in the same migration: delete_account() now deletes those
-- notifications, and the migration does it once for earlier deletions):
-- - delete_account() deletes the chat thread and every message (spec §7
--   "Accounts"), but each admin's `customer_message` notification keeps an
--   80-character excerpt of the customer's message and the thread id in
--   `data` (private.notify_chat_message, migration notifications). Those rows
--   belong to the admins, so the deletion's `notifications where user_id =
--   the customer` misses them, and every admin keeps reading the deleted
--   customer's words for up to 90 days (notifications-prune).
--
-- The rest are attacks that held (passing): a certificate PDF still named
-- by a certificate whose order left completed is never listed for the
-- sweep, an unsent chat file can be deleted and uploaded again under the
-- same name (a retry), an admin can't attach a customer's upload through
-- the new update, and a deleted account can't run the scrub again.
begin;
\ir _helpers.psql

select plan(7);

select tests.create_user('+9647801111111');            -- customer A (deleted)
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_user('+9647505555555', 'admin');

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;
create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;
grant execute on all functions in schema tests to anon, authenticated;

update public.settings as s
set working_days = '{0,1,2,3,4,5,6}', working_hours_start = '00:00', working_hours_end = '24:00'
where s.id;

-- Finding: admins keep excerpts of a deleted customer's messages --------------------

select tests.authenticate_as(tests.a());
select public.send_chat_message(gen_random_uuid(), p_body => 'Ahmed Kadhim, house behind the Hussainiya, call 07801111111');
select tests.clear_authentication();
insert into tests.ids select 'thread_a', id from public.chat_threads where user_id = tests.a();

select ok(
  (select count(*) from public.notifications
   where type = 'customer_message' and data ->> 'thread_id' = tests.id('thread_a')::text) = 2,
  'precondition: both admins got the message''s excerpt'
);

select tests.authenticate_as(tests.a());
select public.delete_account();
select tests.clear_authentication();

select is_empty(
  $$ select 1 from public.notifications
     where type = 'customer_message'
       and (data ->> 'thread_id' = tests.id('thread_a')::text or data ->> 'excerpt' like 'Ahmed Kadhim%') $$,
  'after delete_account no admin notification keeps the deleted customer''s message'
);

-- Held: a deleted account can't run the scrub (or the deletion) again --------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.delete_account() $$, '42501', 'not_allowed',
  'a deleted account''s remaining token can''t call delete_account (and its scrub) again'
);
select tests.clear_authentication();

-- Held: the certificate sweep never lists a recorded PDF -----------------------------

-- An order that left completed by an override keeps its certificate row and
-- pdf_path: its PDF is not a leftover.
insert into tests.ids values ('b_order', tests.create_order(tests.b(), 'cancelled', now() - interval '20 days'));
insert into public.certificates (order_id, public_code, next_due_on)
values (tests.id('b_order'), 'QRSTUVWX', current_date + 180);
insert into tests.ids select 'b_cert', id from public.certificates where order_id = tests.id('b_order');
insert into storage.objects (bucket_id, name, metadata, created_at, updated_at)
values ('certificates', tests.id('b_cert') || '/1.pdf', '{"mimetype": "application/pdf", "size": 1000}',
        now() - interval '30 days', now() - interval '30 days');
update public.certificates set pdf_path = tests.id('b_cert') || '/1.pdf' where id = tests.id('b_cert');

select tests.authenticate_as_service_role();
select is_empty(
  $$ select 1 from public.unattached_media('certificate') where name = tests.id('b_cert') || '/1.pdf' $$,
  'a PDF recorded on a certificate whose order left completed is not swept'
);
select tests.clear_authentication();

-- Held: the chat upload policy and a retry -------------------------------------------

select tests.authenticate_as(tests.b());
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('chat-media', auth.uid() || '/retry.jpg', auth.uid()::text, '{"mimetype": "image/jpeg", "size": 10}');
set local storage.allow_delete_query = 'true';
select isnt_empty(
  $$ delete from storage.objects where bucket_id = 'chat-media' and name = auth.uid() || '/retry.jpg' returning 1 $$,
  'a customer deletes an unsent file (a failed upload)'
);
reset storage.allow_delete_query;
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('chat-media', auth.uid() || '/retry.jpg', auth.uid()::text, '{"mimetype": "image/jpeg", "size": 20}') $$,
  'and uploads again under the same name (the upload policy refuses only sent names)'
);
select tests.clear_authentication();

-- Held: an admin can't attach a customer's file through the new update -------------

select tests.authenticate_as(tests.b());
select public.send_chat_message(gen_random_uuid(), p_body => 'hello');
select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ select public.send_chat_message(
       gen_random_uuid(), (select id from public.chat_threads where user_id = tests.b()),
       p_media_path => tests.b() || '/retry.jpg') $$,
  'ZL009', 'upload_not_found',
  'an admin cannot attach (and so lock) a customer''s unsent upload'
);
select tests.clear_authentication();

select * from finish();
rollback;
