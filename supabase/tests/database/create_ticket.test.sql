-- create_ticket(client_id, category, description, order_id, media): the Issue
-- report (spec §5.17, §7; Phase 5, task 2).
--
-- Customers only (crews, admins and guests 42501; a deleted account has no
-- role). A category and a description of 10–1000 characters (trimmed) are
-- required. The order is optional; it must be the customer's own (P0002
-- order_not_found otherwise) with its slot no more than 90 days ago (ZL028
-- ticket_order_too_old). Up to 3 files (ZL008), each the customer's own
-- finished upload in ticket-media/<user id>/, at most 48 h old and not
-- attached before (ZL009); type and size come from Storage, videos need a
-- length of 0–60 s. A retry with the same client id returns the first
-- ticket. 5 app tickets an hour per customer (ZL029). The new ticket posts
-- its chat message (trigger tickets_chat_message).
begin;
\ir _helpers.psql

select plan(32);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;

insert into tests.ids values
  ('recent', tests.create_order(tests.a(), 'completed', now() - interval '89 days')),
  ('old', tests.create_order(tests.a(), 'completed', now() - interval '91 days')),
  ('upcoming', tests.create_order(tests.a(), 'confirmed', now() + interval '3 days')),
  ('other', tests.create_order(tests.b(), 'completed', now() - interval '2 days')),
  ('c1', gen_random_uuid()), ('c2', gen_random_uuid()), ('c3', gen_random_uuid());

select tests.create_object('ticket-media', tests.a() || '/a.jpg', tests.a());
select tests.create_object('ticket-media', tests.a() || '/b.mp4', tests.a(), 'video/mp4', 5000000);
select tests.create_object('ticket-media', tests.a() || '/c.jpg', tests.a());
select tests.create_object('ticket-media', tests.a() || '/d.jpg', tests.a());
select tests.create_object('ticket-media', tests.a() || '/stale.jpg', tests.a());
update storage.objects set created_at = now() - interval '49 hours'
where bucket_id = 'ticket-media' and name = tests.a() || '/stale.jpg';
select tests.create_object('ticket-media', tests.b() || '/theirs.jpg', tests.b());
select tests.create_object('chat-media', tests.a() || '/chat.jpg', tests.a());

-- Who may call it ------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.create_ticket(gen_random_uuid(), 'smell', 'الماي بي ريحة كلور قوية') $$,
  '42501', null, 'guests cannot report'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.create_ticket(gen_random_uuid(), 'smell', 'الماي بي ريحة كلور قوية') $$,
  '42501', 'not_allowed', 'nor can a crew'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.create_ticket(gen_random_uuid(), 'smell', 'الماي بي ريحة كلور قوية') $$,
  '42501', 'not_allowed', 'nor an admin'
);

-- Input ------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.create_ticket(null, 'smell', 'الماي بي ريحة كلور قوية') $$,
  '22023', 'client_id_required', 'a client id is required'
);
select throws_ok(
  $$ select public.create_ticket(gen_random_uuid(), null, 'الماي بي ريحة كلور قوية') $$,
  '22023', 'invalid_category', 'a category is required'
);
select throws_ok(
  $$ select public.create_ticket(gen_random_uuid(), 'smell', '  قصيرة كلش  ') $$,
  '22023', 'invalid_description', 'a description under 10 characters (trimmed) is refused'
);
select throws_ok(
  $$ select public.create_ticket(gen_random_uuid(), 'smell', repeat('ا', 1001)) $$,
  '22023', 'invalid_description', 'and one over 1000'
);
select throws_ok(
  $$ select public.create_ticket(gen_random_uuid(), 'late', 'الفريق تأخر ساعتين', tests.id('other')) $$,
  'P0002', 'order_not_found', 'another customer''s order is refused'
);
select throws_ok(
  $$ select public.create_ticket(gen_random_uuid(), 'late', 'الفريق تأخر ساعتين', tests.id('old')) $$,
  'ZL028', 'ticket_order_too_old', 'an order whose slot was more than 90 days ago is refused'
);

-- Files ------------------------------------------------------------------------------------------

select throws_ok(
  $$ select public.create_ticket(
       gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
       jsonb_build_array(
         jsonb_build_object('path', tests.a() || '/a.jpg'),
         jsonb_build_object('path', tests.a() || '/c.jpg'),
         jsonb_build_object('path', tests.a() || '/d.jpg'),
         jsonb_build_object('path', tests.a() || '/stale.jpg')
       )
     ) $$,
  'ZL008', 'too_many_files', 'at most 3 files'
);
select throws_ok(
  $$ select public.create_ticket(
       gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
       jsonb_build_array(jsonb_build_object('path', tests.b() || '/theirs.jpg'))
     ) $$,
  'ZL009', 'upload_not_found', 'another customer''s upload is refused'
);
select throws_ok(
  $$ select public.create_ticket(
       gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
       jsonb_build_array(jsonb_build_object('path', tests.a() || '/chat.jpg'))
     ) $$,
  'ZL009', 'upload_not_found', 'a file in another bucket is refused'
);
select throws_ok(
  $$ select public.create_ticket(
       gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
       jsonb_build_array(jsonb_build_object('path', tests.a() || '/stale.jpg'))
     ) $$,
  'ZL009', 'upload_not_found', 'an upload more than 48 h old is refused'
);
select throws_ok(
  $$ select public.create_ticket(
       gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
       jsonb_build_array(jsonb_build_object('path', tests.a() || '/missing.jpg'))
     ) $$,
  'ZL009', 'upload_not_found', 'a missing upload is refused'
);
select throws_ok(
  $$ select public.create_ticket(
       gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
       jsonb_build_array(jsonb_build_object('path', tests.a() || '/b.mp4'))
     ) $$,
  '22023', 'invalid_duration', 'a video needs its length'
);
select throws_ok(
  $$ select public.create_ticket(
       gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
       jsonb_build_array(jsonb_build_object('path', tests.a() || '/b.mp4', 'duration_s', 61))
     ) $$,
  '22023', 'invalid_duration', 'of at most 60 s'
);
select throws_ok(
  $$ select public.create_ticket(
       gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
       jsonb_build_array(
         jsonb_build_object('path', tests.a() || '/a.jpg'),
         jsonb_build_object('path', tests.a() || '/a.jpg')
       )
     ) $$,
  'ZL009', 'upload_not_found', 'the same file twice is refused'
);

