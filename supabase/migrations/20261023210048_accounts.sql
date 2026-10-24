-- Accounts (spec §2, §7): roles, profiles and the helpers RLS policies use.
--
-- Departures from spec §7:
-- - The role is read from profiles on each check (private.current_user_role),
--   not from a JWT claim. A role change (a crew account removed, an admin
--   demoted) applies at once instead of after the next token refresh (up to
--   1 hour). Policies call it as `(select private.…())`, so it runs once per
--   query, not once per row.
-- - profiles.phone copies auth.users.phone in E.164 (Auth stores it without
--   the "+"), so admins can search customers by phone and every account is
--   held to the Iraqi-mobile rule here, whatever path created it.
-- - full_name is null until the Name screen (N1); that is how the app tells a
--   new user from a returning one (spec §5.3 routing).

-- Helpers live in `private`, which the API does not expose (supabase/config.toml
-- [api] schemas), so they can't be called over PostgREST.
create schema private;
grant usage on schema private to authenticated, service_role;
-- Postgres makes every new function executable by PUBLIC, and a per-schema
-- default privilege can't take that away. So each migration that adds
-- private functions ends with `revoke execute on all functions in schema
-- private from public` and grants back only what policies need
-- (tests/database/rls_audit_private_execute.test.sql checks it).

-- Roles ------------------------------------------------------------------

-- An enum, so a `support` role can be added later without a schema rewrite
-- (spec §2).
create type public.app_role as enum ('customer', 'crew', 'admin');

-- Profiles ---------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'customer',
  -- E.164 Iraqi mobile: +964 7[3-9] and 8 more digits (spec §5.2, decision 10).
  phone text not null unique check (phone ~ '^\+9647[3-9][0-9]{8}$'),
  -- 2–40 characters (N1), already trimmed by the app.
  full_name text check (
    full_name is null
    or (char_length(full_name) between 2 and 40 and full_name = btrim(full_name))
  ),
  reminders_enabled boolean not null default true,
  -- Account deletion (N13, Phase 6) soft-deletes and anonymizes.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Shared trigger: keep updated_at current on every table that has one.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

-- Signup: one profile per auth user. Auth stores phones without the "+".
-- A phone that isn't an Iraqi mobile fails the check above, so the signup
-- itself fails, even when someone calls Supabase Auth directly.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, '+' || ltrim(new.phone, '+'));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- Phone change (N10 runs OTP on the new number, then Auth updates the user).
create function private.handle_user_phone_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set phone = '+' || ltrim(new.phone, '+')
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_phone_changed
after update of phone on auth.users
for each row
when (old.phone is distinct from new.phone)
execute function private.handle_user_phone_change();

-- Role helpers -------------------------------------------------------------

-- The caller's role, or null for guests and deleted accounts. Security
-- definer so policies on profiles itself can call it without recursing.
create function private.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.profiles
  where id = (select auth.uid()) and deleted_at is null;
$$;

create function private.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select private.current_user_role()) = 'admin', false);
$$;

revoke execute on all functions in schema private from public;
grant execute on function private.current_user_role() to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;

-- Access ---------------------------------------------------------------------
--
-- Supabase grants every privilege on new public tables to anon and
-- authenticated; start from nothing and grant what each role needs.
-- Column grants keep role, phone and deleted_at server-only. Admin writes
-- (crews A10, admins A14, account deletion N13) come later as RPCs that also
-- write the admin audit log (Phase 3).

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, reminders_enabled) on public.profiles to authenticated;

create policy "Users read their own profile; admins read all"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()) or (select private.is_admin()));

-- A deleted (anonymized) account can't write its name back.
create policy "Users update their own profile"
on public.profiles
for update
to authenticated
using (id = (select auth.uid()) and deleted_at is null)
with check (id = (select auth.uid()) and deleted_at is null);
