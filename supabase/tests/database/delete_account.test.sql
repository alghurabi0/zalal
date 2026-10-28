-- Account deletion (N13, spec §7 "Account deletion"; settled Oct 28, 2026).
-- delete_account(): the caller's own account, customers only (anon, crews,
-- admins and deleted accounts 42501). Refused while an order is pending …
-- in progress (ZL039 account_has_open_orders). In one transaction:
-- - profiles: deleted_at, no name, no phone, reminders off;
-- - auth.users: no phone, banned for 100 years; sessions, refresh tokens and
--   identities deleted, so the phone can sign up again as a new account;
-- - addresses soft-deleted with the landmark replaced by '-deleted-' and the
--   pin rounded to 2 decimals; their tanks deleted;
-- - orders kept, with the same address treatment and no customer note;
--   their media rows deleted (the nightly cleanup removes the files);
-- - certificates kept without their PDF (the paths are returned for the
--   server to delete);
-- - ratings keep their stars, without the comment;
-- - tickets (with files, notes and notifications), the chat thread and its
--   messages, notifications and push subscriptions deleted;
-- - a requested subscription declined, an active one cancelled.
-- Another customer's data is untouched.
begin;
\ir _helpers.psql

select plan(48);

select tests.create_user('+9647801111111');            -- customer A (deleted)
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;
grant execute on all functions in schema tests to anon, authenticated;

-- A's data ---------------------------------------------------------------------------------

insert into tests.ids values ('a_home', tests.create_address(tests.a()));
insert into tests.ids values ('a_work', tests.create_address(tests.a(), 'work'));
insert into tests.ids values ('a_done', tests.create_order(tests.a(), 'completed', now() - interval '20 days'));
insert into tests.ids values ('a_cancelled', tests.create_order(tests.a(), 'cancelled'));
update public.orders set customer_note = 'Call me at the gate' where id = tests.id('a_done');

insert into public.certificates (order_id, public_code, next_due_on)
values (tests.id('a_done'), 'ABCDEFGH', current_date + 180);
update public.certificates
set pdf_path = id || '/1.pdf'
where order_id = tests.id('a_done');

insert into public.order_media (order_id, kind, media_type, path, bytes, uploaded_by)
values (tests.id('a_done'), 'customer', 'photo', tests.a() || '/x.jpg', 10, tests.a());

insert into public.tickets (user_id, order_id, category, description, source)
values (tests.a(), tests.id('a_done'), 'leak', 'Water is leaking again', 'app');
insert into tests.ids select 'a_ticket', id from public.tickets where user_id = tests.a();
insert into public.ticket_notes (ticket_id, author_id, note)
values (tests.id('a_ticket'), tests.user_id('+9647504444444'), 'Called them');
insert into public.order_events (order_id, from_status, to_status, actor_role)
values (tests.id('a_done'), 'in_progress', 'completed', 'admin');
insert into public.order_event_notes (event_id, order_id, note)
select e.id, e.order_id, 'Customer Ali asked to call 0770 first'
from public.order_events as e where e.order_id = tests.id('a_done') limit 1;
insert into public.ratings (order_id, stars, comment, ticket_id)
values (tests.id('a_done'), 2, 'Late and messy', tests.id('a_ticket'));

insert into public.chat_threads (user_id) values (tests.a()) on conflict (user_id) do nothing;
insert into public.chat_messages (thread_id, customer_id, author, sender_id, kind, body, client_id)
select t.id, tests.a(), 'customer', tests.a(), 'message', 'Hello', gen_random_uuid()
from public.chat_threads as t where t.user_id = tests.a();

insert into public.notifications (user_id, type, data)
values (tests.a(), 'cleaning_reminder', '{}');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values (tests.a(), 'https://fcm.googleapis.com/fcm/send/a', 'B' || repeat('a', 86), repeat('b', 22));

insert into tests.ids values ('a_active', tests.create_subscription(tests.a(), 'active', p_address_id => tests.id('a_home')));
insert into public.subscription_notes (subscription_id, author_id, note)
values (tests.id('a_active'), tests.user_id('+9647504444444'), 'House behind the mosque');
insert into tests.ids values ('a_requested', tests.create_subscription(tests.a(), 'requested', p_address_id => tests.id('a_work')));

