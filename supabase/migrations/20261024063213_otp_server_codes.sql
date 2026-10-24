-- Our server makes, sends and checks phone codes (spec §9.1, decision 10,
-- §13 "OTP verify bypass", settled Oct 24, 2026).
--
-- Why: when Supabase Auth makes the code, a client can call Auth's /verify
-- endpoint directly. It has no attempt limit and no captcha, only a per-IP
-- rate limit, so our 5-wrong-codes lock could be skipped by guessing from
-- many IPs. Now Auth never makes a phone code:
-- - The server makes a 6-digit code, stores only its HMAC (keyed with a
--   server secret, so a database dump can't be brute-forced), sends it
--   through OTPIQ, and checks typed codes with check_otp.
-- - On a correct code the server creates the user through the Auth admin
--   API if needed and signs in with a password only the server can derive
--   (an HMAC of the user id), so no Auth phone code exists.
-- - The Send SMS Hook below refuses every send, so /otp, /resend and phone
--   sign-up called directly deliver nothing.
--
-- Changes to otp_requests (departures from spec §7, which listed phone,
-- channel, channel_used, failed_attempts, locked_until, created_at):
-- - code_hash: HMAC-SHA256 of the code, hex. Required, so the rows from
--   before this migration (no code, never delivered) are deleted.
-- - sent_at, provider_message_id (OTPIQ's smsId, for support), send_error:
--   what happened to the send. A row is pending, sent or failed.
-- - verified_at: the code was used; each code works once.
-- - Admins read every column except code_hash.
--
-- request_otp now takes the code hash. A failed send no longer holds up the
-- next one for 45 s, so after a WhatsApp failure the user can switch to SMS
-- at once; it still counts toward 3 per 10 minutes and 10 per day.
-- check_otp replaces record_otp_failure (no app code used it yet): it checks
-- the code, counts a wrong one and locks on the 5th, in one step.

-- Table ----------------------------------------------------------------------

delete from public.otp_requests;

alter table public.otp_requests
  add column code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  add column sent_at timestamptz,
  add column provider_message_id text check (
    char_length(provider_message_id) between 1 and 64
    and provider_message_id = btrim(provider_message_id)
  ),
  -- unavailable: timeout, network or provider error; rejected: the provider
  -- refused the number or the request; provider_account: our OTPIQ account
  -- (key, credit, spending cap, trial); rate_limited: OTPIQ's own limit;
  -- not_configured: no sender set up for the channel.
  add column send_error text check (
    send_error in ('unavailable', 'rejected', 'provider_account', 'rate_limited', 'not_configured')
  ),
  add column verified_at timestamptz,
  add constraint otp_requests_sent_has_channel check ((sent_at is null) = (channel_used is null)),
  add constraint otp_requests_sent_or_failed check (sent_at is null or send_error is null),
  add constraint otp_requests_verified_after_sent check (verified_at is null or sent_at is not null);

comment on column public.otp_requests.code_hash is
  'HMAC-SHA256 of the code (hex). Only the server reads it.';

-- Admins keep reading for support, but never the code hash.
revoke select on public.otp_requests from authenticated;
grant select (
  id, phone, channel, channel_used, failed_attempts, locked_until, created_at,
  sent_at, provider_message_id, send_error, verified_at
) on public.otp_requests to authenticated;

-- Functions ------------------------------------------------------------------
--
-- Security invoker: only the service role may call them, and it already has
-- full access to the table. All take the same per-phone advisory lock, so
-- sends and checks for one phone run one at a time.

drop function public.record_otp_failure(text);
drop function public.request_otp(text, public.otp_channel);

-- Records a send if the limits allow it. When they don't, nothing is
-- recorded and `reason` says why: sms_disabled, locked, too_soon, too_many
-- (3 per 10 minutes) or daily_limit (10 per 24 hours), with the seconds until
-- the next send is allowed.
create function public.request_otp(
  p_phone text,
  p_channel public.otp_channel,
  p_code_hash text,
  out allowed boolean,
  out reason text,
  out retry_after_s integer,
  out request_id bigint
)
language plpgsql
set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  -- One request per phone at a time, so two parallel sends can't both pass.
  perform pg_advisory_xact_lock(hashtextextended('otp:' || p_phone, 0));

  allowed := false;

  if p_channel = 'sms' and not (select s.sms_enabled from public.settings as s) then
    reason := 'sms_disabled';
    return;
  end if;

  v_until := public.otp_locked_until(p_phone);
  if v_until is not null then
    reason := 'locked';
    retry_after_s := ceil(extract(epoch from v_until - now()))::integer;
    return;
  end if;

  -- A failed send doesn't start the 45 s wait.
  select r.created_at + interval '45 seconds' into v_until
  from public.otp_requests as r
  where r.phone = p_phone
    and r.created_at > now() - interval '45 seconds'
    and r.send_error is null
  order by r.created_at desc
  limit 1;
  if v_until is not null then
    reason := 'too_soon';
    retry_after_s := ceil(extract(epoch from v_until - now()))::integer;
    return;
  end if;

  -- With 3 sends in the window, the next is allowed once the 3rd newest
  -- leaves it.
  select r.created_at + interval '10 minutes' into v_until
  from public.otp_requests as r
  where r.phone = p_phone and r.created_at > now() - interval '10 minutes'
  order by r.created_at desc
  offset 2
  limit 1;
  if v_until is not null then
    reason := 'too_many';
    retry_after_s := ceil(extract(epoch from v_until - now()))::integer;
    return;
  end if;

  select r.created_at + interval '24 hours' into v_until
  from public.otp_requests as r
  where r.phone = p_phone and r.created_at > now() - interval '24 hours'
  order by r.created_at desc
  offset 9
  limit 1;
  if v_until is not null then
    reason := 'daily_limit';
    retry_after_s := ceil(extract(epoch from v_until - now()))::integer;
    return;
  end if;

  insert into public.otp_requests (phone, channel, code_hash)
  values (p_phone, p_channel, p_code_hash)
  returning id into request_id;
  allowed := true;
end;
$$;

-- The code reached the provider. p_channel_used differs from the chosen
-- channel when WhatsApp failed and the server fell back to SMS. The local
-- log sender has no provider message id.
create function public.record_otp_sent(
  p_request_id bigint,
  p_channel_used public.otp_channel,
  p_provider_message_id text default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.otp_requests as r
  set channel_used = p_channel_used, sent_at = now(), provider_message_id = p_provider_message_id
  where r.id = p_request_id and r.sent_at is null and r.send_error is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'otp_request_not_found';
  end if;
end;
$$;

-- Every channel tried failed; p_error is the last one's error code.
create function public.record_otp_send_failed(p_request_id bigint, p_error text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.otp_requests as r
  set send_error = p_error
  where r.id = p_request_id and r.sent_at is null and r.send_error is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'otp_request_not_found';
  end if;
end;
$$;

-- Checks a typed code (as the server's HMAC) against the phone's latest
-- delivered code. `result` is one of:
-- - ok: right code; it is now used up.
-- - wrong_code: attempts_left says how many tries the code has left.
-- - locked: the phone is locked until locked_until (also returned by the
--   5th wrong code). Nothing is checked or counted while locked.
-- - expired: the code is older than 5 minutes, or used up its 5 attempts.
-- - no_code: no delivered, unused code for this phone.
create function public.check_otp(
  p_phone text,
  p_code_hash text,
  out result text,
  out attempts_left integer,
  out locked_until timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  v_row public.otp_requests%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('otp:' || p_phone, 0));

  locked_until := public.otp_locked_until(p_phone);
  if locked_until is not null then
    result := 'locked';
    attempts_left := 0;
    return;
  end if;

  select * into v_row
  from public.otp_requests as r
  where r.phone = p_phone and r.sent_at is not null
  order by r.created_at desc, r.id desc
  limit 1;

  if v_row.id is null or v_row.verified_at is not null then
    result := 'no_code';
    return;
  end if;

  if v_row.failed_attempts >= 5 then
    result := 'expired';
    attempts_left := 0;
    return;
  end if;

  if v_row.created_at <= now() - interval '5 minutes' then
    result := 'expired';
    return;
  end if;

  if v_row.code_hash = p_code_hash then
    update public.otp_requests as r set verified_at = now() where r.id = v_row.id;
    result := 'ok';
    return;
  end if;

  update public.otp_requests as r
  set
    failed_attempts = r.failed_attempts + 1,
    locked_until = case
      when r.failed_attempts + 1 >= 5 then now() + interval '15 minutes'
    end
  where r.id = v_row.id
  returning 5 - r.failed_attempts, r.locked_until into attempts_left, locked_until;

  result := case when locked_until is null then 'wrong_code' else 'locked' end;
end;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated.
revoke execute on function public.request_otp(text, public.otp_channel, text) from public, anon, authenticated;
revoke execute on function public.record_otp_sent(bigint, public.otp_channel, text) from public, anon, authenticated;
revoke execute on function public.record_otp_send_failed(bigint, text) from public, anon, authenticated;
revoke execute on function public.check_otp(text, text) from public, anon, authenticated;
grant execute on function public.request_otp(text, public.otp_channel, text) to service_role;
grant execute on function public.record_otp_sent(bigint, public.otp_channel, text) to service_role;
grant execute on function public.record_otp_send_failed(bigint, text) to service_role;
grant execute on function public.check_otp(text, text) to service_role;

-- Send SMS Hook ---------------------------------------------------------------
--
-- Set as the project's Send SMS Hook (Postgres function), locally in
-- config.toml and on hosted projects under Authentication → Hooks
-- (docs/supabase-setup.md). It refuses every send, so Supabase Auth never
-- stores a phone code that could be guessed at /verify.

create function private.refuse_auth_sms(event jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'error',
    jsonb_build_object('http_code', 403, 'message', 'phone_codes_are_sent_by_the_app')
  );
$$;

grant usage on schema private to supabase_auth_admin;
revoke execute on all functions in schema private from public;
grant execute on function private.refuse_auth_sms(jsonb) to supabase_auth_admin;
