-- Our own OTP codes (spec §9.1, decision 10). The server makes the code,
-- stores only its hash with request_otp, sends it, and records the outcome
-- with record_otp_sent or record_otp_send_failed. check_otp then checks a
-- typed code against the phone's latest sent code:
-- - a code is valid for 5 minutes and works once;
-- - a newer sent code replaces older ones; a failed or pending send doesn't;
-- - wrong codes count against that code; the 5th locks the phone for
--   15 minutes, and a locked phone can't check codes at all.
-- All three functions are for the server (service role) only.
begin;
\ir _helpers.psql

select plan(40);

select tests.create_user('+9647801111111');
select tests.create_user('+9647703333333', 'crew');
select tests.create_user('+9647504444444', 'admin');

-- Recording the send -----------------------------------------------------

create temp table req as
select request_id as id
from public.request_otp('+9647809100001', 'whatsapp', repeat('a', 64));

select lives_ok(
  $$ select public.record_otp_sent(
       (select id from req), 'whatsapp', 'sms-1234567890abcdef12345678') $$,
  'the server records a delivered code'
);

select results_eq(
  $$ select channel_used::text, sent_at, provider_message_id, send_error
     from public.otp_requests where id = (select id from req) $$,
  $$ values ('whatsapp'::text, now(), 'sms-1234567890abcdef12345678'::text, null::text) $$,
  'the row keeps the channel used, the send time and the provider message id'
);

select throws_ok(
  $$ select public.record_otp_sent((select id from req), 'sms', null) $$,
  'P0002',
  'otp_request_not_found',
  'a send is recorded only once'
);

select throws_ok(
  $$ select public.record_otp_send_failed((select id from req), 'unavailable') $$,
  'P0002',
  'otp_request_not_found',
  'a sent code cannot be marked failed afterwards'
);

select throws_ok(
  $$ select public.record_otp_sent(-1, 'whatsapp', null) $$,
  'P0002',
  'otp_request_not_found',
  'recording an unknown request is an error'
);

-- WhatsApp failed and the server fell back to SMS.
create temp table req_sms as
select request_id as id
from public.request_otp('+9647809100002', 'whatsapp', repeat('b', 64));

select public.record_otp_sent((select id from req_sms), 'sms', null);

select results_eq(
  $$ select channel::text, channel_used::text, provider_message_id
     from public.otp_requests where id = (select id from req_sms) $$,
  $$ values ('whatsapp'::text, 'sms'::text, null::text) $$,
  'a fallback keeps the chosen channel and records the one used'
);

create temp table req_failed as
select request_id as id
from public.request_otp('+9647809100003', 'whatsapp', repeat('c', 64));

select lives_ok(
  $$ select public.record_otp_send_failed((select id from req_failed), 'provider_account') $$,
  'the server records a failed send'
);

select results_eq(
  $$ select channel_used, sent_at, send_error
     from public.otp_requests where id = (select id from req_failed) $$,
  $$ values (null::public.otp_channel, null::timestamptz, 'provider_account'::text) $$,
  'a failed send keeps its error and no channel'
);

select throws_ok(
  $$ select public.record_otp_send_failed((select id from req_failed), 'unavailable') $$,
  'P0002',
  'otp_request_not_found',
  'a failure is recorded only once'
);

select throws_ok(
  $$ select public.record_otp_send_failed(
       (select request_id from public.request_otp('+9647809100004', 'sms', repeat('d', 64))),
       'oops') $$,
  '23514',
  null,
  'an unknown error code is refused'
);

-- Checking a code ----------------------------------------------------------

select results_eq(
  $$ select result, attempts_left, locked_until
     from public.check_otp('+9647809100001', repeat('a', 64)) $$,
  $$ values ('ok'::text, null::integer, null::timestamptz) $$,
  'the right code is accepted'
);

select is(
  (select verified_at from public.otp_requests where id = (select id from req)),
  now(),
  'an accepted code is marked used'
);

select results_eq(
  $$ select result from public.check_otp('+9647809100001', repeat('a', 64)) $$,
  $$ values ('no_code'::text) $$,
  'a code works only once'
);

select results_eq(
  $$ select result from public.check_otp('+9647809100003', repeat('c', 64)) $$,
  $$ values ('no_code'::text) $$,
  'a code that was never delivered cannot be used'
);

select results_eq(
  $$ select result, attempts_left from public.check_otp('+9647809199999', repeat('a', 64)) $$,
  $$ values ('no_code'::text, null::integer) $$,
  'a phone without any code gets no_code'
);

select is(
  (select count(*)::int from public.otp_requests where phone = '+9647809199999'),
  0,
  'checking without a code records nothing'
);

-- Expiry: 5 minutes from the request.
insert into public.otp_requests (phone, channel, code_hash, channel_used, sent_at, created_at)
values
  ('+9647809100005', 'whatsapp', repeat('e', 64), 'whatsapp',
   now() - interval '5 minutes', now() - interval '5 minutes'),
  ('+9647809100006', 'whatsapp', repeat('e', 64), 'whatsapp',
   now() - interval '4 minutes 59 seconds', now() - interval '4 minutes 59 seconds');

select results_eq(
  $$ select result from public.check_otp('+9647809100005', repeat('e', 64)) $$,
  $$ values ('expired'::text) $$,
  'a code is no longer valid after 5 minutes'
);

select results_eq(
  $$ select result from public.check_otp('+9647809100006', repeat('e', 64)) $$,
  $$ values ('ok'::text) $$,
  'a code is still valid just before 5 minutes'
);

