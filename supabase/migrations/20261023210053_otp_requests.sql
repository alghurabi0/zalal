-- OTP requests and limits (spec §9.1, decision 10).
--
-- Supabase Auth makes and checks the code; this table records each send so
-- the send-otp hook knows the channel the user picked, and so our limits hold:
-- - one send per 45 s, 3 per 10 minutes, 10 per rolling 24 hours, per phone;
-- - SMS only while settings.sms_enabled is on;
-- - wrong codes are counted per send; the 5th locks the phone for 15 minutes.
--   With the send limits that caps guessing at about 4 wrong codes per send,
--   12 per 10 minutes, out of a million codes.
--
-- Only the server touches this: the Login and OTP Server Actions call
-- request_otp / otp_locked_until / record_otp_failure with the secret key,
-- and the send-otp Edge Function reads the latest row and sets channel_used.
-- Admins can read it for support.
--
-- Departure from spec §7: besides phone, channel and created_at, the table
-- holds channel_used (WhatsApp failed over to SMS), failed_attempts and
-- locked_until, so the lockout needs no second table. "Per day" is a rolling
-- 24 hours, which needs no time zone.

create type public.otp_channel as enum ('whatsapp', 'sms');

create table public.otp_requests (
  id bigint generated always as identity primary key,
  phone text not null check (phone ~ '^\+9647[3-9][0-9]{8}$'),
  -- What the user picked on Login.
  channel public.otp_channel not null,
  -- What send-otp actually used; null until it sends.
  channel_used public.otp_channel,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

alter table public.otp_requests enable row level security;

create index otp_requests_phone_created_at_idx
on public.otp_requests (phone, created_at desc);

revoke all on public.otp_requests from anon, authenticated;
grant select on public.otp_requests to authenticated;

create policy "Admins read OTP requests"
on public.otp_requests
for select
to authenticated
using ((select private.is_admin()));

-- Functions ------------------------------------------------------------------
--
-- Security invoker: only the service role may call them, and it already has
-- full access to the table.

-- When the phone's lock ends, or null if it isn't locked.
create function public.otp_locked_until(p_phone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select max(r.locked_until)
  from public.otp_requests as r
  where r.phone = p_phone and r.locked_until > now();
$$;

-- Records a send if the limits allow it. When they don't, nothing is
-- recorded and `reason` says why: sms_disabled, locked, too_soon, too_many
-- (3 per 10 minutes) or daily_limit (10 per 24 hours), with the seconds until
-- the next send is allowed.
create function public.request_otp(
  p_phone text,
  p_channel public.otp_channel,
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

  select r.created_at + interval '45 seconds' into v_until
  from public.otp_requests as r
  where r.phone = p_phone and r.created_at > now() - interval '45 seconds'
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

  insert into public.otp_requests (phone, channel)
  values (p_phone, p_channel)
  returning id into request_id;
  allowed := true;
end;
$$;

-- Counts a wrong code against the phone's latest send. Returns the attempts
-- left for that code and, from the 5th wrong code, when the lock ends.
create function public.record_otp_failure(
  p_phone text,
  out attempts_left integer,
  out locked_until timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
  v_failed smallint;
begin
  perform pg_advisory_xact_lock(hashtextextended('otp:' || p_phone, 0));

  select r.id, r.failed_attempts into v_id, v_failed
  from public.otp_requests as r
  where r.phone = p_phone
  order by r.created_at desc, r.id desc
  limit 1;
  if v_id is null then
    raise exception using errcode = 'P0002', message = 'otp_request_not_found';
  end if;

  -- Already locked: keep the lock as it is.
  locked_until := public.otp_locked_until(p_phone);
  if locked_until is not null or v_failed >= 5 then
    attempts_left := 0;
    return;
  end if;

  update public.otp_requests as r
  set
    failed_attempts = r.failed_attempts + 1,
    locked_until = case
      when r.failed_attempts + 1 >= 5 then now() + interval '15 minutes'
    end
  where r.id = v_id
  returning 5 - r.failed_attempts, r.locked_until into attempts_left, locked_until;
end;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated.
revoke execute on function public.otp_locked_until(text) from public, anon, authenticated;
revoke execute on function public.request_otp(text, public.otp_channel) from public, anon, authenticated;
revoke execute on function public.record_otp_failure(text) from public, anon, authenticated;
grant execute on function public.otp_locked_until(text) to service_role;
grant execute on function public.request_otp(text, public.otp_channel) to service_role;
grant execute on function public.record_otp_failure(text) to service_role;

-- Old sends are only needed for the 24-hour limit; keep a week for support.
-- 00:17 UTC is 03:17 in Baghdad.
select cron.schedule(
  'purge-otp-requests',
  '17 0 * * *',
  $$ delete from public.otp_requests where created_at < now() - interval '7 days' $$
);
