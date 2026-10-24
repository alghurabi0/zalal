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
-- - The password changes only inside a window our server opened for that
--   user with allow_password_set() (service role only), right before it sets
--   the password through the Auth admin API. That happens only for users who
--   don't have the derived password yet (the seeded first admin, or after
--   the secret key is rotated). The change uses up the window; it lasts 30
--   seconds. A simpler "set once, never change" rule would lock everyone out
--   when the key is rotated.
-- - Creating a user with a password (the admin API's createUser) and clearing
--   a password (account deletion) need no window.
-- - No email address and no pending email change, ever (v1 has no email).
--   If account deletion (N13, Phase 6) uses the admin API's soft delete and
--   it writes a scrambled email, revisit this rule then.
--
-- Not covered, accepted for v1 (spec §13): a stolen session stays usable
-- until it is refreshed away (there is no "log out on all devices" yet), can
-- edit its own user metadata (nothing reads it; roles come from profiles),
-- and can log its owner out everywhere.
--
-- New: private.password_set_grants, public.allow_password_set(uuid). Not in
-- spec §7 before; added there.

-- Windows ----------------------------------------------------------------------

-- In private: no API role reads or writes it. Only allow_password_set() and
-- the trigger below (both security definer) touch it.
create table private.password_set_grants (
  user_id uuid primary key references auth.users (id) on delete cascade,
  expires_at timestamptz not null
);

alter table private.password_set_grants enable row level security;

revoke all on private.password_set_grants from public, anon, authenticated, service_role;

-- Opens (or renews) a 30-second window in which this user's password may be
-- set. The server calls it with the secret key right before
-- auth.admin.updateUserById(id, { password }). Security definer because no
-- API role may write the table; only service_role may execute it.
create function public.allow_password_set(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.password_set_grants (user_id, expires_at)
  values (p_user_id, now() + interval '30 seconds')
  on conflict (user_id) do update set expires_at = excluded.expires_at;
$$;
-- One row per user at most, renewed each time, so nothing needs purging.

revoke execute on function public.allow_password_set(uuid) from public, anon, authenticated;
grant execute on function public.allow_password_set(uuid) to service_role;

-- Trigger ----------------------------------------------------------------------

-- Supabase Auth writes auth.users as supabase_auth_admin, which may not read
-- the windows, hence security definer.
create function private.guard_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(new.email, '') is not null or nullif(new.email_change, '') is not null then
    raise exception using errcode = 'ZL003', message = 'email_not_allowed';
  end if;

  if tg_op = 'UPDATE'
    and new.encrypted_password is distinct from old.encrypted_password
    and nullif(new.encrypted_password, '') is not null
  then
    delete from private.password_set_grants as g
    where g.user_id = new.id and g.expires_at > now();
    if not found then
      raise exception using errcode = 'ZL002', message = 'password_change_not_allowed';
    end if;
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