-- A newer sent code replaces the older one; a failed resend doesn't.
insert into public.otp_requests (phone, channel, code_hash, channel_used, sent_at, created_at)
values
  ('+9647809100007', 'whatsapp', repeat('1', 64), 'whatsapp',
   now() - interval '2 minutes', now() - interval '2 minutes'),
  ('+9647809100007', 'sms', repeat('2', 64), 'sms',
   now() - interval '1 minute', now() - interval '1 minute');
insert into public.otp_requests (phone, channel, code_hash, send_error, created_at)
values ('+9647809100007', 'whatsapp', repeat('3', 64), 'unavailable', now());

select results_eq(
  $$ select result from public.check_otp('+9647809100007', repeat('3', 64)) $$,
  $$ values ('wrong_code'::text) $$,
  'the code of a failed send is not accepted'
);

select results_eq(
  $$ select result from public.check_otp('+9647809100007', repeat('1', 64)) $$,
  $$ values ('wrong_code'::text) $$,
  'an older code stops working once a newer one is sent'
);

select results_eq(
  $$ select result, attempts_left from public.check_otp('+9647809100007', repeat('2', 64)) $$,
  $$ values ('ok'::text, null::integer) $$,
  'the latest sent code works even after a failed resend'
);

-- Wrong codes and the lock ---------------------------------------------------

insert into public.otp_requests (phone, channel, code_hash, channel_used, sent_at)
values ('+9647809100008', 'whatsapp', repeat('a', 64), 'whatsapp', now());

select results_eq(
  $$ select result, attempts_left, locked_until
     from public.check_otp('+9647809100008', repeat('f', 64)) $$,
  $$ values ('wrong_code'::text, 4, null::timestamptz) $$,
  'the 1st wrong code leaves 4 attempts'
);

select public.check_otp('+9647809100008', repeat('f', 64));
select public.check_otp('+9647809100008', repeat('f', 64));

select results_eq(
  $$ select result, attempts_left, locked_until
     from public.check_otp('+9647809100008', repeat('f', 64)) $$,
  $$ values ('wrong_code'::text, 1, null::timestamptz) $$,
  'the 4th wrong code leaves 1 attempt'
);

select results_eq(
  $$ select result, attempts_left, locked_until
     from public.check_otp('+9647809100008', repeat('f', 64)) $$,
  $$ values ('locked'::text, 0, now() + interval '15 minutes') $$,
  'the 5th wrong code locks the phone for 15 minutes'
);

select results_eq(
  $$ select result, attempts_left, locked_until
     from public.check_otp('+9647809100008', repeat('a', 64)) $$,
  $$ values ('locked'::text, 0, now() + interval '15 minutes') $$,
  'while locked, even the right code is refused'
);

select is(
  (select failed_attempts::int from public.otp_requests where phone = '+9647809100008'),
  5,
  'checks while locked are not counted again'
);

select is(
  public.otp_locked_until('+9647809100008'),
  now() + interval '15 minutes',
  'otp_locked_until sees the lock'
);

-- The lock ran out, but the code it locked stays unusable.
insert into public.otp_requests (
  phone, channel, code_hash, channel_used, sent_at, failed_attempts, locked_until, created_at
)
values (
  '+9647809100009', 'whatsapp', repeat('a', 64), 'whatsapp', now() - interval '1 minute', 5,
  now() - interval '1 second', now() - interval '1 minute'
);

select results_eq(
  $$ select result, attempts_left from public.check_otp('+9647809100009', repeat('a', 64)) $$,
  $$ values ('expired'::text, 0) $$,
  'a code that used up its 5 attempts stays dead after the lock ends'
);

select is(
  (select allowed from public.request_otp('+9647809100009', 'whatsapp', repeat('b', 64))),
  true,
  'after the lock the phone can get a new code'
);

select public.record_otp_sent(
  (select id from public.otp_requests where phone = '+9647809100009' and code_hash = repeat('b', 64)),
  'whatsapp',
  null
);

select results_eq(
  $$ select result, attempts_left from public.check_otp('+9647809100009', repeat('f', 64)) $$,
  $$ values ('wrong_code'::text, 4) $$,
  'a new code gets a fresh set of 5 attempts'
);

-- Who can call ---------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.check_otp('+9647809100001', repeat('a', 64)) $$,
  '42501', null, 'anon cannot call check_otp'
);
select throws_ok(
  $$ select public.record_otp_sent(1, 'whatsapp', null) $$,
  '42501', null, 'anon cannot call record_otp_sent'
);
select throws_ok(
  $$ select public.record_otp_send_failed(1, 'unavailable') $$,
  '42501', null, 'anon cannot call record_otp_send_failed'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.check_otp('+9647801111111', repeat('a', 64)) $$,
  '42501', null, 'a customer cannot call check_otp'
);
select throws_ok(
  $$ select public.record_otp_sent(1, 'whatsapp', null) $$,
  '42501', null, 'a customer cannot call record_otp_sent'
);
select throws_ok(
  $$ select public.record_otp_send_failed(1, 'unavailable') $$,
  '42501', null, 'a customer cannot call record_otp_send_failed'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.check_otp('+9647703333333', repeat('a', 64)) $$,
  '42501', null, 'a crew cannot call check_otp'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.check_otp('+9647809100001', repeat('a', 64)) $$,
  '42501', null, 'an admin cannot call check_otp'
);
select throws_ok(
  $$ select public.record_otp_sent(1, 'whatsapp', null) $$,
  '42501', null, 'an admin cannot call record_otp_sent'
);

select tests.authenticate_as_service_role();
select lives_ok(
  $$ select public.check_otp('+9647809100001', repeat('a', 64)) $$,
  'the server can call check_otp'
);

select * from finish();
rollback;
