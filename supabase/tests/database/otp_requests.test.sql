-- otp_requests and the send limits (spec §9.1, decision 10): one resend per
-- 45 s, 3 sends per 10 minutes, 10 per day per phone, SMS only while
-- sms_enabled is on, and no new code while the phone is locked. A send that
-- failed doesn't hold up the next one for 45 s, so the user can switch to
-- SMS at once, but it still counts toward the 3 and the 10.
-- Only the server calls these functions; admins can read the table, except
-- the code hash. Code checks are in otp_codes.test.sql.
--
-- now() is fixed inside a transaction, so earlier sends are inserted with
-- a backdated created_at.
begin;
\ir _helpers.psql

select plan(42);

select tests.create_user('+9647801111111');
select tests.create_user('+9647703333333', 'crew');
select tests.create_user('+9647504444444', 'admin');

-- Shape ------------------------------------------------------------------

select has_table('public', 'otp_requests', 'otp_requests exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.otp_requests'::regclass),
  'otp_requests has RLS enabled'
);

select is(
  (select count(*)::int from cron.job where jobname = 'purge-otp-requests'),
  1,
  'a daily job purges old OTP requests'
);

select hasnt_function(
  'public', 'record_otp_failure', array['text'],
  'record_otp_failure is replaced by check_otp'
);

-- A first send -----------------------------------------------------------

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000001', 'whatsapp', repeat('a', 64)) $$,
  $$ values (true, null::text, null::integer) $$,
  'a first send is allowed'
);

select results_eq(
  $$ select channel::text, code_hash, channel_used, sent_at, send_error, failed_attempts
     from public.otp_requests where phone = '+9647809000001' $$,
  $$ values (
       'whatsapp'::text, repeat('a', 64), null::public.otp_channel, null::timestamptz,
       null::text, 0::smallint
     ) $$,
  'the send is recorded with the chosen channel and the code hash, not yet sent'
);

create temp table first_send as
select * from public.request_otp('+9647809000011', 'whatsapp', repeat('a', 64));

select is(
  (select request_id from first_send),
  (select id from public.otp_requests where phone = '+9647809000011'),
  'request_otp returns the new row id'
);

select throws_ok(
  $$ select public.request_otp('+9647201234567', 'whatsapp', repeat('a', 64)) $$,
  '23514',
  null,
  'a non-mobile number is refused'
);

select throws_ok(
  $$ select public.request_otp('+9647809000012', 'whatsapp', 'not-a-hash') $$,
  '23514',
  null,
  'a code hash that is not 64 hex characters is refused'
);

select throws_ok(
  $$ select public.request_otp('+9647809000012', 'whatsapp', null) $$,
  '23502',
  null,
  'a send without a code hash is refused'
);

-- 45 s resend ------------------------------------------------------------

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000001', 'whatsapp', repeat('a', 64)) $$,
  $$ values (false, 'too_soon'::text, 45) $$,
  'a resend within 45 s is refused'
);

insert into public.otp_requests (phone, channel, code_hash, created_at)
values ('+9647809000002', 'whatsapp', repeat('a', 64), now() - interval '30 seconds');

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000002', 'whatsapp', repeat('a', 64)) $$,
  $$ values (false, 'too_soon'::text, 15) $$,
  'the 45 s wait counts from the last send'
);

select is(
  (select count(*)::int from public.otp_requests where phone = '+9647809000002'),
  1,
  'a refused send is not recorded'
);

insert into public.otp_requests (phone, channel, code_hash, send_error, created_at)
values ('+9647809000013', 'whatsapp', repeat('a', 64), 'unavailable', now() - interval '5 seconds');

select is(
  (select allowed from public.request_otp('+9647809000013', 'sms', repeat('a', 64))),
  true,
  'after a failed send the user can ask again without the 45 s wait'
);

-- 3 per 10 minutes -------------------------------------------------------

insert into public.otp_requests (phone, channel, code_hash, created_at)
values
  ('+9647809000003', 'whatsapp', repeat('a', 64), now() - interval '8 minutes'),
  ('+9647809000003', 'whatsapp', repeat('a', 64), now() - interval '5 minutes'),
  ('+9647809000003', 'whatsapp', repeat('a', 64), now() - interval '2 minutes');

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000003', 'whatsapp', repeat('a', 64)) $$,
  $$ values (false, 'too_many'::text, 120) $$,
  'a 4th send within 10 minutes waits until the oldest leaves the window'
);

insert into public.otp_requests (phone, channel, code_hash, created_at)
values
  ('+9647809000004', 'whatsapp', repeat('a', 64), now() - interval '11 minutes'),
  ('+9647809000004', 'whatsapp', repeat('a', 64), now() - interval '5 minutes'),
  ('+9647809000004', 'whatsapp', repeat('a', 64), now() - interval '2 minutes');

select is(
  (select allowed from public.request_otp('+9647809000004', 'whatsapp', repeat('a', 64))),
  true,
  'sends older than 10 minutes do not count toward the 3'
);

insert into public.otp_requests (phone, channel, code_hash, send_error, created_at)
values
  ('+9647809000014', 'whatsapp', repeat('a', 64), 'unavailable', now() - interval '3 minutes'),
  ('+9647809000014', 'whatsapp', repeat('a', 64), 'unavailable', now() - interval '2 minutes'),
  ('+9647809000014', 'whatsapp', repeat('a', 64), 'unavailable', now() - interval '1 minute');

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000014', 'whatsapp', repeat('a', 64)) $$,
  $$ values (false, 'too_many'::text, 420) $$,
  'failed sends still count toward the 3 per 10 minutes'
);

