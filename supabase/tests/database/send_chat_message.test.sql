-- send_chat_message(client_id, thread_id, body, media_path, duration_s,
-- order_id, topic) (spec §5.16, §8.2 A4).
--
-- A customer writes to their own thread, made on first use; thread_id may be
-- left out, and another customer's is P0002. An admin writes to any thread
-- (thread_id required, P0002 otherwise) and never with a topic. Crews and
-- guests may not. The client id makes a retry return the first message.
-- Text is trimmed, at most 2,000 characters; a message needs text, a file or
-- a topic. reschedule and cancel need an order; an order tag must be the
-- thread customer's (P0002). A file must be the sender's own finished upload
-- in chat-media/<user id>/, at most 48 hours old and not attached yet
-- (ZL009); its type and size come from Storage, videos need a length of
-- 0–60 s and photos none. 20 messages a minute per sender (ZL027).
-- A customer message outside working hours gets one automatic reply with
-- settings.support_response_text, unless one was sent since hours last
-- closed or an admin last replied; none when the text is empty.
begin;
\ir _helpers.psql

select plan(48);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647803333333');            -- customer C (rate limit)
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;
create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;

insert into tests.ids values ('order_a', tests.create_order(tests.a()));
insert into tests.ids values ('order_b', tests.create_order(tests.b()));
insert into tests.ids values ('client1', gen_random_uuid());

-- Always open: every day, 00:00–24:00.
update public.settings as s
set working_days = '{0,1,2,3,4,5,6}', working_hours_start = '00:00', working_hours_end = '24:00',
  support_response_text = 'وصلت رسالتك وراح نرد عليك أول ما نرجع.'
where s.id;

select tests.create_object('chat-media', tests.a() || '/photo.jpg', tests.a());
select tests.create_object('chat-media', tests.a() || '/clip.mp4', tests.a(), 'video/mp4', 5000000);
select tests.create_object('chat-media', tests.a() || '/clip2.mp4', tests.a(), 'video/mp4');
select tests.create_object('chat-media', tests.a() || '/old.jpg', tests.a());
update storage.objects set created_at = now() - interval '49 hours'
where bucket_id = 'chat-media' and name = tests.a() || '/old.jpg';
select tests.create_object('chat-media', tests.b() || '/b.jpg', tests.b());
select tests.create_object('order-media', 'customer/' || tests.a() || '/o.jpg', tests.a());
select tests.create_object('chat-media', tests.admin() || '/answer.jpg', tests.admin());

-- Who may send ---------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_body => 'x') $$,
  '42501', null, 'a guest cannot send'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_body => 'x') $$,
  '42501', 'not_allowed', 'a crew cannot send'
);

-- Customer -------------------------------------------------------------------------

select tests.authenticate_as(tests.a());

select results_eq(
  $$ select author::text, sender_id, body, kind::text, read_at is null
     from public.send_chat_message(tests.id('client1'), p_body => '  مرحبا  ') $$,
  $$ values ('customer', tests.a(), 'مرحبا', 'message', true) $$,
  'a customer''s first message makes their thread; text is trimmed'
);
select is(
  (select count(*)::int from public.chat_threads where user_id = tests.a()), 1, 'one thread'
);
select is(
  (select admin_unread from public.chat_threads where user_id = tests.a()), 1,
  'the message is unread for support'
);
select is(
  (select id from public.send_chat_message(tests.id('client1'), p_body => 'مرحبا')),
  (select id from public.chat_messages where client_id = tests.id('client1')),
  'a retry with the same client id returns the first message'
);
select is(
  (select count(*)::int from public.chat_messages), 1, 'and posts nothing new'
);

insert into tests.ids select 'thread_a', id from public.chat_threads where user_id = tests.a();

select lives_ok(
  $$ select public.send_chat_message(gen_random_uuid(), tests.id('thread_a'), 'ثانية') $$,
  'a customer may name their own thread'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_body => '   ') $$,
  '22023', 'empty_message', 'a blank message is refused'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_body => repeat('x', 2001)) $$,
  '22023', 'invalid_body', 'text over 2,000 characters is refused'
);
select throws_ok(
  $$ select public.send_chat_message(null, p_body => 'x') $$,
  '22023', 'client_id_required', 'a client id is required'
);