-- A ticket -------------------------------------------------------------------------------------

select ok(
  (
    select n >= 1001 from public.create_ticket(
      tests.id('c1'), 'smell', '  الماي بيه ريحة كلور قوية  ', tests.id('recent'),
      jsonb_build_array(
        jsonb_build_object('path', tests.a() || '/a.jpg', 'duration_s', 12),
        jsonb_build_object('path', tests.a() || '/b.mp4', 'duration_s', 31.4)
      )
    ) as t(id, n)
  ),
  'a customer reports an issue and gets the ticket number'
);
select results_eq(
  $$ select user_id, order_id, category::text, description, status::text, source::text
     from public.tickets where client_id = tests.id('c1') $$,
  $$ values (tests.a(), tests.id('recent'), 'smell', 'الماي بيه ريحة كلور قوية', 'open', 'app') $$,
  'the ticket is theirs, open, from the app, with the description trimmed'
);
select results_eq(
  $$ select m.path, m.media_type::text, m.bytes, m.duration_s, m.user_id
     from public.ticket_media as m
     join public.tickets as t on t.id = m.ticket_id
     where t.client_id = tests.id('c1')
     order by m.path $$,
  $$ values
       (tests.a() || '/a.jpg', 'photo', 1000::bigint, null::numeric, tests.a()),
       (tests.a() || '/b.mp4', 'video', 5000000::bigint, 31.4::numeric, tests.a()) $$,
  'its files are attached, with their type and size from Storage; a photo has no length'
);
select results_eq(
  $$ select m.author::text, m.kind::text, m.order_id
     from public.chat_messages as m
     join public.tickets as t on t.id = m.ticket_id
     where t.client_id = tests.id('c1') $$,
  $$ values ('system', 'ticket', tests.id('recent')) $$,
  'and it posts the ticket message in the customer''s chat'
);
select results_eq(
  $$ select t.number from public.create_ticket(tests.id('c1'), 'other', 'شي ثاني تماماً هنا') as r
     join public.tickets as t on t.id = r.ticket_id $$,
  $$ select number from public.tickets where client_id = tests.id('c1') $$,
  'a retry with the same client id returns the first ticket'
);
select is(
  (select count(*)::int from public.tickets where client_id = tests.id('c1')),
  1,
  'and makes no second one'
);
select throws_ok(
  $$ select public.create_ticket(
       gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
       jsonb_build_array(jsonb_build_object('path', tests.a() || '/a.jpg'))
     ) $$,
  'ZL009', 'upload_not_found', 'an attached file can''t be attached again'
);
select lives_ok(
  $$ select public.create_ticket(tests.id('c2'), 'payment', 'دفعت كاش وما انطوني وصل') $$,
  'a ticket without an order or files'
);
select lives_ok(
  $$ select public.create_ticket(tests.id('c3'), 'late', 'الموعد باجر وما اتصل بيه أحد', tests.id('upcoming')) $$,
  'a ticket on an upcoming order'
);
select is(
  (select order_id from public.tickets where client_id = tests.id('c2')),
  null,
  'without an order the ticket names none'
);

-- Limits ------------------------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_ticket(gen_random_uuid(), 'other', 'بلاغ رابع خلال ساعة') $$,
  'a fourth report within the hour'
);
select lives_ok(
  $$ select public.create_ticket(gen_random_uuid(), 'other', 'بلاغ خامس خلال ساعة') $$,
  'a fifth'
);
select throws_ok(
  $$ select public.create_ticket(gen_random_uuid(), 'other', 'بلاغ سادس خلال ساعة') $$,
  'ZL029', 'too_many_tickets', 'a sixth within an hour is refused'
);
select lives_ok(
  $$ select public.create_ticket(tests.id('c3'), 'late', 'الموعد باجر وما اتصل بيه أحد', tests.id('upcoming')) $$,
  'a retry of an earlier one still answers'
);

select tests.authenticate_as(tests.b());
select lives_ok(
  $$ select public.create_ticket(gen_random_uuid(), 'staff', 'الفريق ما كان محترم ويانا') $$,
  'another customer is not held back by the first one''s limit'
);

select * from finish();
rollback;
