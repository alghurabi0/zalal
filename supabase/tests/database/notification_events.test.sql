-- Which events write which notifications (spec §9.2, §6). Rows are written
-- by triggers, so transition_order, assign_crew, send_chat_message,
-- create_ticket, rate_order and admin_set_ticket_status stay as they are.
-- Each row carries the values its words need in `data` (no Arabic is
-- stored; the app renders it from ar.json) plus the order or ticket it is
-- about. Deleted accounts get nothing; an admin is any live admin profile;
-- a crew is told through its account while the crew is active.
--
-- Orders (order_events):
-- - booking (no from status) → every admin: new_booking
-- - confirmed → customer: order_confirmed; the assigned crew: new_job
-- - reschedule by the customer → admins: customer_rescheduled; by an admin →
--   customer: order_rescheduled. From confirmed, the assigned crew:
--   job_changed (rescheduled)
-- - cancelled by the customer → admins: customer_cancelled (with the N6
--   reason); by an admin → customer: order_cancelled. From confirmed or
--   later, the assigned crew: job_changed (cancelled)
-- - on_the_way, arrived, in_progress, completed, no_show → customer:
--   crew_on_the_way, crew_arrived, work_started (in-app only), order_completed,
--   order_no_show
-- - admin overrides notify only into completed and cancelled
-- Crew changes (orders.crew_id): on a confirmed or on-the-way order the new
-- crew gets new_job and the old one job_changed (reassigned). While pending,
-- nothing: crews don't see pending orders; confirming tells the crew.
-- Chat (chat_messages): a customer's message → admins: customer_message; an
-- admin's → the customer: support_message, with an 80-character excerpt.
-- System messages notify nothing (their event already did, or the customer
-- caused it). The customer reading Chat marks their support_message rows
-- read.
-- Tickets: an Issue report (tickets, source app) or a low rating (ratings,
-- with its stars) → admins: new_ticket; a status change → the customer:
-- ticket_status. Notes notify nothing.
begin;
\ir _helpers.psql

select plan(46);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B (deleted later)
select tests.create_user('+9647504444444', 'admin');
select tests.create_user('+9647504444445', 'admin');
select tests.create_user('+9647504444446', 'admin');   -- a deleted admin
update public.profiles set deleted_at = now() where id = tests.user_id('+9647504444446');
insert into tests.ids values
  ('crew1', tests.create_crew('+9647703333331')),
  ('crew2', tests.create_crew('+9647703333332')),
  ('crew_off', tests.create_crew('+9647703333339'));
update public.crews set active = false where id = tests.id('crew_off');

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
update public.slots set active = false;
delete from public.blocked_dates;
update public.settings set booking_window_days = 14, cancel_cutoff_hours = 2;
select tests.create_slot('07:00', '09:00', 5);
create function tests.main() returns bigint language sql stable
as $$ select id from public.slots where start_time = '07:00' and end_time = '09:00' $$;

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.admin1() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;
create function tests.crew1_user() returns uuid language sql stable
as $$ select tests.user_id('+9647703333331') $$;
create function tests.crew2_user() returns uuid language sql stable
as $$ select tests.user_id('+9647703333332') $$;

-- Every notification so far as "<phone> <type>", sorted; then cleared.
create function tests.taken() returns setof text language plpgsql security definer
as $$
begin
  return query
  select u.phone || ' ' || n.type::text
  from public.notifications as n join tests.users as u on u.id = n.user_id
  order by 1;
  delete from public.notifications;
end;
$$;
create function tests.data_of(p_phone text, p_type text) returns jsonb language sql stable security definer
as $$
  select n.data from public.notifications as n
  where n.user_id = tests.user_id(p_phone) and n.type::text = p_type
$$;
create function tests.number(p_order text) returns bigint language sql stable
as $$ select number from public.orders where id = tests.id(p_order) $$;
grant execute on all functions in schema tests to anon, authenticated;