-- 10 per day -------------------------------------------------------------

insert into public.otp_requests (phone, channel, code_hash, created_at)
select '+9647809000005', 'whatsapp', repeat('a', 64), now() - make_interval(hours => h)
from generate_series(14, 23) as h;

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000005', 'whatsapp', repeat('a', 64)) $$,
  $$ values (false, 'daily_limit'::text, 3600) $$,
  'an 11th send within 24 hours waits until the oldest is a day old'
);

insert into public.otp_requests (phone, channel, code_hash, created_at)
select '+9647809000006', 'whatsapp', repeat('a', 64), now() - make_interval(hours => h)
from generate_series(15, 24) as h;

select is(
  (select allowed from public.request_otp('+9647809000006', 'whatsapp', repeat('a', 64))),
  true,
  'sends older than 24 hours do not count toward the 10'
);

-- SMS switch -------------------------------------------------------------

select is(
  (select allowed from public.request_otp('+9647809000007', 'sms', repeat('a', 64))),
  true,
  'SMS is allowed while sms_enabled is on'
);

update public.settings set sms_enabled = false;

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000008', 'sms', repeat('a', 64)) $$,
  $$ values (false, 'sms_disabled'::text, null::integer) $$,
  'SMS is refused while sms_enabled is off'
);

select is(
  (select allowed from public.request_otp('+9647809000008', 'whatsapp', repeat('a', 64))),
  true,
  'WhatsApp still works while SMS is off'
);

update public.settings set sms_enabled = true;

-- The lock ---------------------------------------------------------------

insert into public.otp_requests (
  phone, channel, code_hash, channel_used, sent_at, failed_attempts, locked_until, created_at
)
values (
  '+9647809000009', 'whatsapp', repeat('a', 64), 'whatsapp', now() - interval '1 minute', 5,
  now() + interval '10 minutes', now() - interval '1 minute'
);

select is(
  public.otp_locked_until('+9647809000009'),
  now() + interval '10 minutes',
  'otp_locked_until reports the lock'
);

select is(
  public.otp_locked_until('+9647809000001'),
  null,
  'a phone without wrong codes is not locked'
);

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000009', 'whatsapp', repeat('a', 64)) $$,
  $$ values (false, 'locked'::text, 600) $$,
  'a locked phone cannot get a new code'
);

insert into public.otp_requests (phone, channel, code_hash, failed_attempts, locked_until, created_at)
values (
  '+9647809000010', 'whatsapp', repeat('a', 64), 5, now() - interval '1 minute',
  now() - interval '20 minutes'
);

select is(
  (select allowed from public.request_otp('+9647809000010', 'whatsapp', repeat('a', 64))),
  true,
  'an expired lock no longer blocks'
);

-- Row rules --------------------------------------------------------------

select throws_ok(
  $$ insert into public.otp_requests (phone, channel, code_hash, sent_at)
     values ('+9647809000015', 'whatsapp', repeat('a', 64), now()) $$,
  '23514',
  null,
  'a sent row must say which channel was used'
);

select throws_ok(
  $$ insert into public.otp_requests (phone, channel, code_hash, channel_used, sent_at, send_error)
     values ('+9647809000015', 'whatsapp', repeat('a', 64), 'whatsapp', now(), 'unavailable') $$,
  '23514',
  null,
  'a row cannot be both sent and failed'
);

select throws_ok(
  $$ insert into public.otp_requests (phone, channel, code_hash, send_error)
     values ('+9647809000015', 'whatsapp', repeat('a', 64), 'something else') $$,
  '23514',
  null,
  'send_error takes only the known codes'
);

-- Who can call and read --------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select id from public.otp_requests $$,
  '42501', null, 'anon cannot read otp_requests'
);
select throws_ok(
  $$ select public.request_otp('+9647809000020', 'whatsapp', repeat('a', 64)) $$,
  '42501', null, 'anon cannot call request_otp'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty(
  $$ select id from public.otp_requests $$,
  'a customer reads no OTP requests'
);
select throws_ok(
  $$ insert into public.otp_requests (phone, channel, code_hash)
     values ('+9647801111111', 'sms', repeat('a', 64)) $$,
  '42501', null, 'a customer cannot insert an OTP request'
);
select throws_ok(
  $$ select public.otp_locked_until('+9647801111111') $$,
  '42501', null, 'a customer cannot call otp_locked_until'
);
select throws_ok(
  $$ select public.request_otp('+9647801111111', 'whatsapp', repeat('a', 64)) $$,
  '42501', null, 'a customer cannot call request_otp'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty(
  $$ select id from public.otp_requests $$,
  'a crew reads no OTP requests'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select ok(
  (select count(id) from public.otp_requests) > 0,
  'an admin can read OTP requests (support)'
);
select lives_ok(
  $$ select id, phone, channel, channel_used, sent_at, provider_message_id, send_error,
            failed_attempts, locked_until, verified_at, created_at
     from public.otp_requests $$,
  'an admin can read every column but the code hash'
);
select throws_ok(
  $$ select code_hash from public.otp_requests $$,
  '42501', null, 'an admin cannot read code hashes'
);
select throws_ok(
  $$ update public.otp_requests set locked_until = null $$,
  '42501', null, 'an admin cannot clear a lock directly'
);
select throws_ok(
  $$ select public.request_otp('+9647809000021', 'whatsapp', repeat('a', 64)) $$,
  '42501', null, 'an admin cannot call request_otp'
);

select tests.authenticate_as_service_role();
select lives_ok(
  $$ select code_hash from public.otp_requests $$,
  'the server can read code hashes'
);

select * from finish();
rollback;
