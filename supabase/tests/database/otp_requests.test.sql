-- otp_requests and the OTP rules (spec §9.1, decision 10): one resend per
-- 45 s, 3 sends per 10 minutes, 10 per day per phone, SMS only while
-- sms_enabled is on, and 5 wrong codes lock the phone for 15 minutes.
-- Only the server calls these functions; admins can read the table.
--
-- now() is fixed inside a transaction, so earlier sends are inserted with
-- a backdated created_at.
begin;
\ir _helpers.psql

select plan(37);

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

-- A first send -----------------------------------------------------------

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000001', 'whatsapp') $$,
  $$ values (true, null::text, null::integer) $$,
  'a first send is allowed'
);

select results_eq(
  $$ select channel::text, channel_used, failed_attempts, locked_until
     from public.otp_requests where phone = '+9647809000001' $$,
  $$ values ('whatsapp'::text, null::public.otp_channel, 0::smallint, null::timestamptz) $$,
  'the send is recorded with the chosen channel'
);

create temp table first_send as
select * from public.request_otp('+9647809000011', 'whatsapp');

select is(
  (select request_id from first_send),
  (select id from public.otp_requests where phone = '+9647809000011'),
  'request_otp returns the new row id'
);

select throws_ok(
  $$ select public.request_otp('+9647201234567', 'whatsapp') $$,
  '23514',
  null,
  'a non-mobile number is refused'
);

-- 45 s resend ------------------------------------------------------------

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000001', 'whatsapp') $$,
  $$ values (false, 'too_soon'::text, 45) $$,
  'a resend within 45 s is refused'
);

insert into public.otp_requests (phone, channel, created_at)
values ('+9647809000002', 'whatsapp', now() - interval '30 seconds');

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000002', 'whatsapp') $$,
  $$ values (false, 'too_soon'::text, 15) $$,
  'the 45 s wait counts from the last send'
);

select is(
  (select count(*)::int from public.otp_requests where phone = '+9647809000002'),
  1,
  'a refused send is not recorded'
);

-- 3 per 10 minutes -------------------------------------------------------

insert into public.otp_requests (phone, channel, created_at)
values
  ('+9647809000003', 'whatsapp', now() - interval '8 minutes'),
  ('+9647809000003', 'whatsapp', now() - interval '5 minutes'),
  ('+9647809000003', 'whatsapp', now() - interval '2 minutes');

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000003', 'whatsapp') $$,
  $$ values (false, 'too_many'::text, 120) $$,
  'a 4th send within 10 minutes waits until the oldest leaves the window'
);

insert into public.otp_requests (phone, channel, created_at)
values
  ('+9647809000004', 'whatsapp', now() - interval '11 minutes'),
  ('+9647809000004', 'whatsapp', now() - interval '5 minutes'),
  ('+9647809000004', 'whatsapp', now() - interval '2 minutes');

select is(
  (select allowed from public.request_otp('+9647809000004', 'whatsapp')),
  true,
  'sends older than 10 minutes do not count toward the 3'
);

-- 10 per day -------------------------------------------------------------

insert into public.otp_requests (phone, channel, created_at)
select '+9647809000005', 'whatsapp', now() - make_interval(hours => h)
from generate_series(14, 23) as h;

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000005', 'whatsapp') $$,
  $$ values (false, 'daily_limit'::text, 3600) $$,
  'an 11th send within 24 hours waits until the oldest is a day old'
);

insert into public.otp_requests (phone, channel, created_at)
select '+9647809000006', 'whatsapp', now() - make_interval(hours => h)
from generate_series(15, 24) as h;

select is(
  (select allowed from public.request_otp('+9647809000006', 'whatsapp')),
  true,
  'sends older than 24 hours do not count toward the 10'
);

-- SMS switch -------------------------------------------------------------

select is(
  (select allowed from public.request_otp('+9647809000007', 'sms')),
  true,
  'SMS is allowed while sms_enabled is on'
);

update public.settings set sms_enabled = false;

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000008', 'sms') $$,
  $$ values (false, 'sms_disabled'::text, null::integer) $$,
  'SMS is refused while sms_enabled is off'
);