insert into tests.ids values
  ('booked', tests.create_order(tests.a(), 'pending_confirmation')),
  ('pending_crew', tests.create_order(tests.a(), 'pending_confirmation', p_crew_id => tests.id('crew1'))),
  ('pending_bare', tests.create_order(tests.a(), 'pending_confirmation')),
  ('job', tests.create_order(tests.a(), 'confirmed', now() + interval '1 hour', tests.id('crew1'))),
  ('ns', tests.create_order(tests.a(), 'confirmed', now() + interval '1 hour', tests.id('crew1'))),
  ('cust_cancel', tests.create_order(tests.a(), 'confirmed', p_crew_id => tests.id('crew1'))),
  ('adm_cancel', tests.create_order(tests.a(), 'pending_confirmation')),
  ('cust_resched', tests.create_order(tests.a(), 'confirmed', p_crew_id => tests.id('crew1'))),
  ('adm_resched', tests.create_order(tests.a(), 'pending_confirmation')),
  ('ovr_done', tests.create_order(tests.a(), 'arrived', now() - interval '1 hour', tests.id('crew1'))),
  ('ovr_otw', tests.create_order(tests.a(), 'confirmed', now() + interval '1 hour')),
  ('assign', tests.create_order(tests.a(), 'confirmed', now() + interval '1 day')),
  ('assign_pending', tests.create_order(tests.a(), 'pending_confirmation')),
  ('b_order', tests.create_order(tests.user_id('+9647802222222'), 'confirmed')),
  ('rated', tests.create_order(tests.a(), 'completed', now() - interval '1 day'));
-- Fixture orders made no events.
delete from public.notifications;

-- Booking ----------------------------------------------------------------------------------

insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role)
values (tests.id('booked'), null, 'pending_confirmation', tests.a(), 'customer');
select results_eq(
  $$ select * from tests.taken() $$,
  $$ values ('+9647504444444 new_booking'), ('+9647504444445 new_booking') $$,
  'a booking tells every live admin, not the deleted one'
);
insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role)
values (tests.id('booked'), null, 'pending_confirmation', tests.a(), 'customer');
select is(
  tests.data_of('+9647504444444', 'new_booking') - 'slot_start_at' - 'slot_end_at',
  jsonb_build_object(
    'number', tests.number('booked'),
    'service_date', (select service_date from public.orders where id = tests.id('booked')),
    'district', 'حي الحسين'
  ),
  'it carries the order number, day and district'
);
select ok(
  (select (data ->> 'slot_start_at')::timestamptz = o.slot_start_at
       and (data ->> 'slot_end_at')::timestamptz = o.slot_end_at
       and n.order_id = o.id
   from public.notifications as n join public.orders as o on o.id = n.order_id
   where n.user_id = tests.admin1() and n.type = 'new_booking'),
  'and the slot times and the order it is about'
);
select tests.taken();

-- Confirm ----------------------------------------------------------------------------------

select tests.authenticate_as(tests.admin1());
select public.transition_order(tests.id('pending_crew'), 'confirmed');
select public.transition_order(tests.id('pending_bare'), 'confirmed');
select tests.clear_authentication();
select results_eq(
  $$ select * from tests.taken() $$,
  $$ values ('+9647703333331 new_job'), ('+9647801111111 order_confirmed'), ('+9647801111111 order_confirmed') $$,
  'confirming tells the customer, and the crew assigned while pending'
);

-- The crew's moves -------------------------------------------------------------------------

