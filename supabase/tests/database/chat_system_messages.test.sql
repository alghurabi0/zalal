-- System messages in Chat (spec §5.15, §6, §5.16):
-- - An order moving to no_show (crew or admin, through transition_order)
--   posts a no_show message, tagged with the order, in the customer's thread
--   (made if missing). Other moves post nothing.
-- - A new ticket posts a ticket message with the ticket and its order in the
--   ticket owner's thread: today the ticket a rating of 3 stars or fewer
--   opens (rate_order); the Issue report adds its own in Phase 5, task 2.
-- System messages have no sender, count as unread for the customer, and are
-- read like any other message in the thread.
begin;
\ir _helpers.psql

select plan(12);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;

insert into tests.ids values
  ('crew_job', tests.create_order(tests.a(), 'on_the_way', now() + interval '1 hour', tests.id('crew'))),
  ('admin_job', tests.create_order(tests.a(), 'confirmed', now() + interval '1 day', tests.id('crew'))),
  ('cancelled', tests.create_order(tests.a(), 'pending_confirmation', now() + interval '3 days')),
  ('low', tests.create_order(tests.a(), 'completed', now() - interval '1 day')),
  ('high', tests.create_order(tests.a(), 'completed', now() - interval '2 days'));

-- No-show ----------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));
select public.transition_order(tests.id('crew_job'), 'no_show', '{"reason": "ما فتحوا الباب"}');

select tests.clear_authentication();
select results_eq(
  $$ select m.author::text, m.kind::text, m.sender_id, m.order_id, m.body
     from public.chat_messages as m join public.chat_threads as t on t.id = m.thread_id
     where t.user_id = tests.a() $$,
  $$ values ('system', 'no_show', null::uuid, tests.id('crew_job'), null::text) $$,
  'a crew''s no-show posts a no_show message tagged with the order, without the internal note'
);
select is(
  (select customer_unread from public.chat_threads where user_id = tests.a()), 1,
  'it is unread for the customer'
);
select is(
  (select admin_unread from public.chat_threads where user_id = tests.a()), 0,
  'and not for support'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.transition_order(tests.id('admin_job'), 'no_show', '{"reason": "اتصلنا وما رد"}');
select tests.clear_authentication();
select is(
  (select count(*)::int from public.chat_messages where kind = 'no_show' and order_id = tests.id('admin_job')), 1,
  'an admin''s no-show posts one too'
);

select tests.authenticate_as(tests.a());
select public.transition_order(tests.id('cancelled'), 'cancelled', '{"cancel_reason": "other"}');
select tests.clear_authentication();
select is(
  (select count(*)::int from public.chat_messages), 2,
  'other moves post nothing'
);

-- Rating tickets ---------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select public.rate_order(tests.id('low'), 2);
select public.rate_order(tests.id('high'), 5);

select tests.clear_authentication();
select results_eq(
  $$ select m.author::text, m.kind::text, m.ticket_id, m.order_id
     from public.chat_messages as m where m.kind = 'ticket' $$,
  $$ select 'system', 'ticket', r.ticket_id, r.order_id from public.ratings as r where r.order_id = tests.id('low') $$,
  'a 2-star rating''s ticket posts a ticket message with the ticket and its order'
);
select is(
  (select count(*)::int from public.chat_messages where kind = 'ticket'), 1,
  'a 5-star rating opens no ticket and posts nothing'
);
select is(
  (select customer_unread from public.chat_threads where user_id = tests.a()), 3,
  'every system message counts as unread for the customer'
);
select is(
  (select count(*)::int from public.chat_threads), 1,
  'all in the customer''s one thread'
);

-- Who reads them ---------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select is(
  (select count(*)::int from public.chat_messages where author = 'system'), 3,
  'the customer reads their system messages'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty('select 1 from public.chat_messages', 'another customer reads none');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty('select 1 from public.chat_messages', 'the crew that marked the no-show reads none');

select * from finish();
rollback;