-- Topics and order tags
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_topic => 'reschedule') $$,
  '22023', 'order_required', 'reschedule needs an order'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_topic => 'cancel') $$,
  '22023', 'order_required', 'cancel needs an order'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_order_id => tests.id('order_b'), p_topic => 'cancel') $$,
  'P0002', 'order_not_found', 'another customer''s order cannot be tagged'
);
select results_eq(
  $$ select topic::text, order_id, body is null
     from public.send_chat_message(gen_random_uuid(), p_order_id => tests.id('order_a'), p_topic => 'cancel') $$,
  $$ values ('cancel', tests.id('order_a'), true) $$,
  'a cancel topic tags the customer''s own order, with no text'
);
select results_eq(
  $$ select topic::text, order_id from public.send_chat_message(gen_random_uuid(), p_topic => 'price') $$,
  $$ values ('price', null::uuid) $$,
  'the price topic needs no order'
);
select results_eq(
  $$ select topic, order_id, body
     from public.send_chat_message(gen_random_uuid(), p_body => 'عندي سؤال', p_order_id => tests.id('order_a')) $$,
  $$ values (null::public.chat_topic, tests.id('order_a'), 'عندي سؤال') $$,
  'text can be tagged with an order without a topic (مساعدة)'
);

-- Files
select results_eq(
  $$ select media_type::text, bytes, duration_s
     from public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/photo.jpg') $$,
  $$ values ('photo', 1000::bigint, null::numeric) $$,
  'a photo from the customer''s folder, its type and size from Storage'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/photo.jpg') $$,
  'ZL009', 'upload_not_found', 'a file already attached cannot be sent again'
);
select results_eq(
  $$ select media_type::text, bytes, duration_s, body
     from public.send_chat_message(gen_random_uuid(), p_body => 'التسريب', p_media_path => tests.a() || '/clip.mp4', p_duration_s => 15.2) $$,
  $$ values ('video', 5000000::bigint, 15.2::numeric, 'التسريب') $$,
  'a video with its length and a caption'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/clip2.mp4') $$,
  '22023', 'invalid_duration', 'a video needs its length'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/clip2.mp4', p_duration_s => 61) $$,
  '22023', 'invalid_duration', 'a video is at most 60 s'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/old.jpg', p_duration_s => 3) $$,
  'ZL009', 'upload_not_found', 'an upload over 48 h old is refused (checked before its length)'
);
select tests.clear_authentication();
update storage.objects set created_at = now()
where bucket_id = 'chat-media' and name = tests.a() || '/old.jpg';
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/old.jpg', p_duration_s => 3) $$,
  '22023', 'invalid_duration', 'a photo has no length'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => tests.b() || '/b.jpg') $$,
  'ZL009', 'upload_not_found', 'another customer''s upload is refused'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/missing.jpg') $$,
  'ZL009', 'upload_not_found', 'a missing upload is refused'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => 'customer/' || tests.a() || '/o.jpg') $$,
  'ZL009', 'upload_not_found', 'a booking upload (order-media) is refused'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/../' || tests.b() || '/b.jpg') $$,
  'ZL009', 'upload_not_found', 'a path outside the folder is refused'
);

-- Another customer's thread
select tests.authenticate_as(tests.b());
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), tests.id('thread_a'), 'x') $$,
  'P0002', 'thread_not_found', 'a customer cannot write to another customer''s thread'
);

-- Admin ----------------------------------------------------------------------------

select tests.authenticate_as(tests.admin());
select results_eq(
  $$ select author::text, sender_id, body
     from public.send_chat_message(gen_random_uuid(), tests.id('thread_a'), 'هلا بيك') $$,
  $$ values ('admin', tests.admin(), 'هلا بيك') $$,
  'an admin answers in a customer''s thread'
);
select is(
  (select customer_unread from public.chat_threads where id = tests.id('thread_a')), 1,
  'the answer is unread for the customer'
);
select results_eq(
  $$ select media_type::text
     from public.send_chat_message(gen_random_uuid(), tests.id('thread_a'), p_media_path => tests.admin() || '/answer.jpg') $$,
  $$ values ('photo') $$,
  'an admin sends a file from their own folder'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_body => 'x') $$,
  'P0002', 'thread_not_found', 'an admin must name a thread'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), gen_random_uuid(), 'x') $$,
  'P0002', 'thread_not_found', 'an unknown thread is refused'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), tests.id('thread_a'), p_topic => 'price') $$,
  '22023', 'invalid_topic', 'an admin message has no topic'
);
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), tests.id('thread_a'), 'x', p_order_id => tests.id('order_b')) $$,
  'P0002', 'order_not_found', 'an admin tag must be the thread customer''s order'
);
select is(
  (select count(*)::int from public.chat_messages where kind = 'auto_reply'),
  0,
  'inside working hours there is no automatic reply'
);

