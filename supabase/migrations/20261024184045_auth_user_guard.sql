-- Guard on auth.users: a stolen session can't add a second way in (spec
-- §9.1; §13 "Auth gaps for a stolen session", settled Oct 24, 2026).
--
-- Login is our server's job: it checks the phone code, then signs in with a
-- password only it can derive (an HMAC of the user id). But Supabase Auth's
-- own API lets any logged-in user call PUT /auth/v1/user, so someone holding
-- a stolen session could:
-- - set their own password, then sign in with it without any code;
-- - attach an email address, which becomes another way to log in.
-- This trigger refuses both, whoever writes auth.users:
-- - A password changes only inside set_login_password(), the server-only RPC
--   that sets it. The RPC marks its own transaction (a transaction-local
--   setting holding the user id) and the trigger accepts a new password only
--   when that mark names the user. Nothing outside that transaction can set
--   the mark: Supabase Auth and PostgREST never let clients set settings,
--   and only service_role may run the RPC. An earlier draft let the server
--   open a short window and then call the Auth admin API; the RLS audit
--   showed a stolen session could race that window with its own
--   PUT /auth/v1/user, because Auth writes both the same way.
-- - The server sets a password only for users who don't have the derived one
--   yet (the seeded first admin, or everyone once after the secret key is
--   rotated). Like the Auth admin API did, it then logs the user out on
--   their other devices, which after a rotation is what we want.
-- - Creating a user with a password (the admin API's createUser) and clearing
--   a password need no mark.
-- - No new email address and no new pending email change (v1 has no
--   email). A row that already has an email keeps working.
--   The Auth admin API's soft delete writes a hashed value into email and
--   email_change, so it is refused too; account deletion (N13, Phase 6) must
--   revisit this rule or delete through its own RPC.
-- - If Auth's database password encryption (GOTRUE_SECURITY_DB_ENCRYPTION_*)
--   is ever turned on, Auth re-encrypts the hash on sign-in and this trigger
--   would refuse that write. It is off, and nothing here needs it.
--
-- Not covered, accepted for v1 (spec §13): a stolen session stays usable
-- until it is refreshed away (there is no "log out on all devices" yet), can
-- edit its own user metadata (nothing reads it; roles come from profiles),
-- and can log its owner out everywhere.
--
-- New: public.set_login_password(uuid, text). Not in spec §7 before; added
-- there.

-- The server's password set ---------------------------------------------------

-- Sets the user's sign-in password (bcrypt, as Auth stores it) and ends
-- their sessions. The server calls it with the secret key when signing in
-- with the derived password fails. Security definer because no API role may
-- write auth.users; only service_role may execute it.
create function public.set_login_password(p_user_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The derived password is 43 characters; refuse anything weak by mistake.
  if char_length(coalesce(p_password, '')) < 32 then
    raise exception using errcode = '22023', message = 'password_too_short';
  end if;

  perform set_config('zalal.password_set_for', p_user_id::text, true);

  update auth.users as u
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
      updated_at = now()
  where u.id = p_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'user_not_found';
  end if;

  -- Log out everywhere (refresh tokens go with their sessions).
  delete from auth.sessions as s where s.user_id = p_user_id;

  perform set_config('zalal.password_set_for', '', true);
end;
$$;

revoke execute on function public.set_login_password(uuid, text) from public, anon, authenticated;
grant execute on function public.set_login_password(uuid, text) to service_role;

-- Trigger ----------------------------------------------------------------------

create function private.guard_auth_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only a new email counts: a row that already has one (say, an account
  -- made by hand in the dashboard) can still have its password set.
  if (tg_op = 'INSERT' and (nullif(new.email, '') is not null or nullif(new.email_change, '') is not null))
    or (tg_op = 'UPDATE' and (
      (new.email is distinct from old.email and nullif(new.email, '') is not null)
      or (new.email_change is distinct from old.email_change and nullif(new.email_change, '') is not null)
    ))
  then
    raise exception using errcode = 'ZL003', message = 'email_not_allowed';
  end if;

  if tg_op = 'UPDATE'
    and new.encrypted_password is distinct from old.encrypted_password
    and nullif(new.encrypted_password, '') is not null
    and coalesce(current_setting('zalal.password_set_for', true), '') <> new.id::text
  then
    raise exception using errcode = 'ZL002', message = 'password_change_not_allowed';
  end if;

  return new;
end;
$$;

create trigger guard_auth_user
before insert or update of encrypted_password, email, email_change on auth.users
for each row execute function private.guard_auth_user();

-- Trigger functions need no EXECUTE grant to fire. (Revoking from PUBLIC
-- leaves the grants earlier migrations made to named roles.)
revoke execute on all functions in schema private from public;
