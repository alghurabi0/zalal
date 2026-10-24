-- The Send SMS Hook (spec §9.1). Our server makes, sends and checks phone
-- codes itself, so Supabase Auth must never send one: a client calling
-- Auth's /otp, /resend or phone sign-up directly would skip our limits, and
-- a code Auth made could be guessed at its /verify endpoint, which has no
-- attempt limit. The hook refuses every send, so Auth never stores a phone
-- code. Only Supabase Auth (supabase_auth_admin) may run it.
begin;
\ir _helpers.psql

select plan(7);

select has_function(
  'private', 'refuse_auth_sms', array['jsonb'],
  'the hook function exists'
);

select is(
  private.refuse_auth_sms(
    '{"user": {"phone": "9647801111111"}, "sms": {"otp": "123456", "phone": "9647801111111"}}'
  ) -> 'error' ->> 'http_code',
  '403',
  'every send is refused with a 403'
);

select is(
  private.refuse_auth_sms('{}') -> 'error' ->> 'message',
  'phone_codes_are_sent_by_the_app',
  'the refusal says why'
);

select ok(
  has_function_privilege('supabase_auth_admin', 'private.refuse_auth_sms(jsonb)', 'execute'),
  'Supabase Auth can run the hook'
);

select ok(
  not has_function_privilege('anon', 'private.refuse_auth_sms(jsonb)', 'execute'),
  'anon cannot run the hook'
);

select ok(
  not has_function_privilege('authenticated', 'private.refuse_auth_sms(jsonb)', 'execute'),
  'logged-in users cannot run the hook'
);

select ok(
  not has_function_privilege('supabase_auth_admin', 'private.current_user_role()', 'execute'),
  'Supabase Auth gets only the hook, not the other private functions'
);

select * from finish();
rollback;