insert into auth.sessions (id, user_id) values (gen_random_uuid(), tests.a());
insert into auth.identities (provider_id, user_id, identity_data, provider)
values (tests.a()::text, tests.a(), jsonb_build_object('sub', tests.a(), 'phone', '9647801111111'), 'phone');

-- B's data, which must survive.
insert into tests.ids values ('b_home', tests.create_address(tests.b()));
insert into tests.ids values ('b_done', tests.create_order(tests.b(), 'completed', now() - interval '20 days'));
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values (tests.b(), 'https://fcm.googleapis.com/fcm/send/b', 'B' || repeat('a', 86), repeat('b', 22));

-- Who may call it --------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select public.delete_account() $$, '42501', null, 'a guest can''t delete');

select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok($$ select public.delete_account() $$, '42501', 'not_allowed', 'a crew can''t delete itself here');

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok($$ select public.delete_account() $$, '42501', 'not_allowed', 'an admin can''t delete itself here');

-- Open orders block it ---------------------------------------------------------------------

select tests.clear_authentication();
insert into tests.ids values ('a_open', tests.create_order(tests.a(), 'confirmed'));
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.delete_account() $$,
  'ZL039', 'account_has_open_orders', 'an open order blocks deletion'
);
select tests.clear_authentication();
select ok(
  (select deleted_at is null from public.profiles where id = tests.a()),
  'nothing changed after the refusal'
);
update public.orders set status = 'in_progress' where id = tests.id('a_open');
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.delete_account() $$,
  'ZL039', 'account_has_open_orders', 'an order in progress blocks deletion'
);
select tests.clear_authentication();
update public.orders set status = 'cancelled' where id = tests.id('a_open');
delete from public.slot_bookings where order_id = tests.id('a_open');

-- The deletion -----------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select is(
  public.delete_account(),
  array[(select id::text || '/1.pdf' from public.certificates where order_id = tests.id('a_done'))],
  'returns the certificate PDFs to delete'
);
select tests.clear_authentication();

