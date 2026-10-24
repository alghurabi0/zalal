-- Guard on auth.users (spec §9.1, §13 "Auth gaps for a stolen session").
-- Login is our server's job: it checks the code, then signs in with a
-- password only it can derive. So someone holding a stolen session must not
-- be able to give the account a second way in through Supabase Auth's own
-- API (PUT /auth/v1/user):
-- - A password changes only inside a window our server opened for that user
--   with allow_password_set() (service role only). The change uses up the
--   window, which lasts 30 seconds. Clearing a password is always allowed.
-- - No account gets an email address, or a pending email change.
-- The trigger fires whoever writes auth.users. The test runner can't switch
-- to Supabase Auth's own role (supabase_auth_admin), so the integration test
-- (tests/integration/otp-login.test.ts) covers the real Auth API.
begin;
\ir _helpers.psql

select plan(23);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647703333333', 'crew');
select tests.create_user('+9647504444444', 'admin');

select has_table('private', 'password_set_grants', 'the window table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'private.password_set_grants'::regclass),
  'the window table has RLS on'
);
select has_function('public', 'allow_password_set', array['uuid'], 'allow_password_set exists');

-- Passwords -----------------------------------------------------------------


select throws_ok(
  $$ update auth.users
     set encrypted_password = extensions.crypt('thief', extensions.gen_salt('bf'))
     where id = tests.user_id('+9647802222222') $$,
  'ZL002', 'password_change_not_allowed',
  'a password change without a window is refused (PUT /auth/v1/user with a stolen session)'
);

select throws_ok(
  $$ update auth.users
     set encrypted_password = extensions.crypt('thief', extensions.gen_salt('bf'))
     where id = tests.user_id('+9647504444444') $$,
  'ZL002', 'password_change_not_allowed',
  'an admin account is guarded the same way'
);

select lives_ok(
  $$ update auth.users set last_sign_in_at = now() where id = tests.user_id('+9647802222222') $$,
  'other columns still change freely (sign-in bookkeeping)'
);

select lives_ok(
  $$ update auth.users set encrypted_password = '' where id = tests.user_id('+9647802222222') $$,
  'clearing a password needs no window (account deletion)'
);


-- The server opens a window, then sets the password.
select tests.authenticate_as_service_role();
select lives_ok(
  $$ select public.allow_password_set(tests.user_id('+9647802222222')) $$,
  'the server opens a window'
);
select tests.clear_authentication();


select lives_ok(
  $$ update auth.users
     set encrypted_password = extensions.crypt('server-derived', extensions.gen_salt('bf'))
     where id = tests.user_id('+9647802222222') $$,
  'inside the window the password changes'
);

select throws_ok(
  $$ update auth.users
     set encrypted_password = extensions.crypt('thief', extensions.gen_salt('bf'))
     where id = tests.user_id('+9647802222222') $$,
  'ZL002', 'password_change_not_allowed',
  'the change used up the window'
);


select is(
  (select count(*)::int from private.password_set_grants
   where user_id = tests.user_id('+9647802222222')),
  0,
  'no window is left behind'
);

-- A window for one user doesn't open another's.
select tests.authenticate_as_service_role();
select public.allow_password_set(tests.user_id('+9647703333333'));
select tests.clear_authentication();
select throws_ok(
  $$ update auth.users
     set encrypted_password = extensions.crypt('thief', extensions.gen_salt('bf'))
     where id = tests.user_id('+9647801111111') $$,
  'ZL002', 'password_change_not_allowed',
  'a window is for one user only'
);

-- An expired window doesn't count. now() is fixed in this transaction, so
-- backdate the window.
update private.password_set_grants
set expires_at = now() - interval '1 second'
where user_id = tests.user_id('+9647703333333');
select throws_ok(
  $$ update auth.users
     set encrypted_password = extensions.crypt('server-derived', extensions.gen_salt('bf'))
     where id = tests.user_id('+9647703333333') $$,
  'ZL002', 'password_change_not_allowed',
  'an expired window is refused'
);

-- Creating a user with a password is the admin API's createUser: allowed.
select lives_ok(
  $$ insert into auth.users (id, instance_id, aud, role, phone, phone_confirmed_at,
       encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', '9647805555555', now(),
       extensions.crypt('server-derived', extensions.gen_salt('bf')),
       '{"provider": "phone", "providers": ["phone"]}', '{}', now(), now()) $$,
  'a new user may start with a password'
);

-- Email ---------------------------------------------------------------------

select throws_ok(
  $$ update auth.users set email = 'thief@example.com'
     where id = tests.user_id('+9647801111111') $$,
  'ZL003', 'email_not_allowed',
  'an email address is refused'
);

select throws_ok(
  $$ update auth.users set email_change = 'thief@example.com'
     where id = tests.user_id('+9647801111111') $$,
  'ZL003', 'email_not_allowed',
  'a pending email change is refused (PUT /auth/v1/user {email})'
);

select lives_ok(
  $$ update auth.users set email = '', email_change = ''
     where id = tests.user_id('+9647801111111') $$,
  'empty email values are fine (how Auth stores "no email")'
);

select throws_ok(
  $$ insert into auth.users (id, instance_id, aud, role, phone, email, phone_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', '9647806666666', 'thief@example.com', now(),
       '{"provider": "phone", "providers": ["phone"]}', '{}', now(), now()) $$,
  'ZL003', 'email_not_allowed',
  'a new user with an email is refused'
);


-- Who may open a window -----------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.allow_password_set(uuid)', 'execute'),
  'a guest cannot open a window'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.allow_password_set(tests.user_id('+9647801111111')) $$,
  '42501', null,
  'a customer cannot open a window, even for themselves'
);
select throws_ok(
  $$ select * from private.password_set_grants $$,
  '42501', null,
  'a customer cannot read the windows'
);
select tests.clear_authentication();

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.allow_password_set(tests.user_id('+9647801111111')) $$,
  '42501', null,
  'an admin cannot open a window either: only the server can'
);
select tests.clear_authentication();

select tests.authenticate_as_service_role();
select throws_ok(
  $$ select public.allow_password_set(gen_random_uuid()) $$,
  '23503', null,
  'a window needs a real user'
);
select tests.clear_authentication();

select * from finish();
rollback;
