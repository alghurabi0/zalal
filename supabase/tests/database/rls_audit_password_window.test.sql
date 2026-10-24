-- RLS audit: the password window is usable by whoever writes next.
--
-- allow_password_set(user) opens a 30 s window keyed only by the user id, and
-- private.guard_auth_user accepts the first password write for that user in
-- the window. Supabase Auth writes auth.users the same way (same role, same
-- UPDATE) for the server's auth.admin.updateUserById and for the user's own
-- PUT /auth/v1/user. So someone holding a stolen session who polls
-- PUT /auth/v1/user { password } while the owner logs in after a key rotation
-- (the only time the server opens a window) consumes the window: their own
-- password is stored, their session survives (GoTrue logs out every other
-- session), and the server's password set fails with ZL002. Reproduced
-- against the local Auth API.
--
-- Safe behavior: the server preparing a password set for a user doesn't let
-- any other password write for that user through. Only the server's own write
-- (for example a service-role RPC that sets the password itself, flagged by a
-- transaction-local setting the trigger checks) may change it.
--
-- Here the thief's write is the plain UPDATE that PUT /auth/v1/user issues.
-- The test runner can't act as supabase_auth_admin, so it runs as postgres,
-- like auth_user_guard.test.sql.
begin;
\ir _helpers.psql

select plan(1);

select tests.create_user('+9647802222222');

-- The server prepares a password set for this user, as the first draft of
-- src/lib/otp/service.ts did. The fix removed allow_password_set(uuid), so
-- this step is skipped and the server now sets passwords inside
-- set_login_password; the test stays to keep the race closed.
select tests.authenticate_as_service_role();
do $$
begin
  if to_regprocedure('public.allow_password_set(uuid)') is not null then
    perform public.allow_password_set(tests.user_id('+9647802222222'));
  end if;
end;
$$;
select tests.clear_authentication();

select throws_ok(
  $$ update auth.users
     set encrypted_password = extensions.crypt('thief', extensions.gen_salt('bf'))
     where id = tests.user_id('+9647802222222') $$,
  'ZL002', 'password_change_not_allowed',
  'a window the server opened cannot be used by a stolen session (PUT /auth/v1/user during the server''s password set)'
);

select * from finish();
rollback;
