-- Guard on auth.users (spec §9.1, §13 "Auth gaps for a stolen session").
-- Login is our server's job: it checks the code, then signs in with a
-- password only it can derive. So someone holding a stolen session must not
-- be able to give the account a second way in through Supabase Auth's own
-- API (PUT /auth/v1/user):
-- - A password changes only inside set_login_password() (service role
--   only), which sets it and logs the user out everywhere. Clearing a
--   password is always allowed.
-- - No account gets an email address, or a pending email change.
-- The trigger fires whoever writes auth.users. The test runner can't switch
-- to Supabase Auth's own role (supabase_auth_admin), so the integration test
-- (tests/integration/otp-login.test.ts) covers the real Auth API.
begin;
\ir _helpers.psql

select plan(24);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647703333333', 'crew');
select tests.create_user('+9647504444444', 'admin');

select has_function(
  'public', 'set_login_password', array['uuid', 'text'], 'set_login_password exists'
);

-- Passwords -----------------------------------------------------------------

select throws_ok(
  $$ update auth.users
     set encrypted_password = extensions.crypt('thief', extensions.gen_salt('bf'))
     where id = tests.user_id('+9647802222222') $$,
  'ZL002', 'password_change_not_allowed',
  'a password change outside set_login_password is refused (PUT /auth/v1/user)'
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
  'clearing a password is allowed'
);

-- B has a session on another device.
insert into auth.sessions (id, user_id, created_at, updated_at)
values (gen_random_uuid(), tests.user_id('+9647802222222'), now(), now());

-- The server sets B's password.
select tests.authenticate_as_service_role();
select lives_ok(
  $$ select public.set_login_password(tests.user_id('+9647802222222'), repeat('k', 43)) $$,
  'the server sets a password'
);
select tests.clear_authentication();

select ok(
  (select encrypted_password = extensions.crypt(repeat('k', 43), encrypted_password)
   from auth.users where id = tests.user_id('+9647802222222')),
  'it is stored as a bcrypt hash of that password'
);

select is(
  (select count(*)::int from auth.sessions where user_id = tests.user_id('+9647802222222')),
  0,
  'and the user is logged out on other devices'
);

select is(
  current_setting('zalal.password_set_for', true),
  '',
  'the mark is cleared afterwards'
);

select throws_ok(
  $$ update auth.users
     set encrypted_password = extensions.crypt('thief', extensions.gen_salt('bf'))
     where id = tests.user_id('+9647802222222') $$,
  'ZL002', 'password_change_not_allowed',
  'right after the server''s set, another write is still refused'
);

-- The mark names one user only (set here by hand, which no client can do in
-- a transaction that writes auth.users).
select set_config('zalal.password_set_for', tests.user_id('+9647703333333')::text, true);
select throws_ok(
  $$ update auth.users
     set encrypted_password = extensions.crypt('thief', extensions.gen_salt('bf'))
     where id = tests.user_id('+9647801111111') $$,
  'ZL002', 'password_change_not_allowed',
  'the mark for one user doesn''t let another''s password change'
);
select set_config('zalal.password_set_for', '', true);

select tests.authenticate_as_service_role();
select throws_ok(
  $$ select public.set_login_password(tests.user_id('+9647801111111'), 'short') $$,
  '22023', 'password_too_short',
  'a weak password is refused'
);
select throws_ok(
  $$ select public.set_login_password(gen_random_uuid(), repeat('k', 43)) $$,
  'P0002', 'user_not_found',
  'an unknown user is refused'
);
select tests.clear_authentication();

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

-- A row that already has an email (made by hand in the dashboard, before
-- this guard): it can still log in, but its email can't change. Set up with
-- triggers off, the way such a row came about.
set local session_replication_role = replica;
update auth.users set email = 'owner@example.com' where id = tests.user_id('+9647703333333');
set local session_replication_role = origin;

select tests.authenticate_as_service_role();
select lives_ok(
  $$ select public.set_login_password(tests.user_id('+9647703333333'), repeat('k', 43)) $$,
  'a row that already has an email can still get its password set'
);
select tests.clear_authentication();

select throws_ok(
  $$ update auth.users set email = 'thief@example.com'
     where id = tests.user_id('+9647703333333') $$,
  'ZL003', 'email_not_allowed',
  'but its email can''t be changed to another'
);

-- Who may set a password ----------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.set_login_password(uuid, text)', 'execute'),
  'a guest cannot set a password'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.set_login_password(tests.user_id('+9647801111111'), repeat('t', 43)) $$,
  '42501', null,
  'a customer cannot set a password, even their own'
);
select tests.clear_authentication();

select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.set_login_password(tests.user_id('+9647703333333'), repeat('t', 43)) $$,
  '42501', null,
  'a crew account cannot set a password'
);
select tests.clear_authentication();

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.set_login_password(tests.user_id('+9647801111111'), repeat('t', 43)) $$,
  '42501', null,
  'an admin cannot set a password either: only the server can'
);
select tests.clear_authentication();

select * from finish();
rollback;
