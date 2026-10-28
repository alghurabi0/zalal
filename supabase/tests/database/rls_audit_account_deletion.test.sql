-- RLS audit of migration account_deletion (Oct 28, 2026).
-- delete_account() refuses while an order is open (ZL039), so a deleted
-- account never has an order a crew would visit: its address copy is
-- anonymized (landmark '-deleted-', pin rounded to ~1 km) and its contact is
-- gone. Nothing may put a deleted account's order back into an open status
-- afterwards, including an admin override out of cancelled or no-show in
-- transition_order(), or the crew is sent to a ~1 km area with no contact
-- and the customer, who left, gets a booking. A trigger on orders refuses
-- it (P0002 order_not_found).
--
-- Writes racing the deletion (create_ticket, save_push_subscription,
-- send_chat_message… from another tab) check the role before
-- delete_account() commits, then insert once it has. The insert triggers of
-- tickets, chat, push, ratings, addresses and tanks lock the owner's live
-- profile (they wait behind delete_account's lock, then see it deleted) and
-- refuse with 42501. The race itself is two sessions; here the insert after
-- the deletion stands in for the one that waited.
begin;
\ir _helpers.psql

select plan(9);

select tests.create_user('+9647801111111');            -- customer (deleted)
select tests.create_user('+9647504444444', 'admin');

insert into tests.ids values ('cancelled', tests.create_order(tests.user_id('+9647801111111'), 'cancelled'));
insert into tests.ids values ('no_show', tests.create_order(tests.user_id('+9647801111111'), 'no_show'));

select tests.authenticate_as(tests.user_id('+9647801111111'));
select lives_ok($$ select public.delete_account() $$, 'the customer deletes the account');

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.transition_order(
       tests.id('cancelled'), 'confirmed',
       '{"override": true, "reason": "Customer called back"}'
     ) $$,
  'P0002', 'order_not_found',
  'an admin override can''t revive a cancelled order of a deleted account'
);
select throws_ok(
  $$ select public.transition_order(
       tests.id('no_show'), 'confirmed',
       '{"override": true, "reason": "Customer called back"}'
     ) $$,
  'P0002', 'order_not_found',
  'an admin override can''t revive a no-show order of a deleted account'
);

-- Inserts for a deleted owner, as the RPCs would make them after waiting.
select tests.clear_authentication();
select throws_ok(
  $$ insert into public.tickets (user_id, category, description, source)
     values (tests.user_id('+9647801111111'), 'leak', 'Water leaking again', 'app') $$,
  '42501', 'not_allowed', 'no ticket for a deleted account'
);
select throws_ok(
  $$ insert into public.chat_threads (user_id) values (tests.user_id('+9647801111111')) $$,
  '42501', 'not_allowed', 'no chat thread for a deleted account'
);
select throws_ok(
  $$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
     values (tests.user_id('+9647801111111'), 'https://fcm.googleapis.com/fcm/send/x',
       'B' || repeat('a', 86), repeat('b', 22)) $$,
  '42501', 'not_allowed', 'no push subscription for a deleted account'
);
select throws_ok(
  $$ insert into public.ratings (order_id, stars, comment)
     values (tests.id('cancelled'), 4, 'Fine') $$,
  '42501', 'not_allowed', 'no rating for a deleted account''s order'
);
select throws_ok(
  $$ insert into public.addresses (user_id, label, district, landmark, lat, lng)
     values (tests.user_id('+9647801111111'), 'home', 'حي الحسين', 'قرب الجامع', 32.616, 44.024) $$,
  '42501', 'not_allowed', 'no address for a deleted account'
);
select lives_ok(
  $$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
     values (tests.user_id('+9647504444444'), 'https://fcm.googleapis.com/fcm/send/y',
       'B' || repeat('a', 86), repeat('b', 22)) $$,
  'a live account still saves one'
);

select * from finish();
rollback;