select tests.authenticate_as(tests.crew1_user());
select public.transition_order(tests.id('job'), 'on_the_way');
select tests.clear_authentication();
select results_eq(
  $$ select * from tests.taken() $$, $$ values ('+9647801111111 crew_on_the_way') $$,
  'on the way tells the customer'
);
select tests.authenticate_as(tests.crew1_user());
select public.transition_order(tests.id('job'), 'arrived');
select tests.clear_authentication();
select results_eq(
  $$ select * from tests.taken() $$, $$ values ('+9647801111111 crew_arrived') $$,
  'arrival tells the customer'
);
select tests.authenticate_as(tests.crew1_user());
select public.transition_order(tests.id('job'), 'in_progress');
select tests.clear_authentication();
select results_eq(
  $$ select * from tests.taken() $$, $$ values ('+9647801111111 work_started') $$,
  'work starting is an in-app row for the customer'
);
select tests.authenticate_as(tests.crew1_user());
select public.transition_order(
  tests.id('job'), 'completed', '{"cash_collected": true, "sterilant": "كلور"}'
);
select tests.clear_authentication();
select results_eq(
  $$ select * from tests.taken() $$, $$ values ('+9647801111111 order_completed') $$,
  'completion tells the customer'
);
select tests.authenticate_as(tests.crew1_user());
select public.transition_order(tests.id('ns'), 'no_show', '{"reason": "ما فتحوا الباب"}');
select tests.clear_authentication();
select results_eq(
  $$ select * from tests.taken() $$, $$ values ('+9647801111111 order_no_show') $$,
  'a no-show tells the customer once (its chat message adds no second one)'
);
select is(
  (select count(*)::int from public.chat_messages where kind = 'no_show' and order_id = tests.id('ns')), 1,
  'the no-show chat message is still posted'
);

-- Cancel ---------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select public.transition_order(tests.id('cust_cancel'), 'cancelled', '{"cancel_reason": "time_unsuitable"}');
select tests.clear_authentication();
select is(
  tests.data_of('+9647504444444', 'customer_cancelled') ->> 'cancel_reason', 'time_unsuitable',
  'the customer''s cancel carries their N6 reason'
);
select is(
  tests.data_of('+9647703333331', 'job_changed') ->> 'change', 'cancelled',
  'the crew learns its confirmed job was cancelled'
);
select results_eq(
  $$ select * from tests.taken() $$,
  $$ values ('+9647504444444 customer_cancelled'), ('+9647504444445 customer_cancelled'),
            ('+9647703333331 job_changed') $$,
  'a customer''s cancel tells the admins and the crew, not the customer'
);

select tests.authenticate_as(tests.admin1());
select public.transition_order(tests.id('adm_cancel'), 'cancelled', '{"reason": "طلب الزبون"}');
select tests.clear_authentication();
select results_eq(
  $$ select * from tests.taken() $$, $$ values ('+9647801111111 order_cancelled') $$,
  'an admin''s cancel tells the customer'
);
select is(
  (select count(*)::int from public.notifications where data::text like '%طلب الزبون%'), 0,
  'the internal reason is never copied'
);

-- Reschedule -------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select public.transition_order(
  tests.id('cust_resched'), 'pending_confirmation',
  jsonb_build_object('service_date', tests.today() + 2, 'slot_id', tests.main())
);
select tests.clear_authentication();
select is(
  (tests.data_of('+9647504444444', 'customer_rescheduled') ->> 'service_date')::date, tests.today() + 2,
  'the admins'' row carries the new day'
);
select is(
  tests.data_of('+9647703333331', 'job_changed') ->> 'change', 'rescheduled',
  'the crew learns its confirmed job moved'
);
select results_eq(
  $$ select * from tests.taken() $$,
  $$ values ('+9647504444444 customer_rescheduled'), ('+9647504444445 customer_rescheduled'),
            ('+9647703333331 job_changed') $$,
  'a customer''s reschedule tells the admins and the crew'
);

select tests.authenticate_as(tests.admin1());
select public.transition_order(
  tests.id('adm_resched'), 'pending_confirmation',
  jsonb_build_object('service_date', tests.today() + 3, 'slot_id', tests.main())
);
select tests.clear_authentication();
select is(
  (tests.data_of('+9647801111111', 'order_rescheduled') ->> 'service_date')::date, tests.today() + 3,
  'an admin''s reschedule tells the customer the new day'
);
select results_eq(
  $$ select * from tests.taken() $$, $$ values ('+9647801111111 order_rescheduled') $$,
  'and nobody else (no crew was assigned)'
);

-- Overrides ----------------------------------------------------------------------------------

select tests.authenticate_as(tests.admin1());
select public.transition_order(tests.id('ovr_otw'), 'on_the_way', '{"override": true, "reason": "تصحيح"}');
select tests.clear_authentication();
select is_empty($$ select * from tests.taken() $$, 'an override into on_the_way notifies nobody');