select is(
  (select allowed from public.request_otp('+9647809000008', 'whatsapp')),
  true,
  'WhatsApp still works while SMS is off'
);

update public.settings set sms_enabled = true;

-- Wrong codes and the lock -----------------------------------------------

select public.request_otp('+9647809000009', 'whatsapp');

select is(
  public.otp_locked_until('+9647809000009'),
  null,
  'a fresh phone is not locked'
);

select results_eq(
  $$ select attempts_left, locked_until
     from public.record_otp_failure('+9647809000009') $$,
  $$ values (4, null::timestamptz) $$,
  'the 1st wrong code leaves 4 attempts'
);

select public.record_otp_failure('+9647809000009');
select public.record_otp_failure('+9647809000009');

select results_eq(
  $$ select attempts_left, locked_until
     from public.record_otp_failure('+9647809000009') $$,
  $$ values (1, null::timestamptz) $$,
  'the 4th wrong code leaves 1 attempt'
);

select results_eq(
  $$ select attempts_left, locked_until
     from public.record_otp_failure('+9647809000009') $$,
  $$ values (0, now() + interval '15 minutes') $$,
  'the 5th wrong code locks the phone for 15 minutes'
);

select is(
  public.otp_locked_until('+9647809000009'),
  now() + interval '15 minutes',
  'otp_locked_until reports the lock'
);

select results_eq(
  $$ select attempts_left, locked_until
     from public.record_otp_failure('+9647809000009') $$,
  $$ values (0, now() + interval '15 minutes') $$,
  'more wrong codes while locked keep the same lock'
);

-- Clear the 45 s wait so only the lock applies.
update public.otp_requests set created_at = now() - interval '1 minute'
where phone = '+9647809000009';

select results_eq(
  $$ select allowed, reason, retry_after_s
     from public.request_otp('+9647809000009', 'whatsapp') $$,
  $$ values (false, 'locked'::text, 900) $$,
  'a locked phone cannot get a new code'
);

insert into public.otp_requests (phone, channel, failed_attempts, locked_until, created_at)
values ('+9647809000010', 'whatsapp', 5, now() - interval '1 minute', now() - interval '20 minutes');

select is(
  (select allowed from public.request_otp('+9647809000010', 'whatsapp')),
  true,
  'an expired lock no longer blocks'
);

select results_eq(
  $$ select attempts_left, locked_until
     from public.record_otp_failure('+9647809000010') $$,
  $$ values (4, null::timestamptz) $$,
  'a new code gets a fresh set of 5 attempts'
);

select throws_ok(
  $$ select public.record_otp_failure('+9647809000099') $$,
  'P0002',
  null,
  'a wrong code without any send is an error'
);

-- Who can call and read --------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.otp_requests $$,
  '42501', null, 'anon cannot read otp_requests'
);
select throws_ok(
  $$ select public.request_otp('+9647809000020', 'whatsapp') $$,
  '42501', null, 'anon cannot call request_otp'
);
select throws_ok(
  $$ select public.record_otp_failure('+9647809000001') $$,
  '42501', null, 'anon cannot call record_otp_failure'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty(
  $$ select 1 from public.otp_requests $$,
  'a customer reads no OTP requests'
);
select throws_ok(
  $$ insert into public.otp_requests (phone, channel) values ('+9647801111111', 'sms') $$,
  '42501', null, 'a customer cannot insert an OTP request'
);
select throws_ok(
  $$ select public.otp_locked_until('+9647801111111') $$,
  '42501', null, 'a customer cannot call otp_locked_until'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty(
  $$ select 1 from public.otp_requests $$,
  'a crew reads no OTP requests'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select ok(
  (select count(*) from public.otp_requests) > 0,
  'an admin can read OTP requests (support)'
);
select throws_ok(
  $$ update public.otp_requests set locked_until = null $$,
  '42501', null, 'an admin cannot clear a lock directly'
);
select throws_ok(
  $$ select public.request_otp('+9647809000021', 'whatsapp') $$,
  '42501', null, 'an admin cannot call request_otp'
);

select * from finish();
rollback;