-- Profile and Auth.
select ok(
  (select deleted_at is not null and full_name is null and phone is null and not reminders_enabled
   from public.profiles where id = tests.a()),
  'the profile is anonymized'
);
select ok(
  (select phone is null and banned_until > now() + interval '50 years' from auth.users where id = tests.a()),
  'the Auth user has no phone and is banned'
);
select is((select count(*)::int from auth.sessions where user_id = tests.a()), 0, 'sessions are gone');
select is((select count(*)::int from auth.identities where user_id = tests.a()), 0, 'identities are gone');
select lives_ok(
  $$ insert into auth.users (id, instance_id, aud, role, phone, phone_confirmed_at, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', '9647801111111', now(), now(), now()) $$,
  'the phone can sign up again'
);

-- Addresses and tanks.
select is(
  (select count(*)::int from public.addresses where user_id = tests.a() and deleted_at is null),
  0, 'every address is soft-deleted'
);
select ok(
  (select bool_and(landmark = '-deleted-' and lat = round(lat::numeric, 2)::float8 and lng = round(lng::numeric, 2)::float8)
   from public.addresses where user_id = tests.a()),
  'addresses lose the landmark and the exact pin'
);
select is((select count(*)::int from public.tanks where user_id = tests.a()), 0, 'tanks are deleted');

-- Orders, media, certificates, ratings.
select is((select count(*)::int from public.orders where customer_id = tests.a()), 3, 'orders stay');
select ok(
  (select bool_and(landmark = '-deleted-' and customer_note is null and lat = round(lat::numeric, 2)::float8)
   from public.orders where customer_id = tests.a()),
  'orders lose the landmark, the note and the exact pin'
);
select is(
  (select district from public.orders where id = tests.id('a_done')),
  'حي الحسين', 'orders keep the district'
);
select is(
  (select count(*)::int from public.order_media where order_id = tests.id('a_done')),
  0, 'order media rows are deleted'
);
select ok(
  (select pdf_path is null and public_code = 'ABCDEFGH' from public.certificates where order_id = tests.id('a_done')),
  'the certificate stays without its PDF'
);
select ok(
  (select stars = 2 and comment is null and ticket_id is null from public.ratings where order_id = tests.id('a_done')),
  'the rating keeps its stars only'
);

-- Tickets, chat, notifications, push.
select is((select count(*)::int from public.tickets where user_id = tests.a()), 0, 'tickets are deleted');
select is((select count(*)::int from public.ticket_notes where ticket_id = tests.id('a_ticket')), 0, 'ticket notes are deleted');
select is((select count(*)::int from public.chat_messages where customer_id = tests.a()), 0, 'chat messages are deleted');
select is((select count(*)::int from public.chat_threads where user_id = tests.a()), 0, 'the chat thread is deleted');
select is((select count(*)::int from public.notifications where user_id = tests.a()), 0, 'notifications are deleted');
select is((select count(*)::int from public.push_subscriptions where user_id = tests.a()), 0, 'push subscriptions are deleted');

select is(
  (select count(*)::int from public.order_event_notes where order_id = tests.id('a_done')),
  0, 'staff notes on the orders are deleted'
);
select is(
  (select count(*)::int from public.subscription_notes where subscription_id = tests.id('a_active')),
  0, 'staff notes on the subscriptions are deleted'
);
select throws_ok(
  $$ update public.certificates set pdf_path = id || '/2.pdf' where order_id = tests.id('a_done') $$,
  '42501', 'not_allowed', 'a PDF made during the deletion can''t be recorded'
);

-- Subscriptions.
select ok(
  (select status = 'cancelled' and ended_at is not null from public.subscriptions where id = tests.id('a_active')),
  'the active subscription is cancelled'
);
select ok(
  (select status = 'declined' and ended_at is not null from public.subscriptions where id = tests.id('a_requested')),
  'the request is declined'
);

-- B untouched.
select ok(
  (select deleted_at is null and phone = '+9647802222222' from public.profiles where id = tests.b()),
  'another customer''s profile is untouched'
);
select ok(
  (select landmark <> '-deleted-' and deleted_at is null from public.addresses where id = tests.id('b_home')),
  'another customer''s address is untouched'
);
select is((select count(*)::int from public.push_subscriptions where user_id = tests.b()), 1, 'another customer''s push stays');

-- A lingering token of the deleted account -----------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok($$ select public.delete_account() $$, '42501', 'not_allowed', 'a deleted account can''t delete again');
select is_empty($$ select 1 from public.orders $$, 'reads no orders');
select is_empty($$ select 1 from public.addresses $$, 'reads no addresses');
select is_empty($$ select 1 from public.certificates $$, 'reads no certificates');
select is_empty($$ select 1 from public.subscriptions $$, 'reads no subscriptions');
select is_empty($$ select 1 from public.notifications $$, 'reads no notifications');
select is_empty(
  $$ update public.profiles set full_name = 'Back again' where id = tests.a() returning 1 $$,
  'can''t write a name back'
);
select is_empty(
  $$ update public.addresses set landmark = 'Next to the school' returning 1 $$,
  'can''t touch its addresses'
);

-- The address service-area check ignores deleted rows only ---------------------------------

select tests.clear_authentication();
delete from public.service_areas;
insert into public.service_areas (name, area)
values ('Test', 'MULTIPOLYGON(((44.0 32.6, 44.05 32.6, 44.05 32.65, 44.0 32.65, 44.0 32.6)))');
select throws_ok(
  $$ update public.addresses set lat = 10 where id = tests.id('b_home') $$,
  'ZL001', 'outside_service_area', 'a live address is still checked'
);
select lives_ok(
  $$ update public.addresses set lat = 10 where id = tests.id('a_home') $$,
  'a deleted address isn''t'
);

-- Execute grants ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.delete_account()', 'execute'),
  'anon can''t execute delete_account'
);
select ok(
  has_function_privilege('authenticated', 'public.delete_account()', 'execute'),
  'authenticated can execute delete_account'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.delete_account()'::regprocedure),
  'delete_account is security definer'
);

select * from finish();
rollback;