select tests.authenticate_as(tests.admin1());
select public.transition_order(tests.id('ovr_done'), 'completed', '{"override": true, "reason": "تصحيح"}');
select tests.clear_authentication();
select results_eq(
  $$ select * from tests.taken() $$, $$ values ('+9647801111111 order_completed') $$,
  'an override into completed tells the customer the certificate is ready'
);

select tests.authenticate_as(tests.admin1());
select public.transition_order(tests.id('ovr_done'), 'cancelled', '{"override": true, "reason": "تصحيح"}');
select tests.clear_authentication();
select results_eq(
  $$ select * from tests.taken() $$,
  $$ values ('+9647801111111 order_cancelled') $$,
  'an override into cancelled tells the customer (not the crew, whose job was already done)'
);

-- Crew changes ------------------------------------------------------------------------------

select tests.authenticate_as(tests.admin1());
select public.assign_crew(tests.id('assign'), tests.id('crew1'));
select tests.clear_authentication();
select ok(
  (select n.order_id = tests.id('assign') and (n.data ->> 'number')::bigint = tests.number('assign')
   from public.notifications as n where n.type = 'new_job'),
  'the crew''s row names the order and its number'
);
select results_eq(
  $$ select * from tests.taken() $$, $$ values ('+9647703333331 new_job') $$,
  'assigning a crew to a confirmed order tells it'
);

select tests.authenticate_as(tests.admin1());
select public.assign_crew(tests.id('assign'), tests.id('crew2'));
select tests.clear_authentication();
select is(
  tests.data_of('+9647703333331', 'job_changed') ->> 'change', 'reassigned',
  'the old crew learns the job went to another crew'
);
select results_eq(
  $$ select * from tests.taken() $$,
  $$ values ('+9647703333331 job_changed'), ('+9647703333332 new_job') $$,
  'reassigning tells both crews'
);

select tests.authenticate_as(tests.admin1());
select public.assign_crew(tests.id('assign'), null);
select tests.clear_authentication();
select results_eq(
  $$ select * from tests.taken() $$, $$ values ('+9647703333332 job_changed') $$,
  'removing the crew tells it'
);

select tests.authenticate_as(tests.admin1());
select public.assign_crew(tests.id('assign_pending'), tests.id('crew2'));
select tests.clear_authentication();
select is_empty($$ select * from tests.taken() $$, 'assigning while pending tells nobody yet');

-- A switched-off crew is never told.
update public.orders set crew_id = tests.id('crew_off') where id = tests.id('assign');
select is_empty($$ select * from tests.taken() $$, 'a switched-off crew gets nothing');

-- A deleted customer gets nothing.
update public.profiles set deleted_at = now() where id = tests.user_id('+9647802222222');
insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role)
values (tests.id('b_order'), 'confirmed', 'on_the_way', tests.crew1_user(), 'crew');
select is_empty($$ select * from tests.taken() $$, 'a deleted account gets no notifications');

-- Chat ---------------------------------------------------------------------------------------

update public.settings as s
set working_days = '{0,1,2,3,4,5,6}', working_hours_start = '00:00', working_hours_end = '24:00'
where s.id;
delete from public.chat_messages;
update public.chat_threads set customer_unread = 0, admin_unread = 0;

select tests.authenticate_as(tests.a());
select public.send_chat_message(gen_random_uuid(), p_body => 'عندي سؤال عن الموعد');
select tests.clear_authentication();
select results_eq(
  $$ select tests.data_of('+9647504444444', 'customer_message') - 'thread_id' $$,
  $$ values ('{"excerpt": "عندي سؤال عن الموعد"}'::jsonb) $$,
  'a customer''s message carries its text for the admins'
);
select is(
  (tests.data_of('+9647504444445', 'customer_message') ->> 'thread_id')::uuid,
  (select id from public.chat_threads where user_id = tests.a()),
  'and the thread it opens'
);
select results_eq(
  $$ select * from tests.taken() $$,
  $$ values ('+9647504444444 customer_message'), ('+9647504444445 customer_message') $$,
  'a customer''s message tells every admin'
);