-- Off-hours automatic reply --------------------------------------------------------

select tests.clear_authentication();
update public.settings as s set working_days = '{}' where s.id;   -- always closed

select tests.authenticate_as(tests.b());
select public.send_chat_message(gen_random_uuid(), p_body => 'بالليل');
select results_eq(
  $$ select author::text, kind::text, sender_id, body
     from public.chat_messages where kind = 'auto_reply' $$,
  $$ values ('system', 'auto_reply', null::uuid, 'وصلت رسالتك وراح نرد عليك أول ما نرجع.') $$,
  'an off-hours message gets the automatic reply from settings'
);
select ok(
  (select created_at from public.chat_messages where kind = 'auto_reply')
    > (select created_at from public.chat_messages where body = 'بالليل'),
  'after the customer''s message'
);
select is(
  (select customer_unread from public.chat_threads where user_id = tests.b()), 1,
  'the automatic reply is unread for the customer'
);
select public.send_chat_message(gen_random_uuid(), p_body => 'وبعد');
select is(
  (select count(*)::int from public.chat_messages where kind = 'auto_reply'), 1,
  'one automatic reply per off-hours stretch'
);

insert into tests.ids select 'thread_b', id from public.chat_threads where user_id = tests.b();
select tests.authenticate_as(tests.admin());
select public.send_chat_message(gen_random_uuid(), tests.id('thread_b'), 'نرد عليك الصبح');
select is(
  (select count(*)::int from public.chat_messages where kind = 'auto_reply'), 1,
  'an admin answer posts no automatic reply'
);
select tests.authenticate_as(tests.b());
select public.send_chat_message(gen_random_uuid(), p_body => 'تمام');
select is(
  (select count(*)::int from public.chat_messages where kind = 'auto_reply'), 2,
  'after an admin reply, the next off-hours message gets one again'
);

-- An automatic reply from before hours last closed doesn't count. Open only in
-- the first second of each day, so now is after today's close.
select tests.clear_authentication();
update public.settings as s
set working_days = '{0,1,2,3,4,5,6}', working_hours_start = '00:00', working_hours_end = '00:00:01'
where s.id;
update public.chat_messages set created_at = now() - interval '2 days' where thread_id = tests.id('thread_b');
select tests.authenticate_as(tests.b());
select public.send_chat_message(gen_random_uuid(), p_body => 'يوم جديد');
select is(
  (select count(*)::int from public.chat_messages where kind = 'auto_reply'), 3,
  'a new off-hours stretch gets a new automatic reply'
);

select tests.clear_authentication();
update public.settings as s set working_days = '{}', support_response_text = '' where s.id;
select tests.authenticate_as(tests.a());
select public.send_chat_message(gen_random_uuid(), p_body => 'بدون رد');
select is(
  (select count(*)::int from public.chat_messages where kind = 'auto_reply' and thread_id = tests.id('thread_a')), 0,
  'no automatic reply while its text is empty'
);

-- Rate limit -----------------------------------------------------------------------

select tests.clear_authentication();
insert into public.chat_threads (user_id) values (tests.user_id('+9647803333333'));
insert into public.chat_messages (thread_id, customer_id, author, sender_id, body, client_id)
select t.id, t.user_id, 'customer', t.user_id, 'رسالة ' || n, gen_random_uuid()
from public.chat_threads as t, generate_series(1, 20) as n
where t.user_id = tests.user_id('+9647803333333');

select tests.authenticate_as(tests.user_id('+9647803333333'));
select throws_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_body => 'الـ 21') $$,
  'ZL027', 'too_many_messages', 'the 21st message in a minute is refused'
);
select tests.clear_authentication();
update public.chat_messages set created_at = now() - interval '61 seconds'
where customer_id = tests.user_id('+9647803333333');
select tests.authenticate_as(tests.user_id('+9647803333333'));
select lives_ok(
  $$ select public.send_chat_message(gen_random_uuid(), p_body => 'بعد دقيقة') $$,
  'a minute later it goes through'
);

-- Grants ---------------------------------------------------------------------------

select ok(
  not has_function_privilege(
    'anon', 'public.send_chat_message(uuid, uuid, text, text, numeric, uuid, public.chat_topic)', 'execute'
  ),
  'guests may not call it'
);

select * from finish();
rollback;
