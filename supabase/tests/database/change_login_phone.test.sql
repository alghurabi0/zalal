-- Phone change (N10, spec §9.1). change_login_phone(user_id, phone) is
-- server-only (service_role): the server calls it after the user proved both
-- the current and the new number with our own codes.
-- - Sets auth.users.phone (without the "+") and the phone identity; the
--   trigger copies it to profiles.phone.
-- - 22023 invalid_phone (not an Iraqi mobile), 22023 same_phone,
--   P0002 account_not_found (unknown or deleted), 42501 not_allowed (a crew
--   or admin: A10 changes a crew's phone), ZL040 phone_taken (another
--   account, live or not yet deleted, holds it).
-- profiles.phone is null only for a deleted account (23514 otherwise).
begin;
\ir _helpers.psql

select plan(16);

select tests.create_user('+9647801111111');
select tests.create_user('+9647802222222');
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));
insert into auth.identities (provider_id, user_id, identity_data, provider)
values (
  tests.user_id('+9647801111111')::text, tests.user_id('+9647801111111'),
  jsonb_build_object('sub', tests.user_id('+9647801111111'), 'phone', '9647801111111'), 'phone'
);
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Who may call it.
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.change_login_phone(tests.user_id('+9647801111111'), '+9647809999999') $$,
  '42501', null, 'a guest can''t call it'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.change_login_phone(tests.user_id('+9647801111111'), '+9647809999999') $$,
  '42501', null, 'a customer can''t call it directly'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.change_login_phone(tests.user_id('+9647801111111'), '+9647809999999') $$,
  '42501', null, 'an admin can''t call it directly'
);

-- The server.
select tests.authenticate_as_service_role();
select throws_ok(
  $$ select public.change_login_phone(tests.user_id('+9647801111111'), '+9641234') $$,
  '22023', 'invalid_phone', 'a bad number is refused'
);
select throws_ok(
  $$ select public.change_login_phone(tests.user_id('+9647801111111'), '+9647801111111') $$,
  '22023', 'same_phone', 'the same number is refused'
);
select throws_ok(
  $$ select public.change_login_phone(tests.user_id('+9647801111111'), '+9647802222222') $$,
  'ZL040', 'phone_taken', 'another account''s number is refused'
);
select throws_ok(
  $$ select public.change_login_phone(gen_random_uuid(), '+9647809999999') $$,
  'P0002', 'account_not_found', 'an unknown account is refused'
);
select throws_ok(
  $$ select public.change_login_phone(tests.user_id('+9647703333333'), '+9647809999999') $$,
  '42501', 'not_allowed', 'a crew''s phone changes only in A10'
);
select throws_ok(
  $$ select public.change_login_phone(tests.user_id('+9647504444444'), '+9647809999999') $$,
  '42501', 'not_allowed', 'an admin''s phone doesn''t change here'
);

select lives_ok(
  $$ select public.change_login_phone(tests.user_id('+9647801111111'), '+9647809999999') $$,
  'the server changes a customer''s phone'
);
select tests.clear_authentication();
select is(
  (select phone from public.profiles where id = tests.user_id('+9647801111111')),
  '+9647809999999', 'the profile has the new phone'
);
select is(
  (select phone from auth.users where id = tests.user_id('+9647801111111')),
  '9647809999999', 'Auth has the new phone'
);
select is(
  (select identity_data ->> 'phone' from auth.identities where user_id = tests.user_id('+9647801111111')),
  '9647809999999', 'the phone identity has the new phone'
);

-- A deleted account.
update public.profiles set deleted_at = now(), phone = null where id = tests.user_id('+9647802222222');
select tests.authenticate_as_service_role();
select throws_ok(
  $$ select public.change_login_phone(tests.user_id('+9647802222222'), '+9647808888888') $$,
  'P0002', 'account_not_found', 'a deleted account is refused'
);
select tests.clear_authentication();

-- profiles.phone is null only once deleted.
select throws_ok(
  $$ update public.profiles set phone = null where id = tests.user_id('+9647801111111') $$,
  '23514', null, 'a live profile needs a phone'
);
select ok(
  not has_function_privilege('authenticated', 'public.change_login_phone(uuid, text)', 'execute'),
  'authenticated can''t execute change_login_phone'
);

select * from finish();
rollback;