select tests.authenticate_as(tests.admin1());
select public.send_chat_message(
  gen_random_uuid(), (select id from public.chat_threads where user_id = tests.a()), repeat('ا', 100)
);
select tests.clear_authentication();
select is(
  tests.data_of('+9647801111111', 'support_message') ->> 'excerpt', repeat('ا', 79) || '…',
  'support''s long message is cut to 80 characters'
);
select results_eq(
  $$ select * from tests.taken() $$, $$ values ('+9647801111111 support_message') $$,
  'support''s answer tells the customer'
);

select tests.authenticate_as(tests.a());
select public.send_chat_message(gen_random_uuid(), p_topic => 'price');
select tests.clear_authentication();
select is(
  tests.data_of('+9647504444444', 'customer_message') ->> 'topic', 'price',
  'a quick topic without text carries the topic'
);
select tests.taken();

-- Reading Chat marks support's notifications read.
select tests.authenticate_as(tests.admin1());
select public.send_chat_message(
  gen_random_uuid(), (select id from public.chat_threads where user_id = tests.a()), 'تمام'
);
select tests.authenticate_as(tests.a());
select public.mark_chat_read((select id from public.chat_threads where user_id = tests.a()));
select tests.clear_authentication();
select is(
  (select count(*)::int from public.notifications
   where user_id = tests.a() and type = 'support_message' and read_at is null),
  0, 'reading Chat marks the customer''s chat notifications read'
);
select tests.taken();

-- Tickets ---------------------------------------------------------------------------------------

insert into public.tickets (user_id, source, category, description, order_id)
values (tests.a(), 'app', 'leak', 'الخزان يخر من الجانب', tests.id('rated'))
returning id as ticket_id \gset
insert into tests.ids values ('ticket', :'ticket_id');
select is(
  tests.data_of('+9647504444444', 'new_ticket') - 'ticket_number',
  jsonb_build_object('source', 'app', 'category', 'leak', 'order_number', tests.number('rated')),
  'an Issue report tells the admins its category and order'
);
select results_eq(
  $$ select * from tests.taken() $$,
  $$ values ('+9647504444444 new_ticket'), ('+9647504444445 new_ticket') $$,
  'and only the admins (its chat message adds nothing)'
);

select tests.authenticate_as(tests.a());
select public.rate_order(tests.id('rated'), 2);
select tests.clear_authentication();
select is(
  tests.data_of('+9647504444444', 'new_ticket') - 'ticket_number',
  jsonb_build_object('source', 'rating', 'stars', 2, 'order_number', tests.number('rated')),
  'a low rating''s ticket tells the admins its stars'
);
select results_eq(
  $$ select * from tests.taken() $$,
  $$ values ('+9647504444444 new_ticket'), ('+9647504444445 new_ticket') $$,
  'once per admin'
);

select tests.authenticate_as(tests.admin1());
select public.admin_set_ticket_status(tests.id('ticket'), 'in_progress');
select tests.clear_authentication();
select is(
  tests.data_of('+9647801111111', 'ticket_status'),
  jsonb_build_object('ticket_number', (select number from public.tickets where id = tests.id('ticket')), 'status', 'in_progress'),
  'a status change tells the customer the number and the new status'
);
select is(
  (select ticket_id from public.notifications where type = 'ticket_status'), tests.id('ticket'),
  'and the ticket it is about'
);
select results_eq(
  $$ select * from tests.taken() $$, $$ values ('+9647801111111 ticket_status') $$,
  'only the customer'
);

select tests.authenticate_as(tests.admin1());
select public.admin_set_ticket_status(tests.id('ticket'), 'in_progress');
select public.admin_add_ticket_note(tests.id('ticket'), 'اتصلنا بالزبون');
select tests.clear_authentication();
select is_empty($$ select * from tests.taken() $$, 'the same status and a note notify nobody');

select * from finish();
rollback;
