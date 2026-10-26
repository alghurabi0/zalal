-- The other chat functions (spec §5.16, §5.18, §8.2 A4):
-- - chat_thread(): the customer's thread id, made on first call (Chat opens
--   it so it can listen before the first message). Customers only.
-- - mark_chat_read(thread_id): marks the other side's unread messages read
--   and recounts that side's unread count; returns how many it marked. The
--   customer on their own thread (support's and the system's messages), an
--   admin on any thread (the customer's). Another customer's thread P0002;
--   crews and guests may not.
-- - admin_chat_inbox(search, limit): threads that have messages, unread
--   first, then newest; with the customer's name and phone and the last
--   message. Search by name or phone digits. Admins only (42501).
-- - support_is_open() and private.support_open(at): inside working hours and
--   days, Baghdad time (end excluded). private.last_support_close(at): when
--   hours last closed before `at`.
-- - settings.support_response_text: the automatic reply, at most 300
--   characters, edited through admin_update_settings.
begin;
\ir _helpers.psql

select plan(31);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647803333333');            -- customer C, no messages
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));
update public.profiles set full_name = 'زيد' where id = tests.user_id('+9647801111111');
update public.profiles set full_name = 'علي' where id = tests.user_id('+9647802222222');

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;
create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;

-- Always open, so no automatic replies.
update public.settings as s
set working_days = '{0,1,2,3,4,5,6}', working_hours_start = '00:00', working_hours_end = '24:00'
where s.id;

-- chat_thread() --------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select isnt(public.chat_thread(), null, 'a customer gets a thread id');
select is(public.chat_thread(), public.chat_thread(), 'the same one every time');
insert into tests.ids values ('thread_a', public.chat_thread());
select results_eq(
  $$ select last_message_at, admin_unread, customer_unread from public.chat_threads $$,
  $$ values (null::timestamptz, 0, 0) $$,
  'an opened thread has no messages yet'
);

select tests.authenticate_as(tests.admin());
select throws_ok('select public.chat_thread()', '42501', 'not_allowed', 'an admin has no thread of their own');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok('select public.chat_thread()', '42501', 'not_allowed', 'a crew has no thread');
select tests.authenticate_as_anon();
select throws_ok('select public.chat_thread()', '42501', null, 'a guest has no thread');

-- Messages to read -----------------------------------------------------------------

select tests.authenticate_as(tests.a());
select public.send_chat_message(gen_random_uuid(), p_body => 'سؤال 1');
select public.send_chat_message(gen_random_uuid(), p_body => 'سؤال 2');
select tests.authenticate_as(tests.b());
select public.send_chat_message(gen_random_uuid(), p_body => 'من علي');
insert into tests.ids select 'thread_b', id from public.chat_threads where user_id = tests.b();
select tests.authenticate_as(tests.admin());
select public.send_chat_message(gen_random_uuid(), tests.id('thread_a'), 'جواب');
select tests.authenticate_as(tests.user_id('+9647803333333'));
select public.chat_thread();

-- mark_chat_read() -----------------------------------------------------------------

select tests.authenticate_as(tests.b());
select throws_ok(
  $$ select public.mark_chat_read(tests.id('thread_a')) $$,
  'P0002', 'thread_not_found', 'a customer cannot mark another customer''s thread'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.mark_chat_read(tests.id('thread_a')) $$,
  '42501', 'not_allowed', 'a crew cannot mark threads'
);
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.mark_chat_read(tests.id('thread_a')) $$,
  '42501', null, 'a guest cannot mark threads'
);

select tests.authenticate_as(tests.a());
select is(public.mark_chat_read(tests.id('thread_a')), 1, 'the customer marks support''s message read');
select results_eq(
  $$ select body, read_at is not null from public.chat_messages order by created_at $$,
  $$ values ('سؤال 1', false), ('سؤال 2', false), ('جواب', true) $$,
  'only the other side''s messages are marked'
);
select results_eq(
  $$ select customer_unread, admin_unread from public.chat_threads $$,
  $$ values (0, 2) $$,
  'the customer''s count goes to 0; support''s stays'
);
select is(public.mark_chat_read(tests.id('thread_a')), 0, 'marking again marks nothing');

-- admin_chat_inbox() ---------------------------------------------------------------

select tests.authenticate_as(tests.admin());
select results_eq(
  $$ select thread_id, full_name, phone, admin_unread, last_author::text, last_body
     from public.admin_chat_inbox() $$,
  $$ values
       (tests.id('thread_a'), 'زيد', '+9647801111111', 2, 'admin', 'جواب'),
       (tests.id('thread_b'), 'علي', '+9647802222222', 1, 'customer', 'من علي') $$,
  'the inbox lists threads with messages, unread first then newest, with the last message'
);
select results_eq(
  $$ select thread_id from public.admin_chat_inbox('علي') $$,
  $$ values (tests.id('thread_b')) $$,
  'search by name'
);
select results_eq(
  $$ select thread_id from public.admin_chat_inbox('0780 111') $$,
  $$ values (tests.id('thread_a')) $$,
  'search by phone digits, as typed (07…)'
);
select is(public.mark_chat_read(tests.id('thread_a')), 2, 'an admin marks the customer''s messages read');
select results_eq(
  $$ select customer_unread, admin_unread from public.chat_threads where id = tests.id('thread_a') $$,
  $$ values (0, 0) $$,
  'support''s count goes to 0'
);
select results_eq(
  $$ select thread_id from public.admin_chat_inbox() $$,
  $$ values (tests.id('thread_b')), (tests.id('thread_a')) $$,
  'a thread with unread messages comes first'
);
select results_eq(
  $$ select thread_id from public.admin_chat_inbox(p_limit => 1) $$,
  $$ values (tests.id('thread_b')) $$,
  'the limit applies'
);

select tests.authenticate_as(tests.a());
select throws_ok('select * from public.admin_chat_inbox()', '42501', 'not_allowed', 'a customer cannot read the inbox');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok('select * from public.admin_chat_inbox()', '42501', 'not_allowed', 'a crew cannot read the inbox');
select tests.authenticate_as_anon();
select throws_ok('select * from public.admin_chat_inbox()', '42501', null, 'a guest cannot read the inbox');

-- Working hours --------------------------------------------------------------------

select tests.clear_authentication();
-- The seeded hours: Saturday to Thursday, 9:00–21:00.
update public.settings as s
set working_days = '{0,1,2,3,4,6}', working_hours_start = '09:00', working_hours_end = '21:00'
where s.id;

select ok(
  private.support_open('2026-10-24 10:00 Asia/Baghdad'), 'Saturday 10:00 is inside hours'
);
select ok(
  not private.support_open('2026-10-23 10:00 Asia/Baghdad'), 'Friday is closed'
);
select ok(
  not private.support_open('2026-10-24 08:59 Asia/Baghdad'), 'before opening is closed'
);
select ok(
  not private.support_open('2026-10-24 21:00 Asia/Baghdad'), 'closing time itself is closed'
);
select is(
  private.last_support_close('2026-10-24 08:00 Asia/Baghdad'),
  '2026-10-22 21:00 Asia/Baghdad'::timestamptz,
  'on Saturday morning hours last closed on Thursday evening (Friday is off)'
);

update public.settings as s
set working_days = '{0,1,2,3,4,5,6}', working_hours_start = '00:00', working_hours_end = '24:00'
where s.id;
select tests.authenticate_as_anon();
select ok(public.support_is_open(), 'anyone can ask whether support is open now');

-- support_response_text -----------------------------------------------------------

select tests.authenticate_as(tests.admin());
select lives_ok(
  $$ select public.admin_update_settings('{"support_response_text": "نرد عليك الصبح."}') $$,
  'an admin edits the automatic reply'
);
select throws_ok(
  $$ select public.admin_update_settings(jsonb_build_object('support_response_text', repeat('x', 301))) $$,
  '23514', null, 'the automatic reply is at most 300 characters'
);

select * from finish();
rollback;
