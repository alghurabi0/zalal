-- Crews and the admin audit log (spec §2, §7, §8).
--
-- Both were planned for Phase 3, but transition_order() (Phase 2) already
-- needs them: crew status changes act on orders.crew_id, and every admin
-- write goes to admin_audit_log (spec §7 access rules). The screens that
-- create crews (A10) and the other audited admin RPCs still come in Phase 3.
--
-- Departures from spec §7:
-- - crews.user_id must be a crew-role account (trigger), and is unique: one
--   login per crew. A crew's account can be swapped later (A10) while its
--   orders keep pointing at the crew.
-- - private.current_crew_id() names the caller's crew, only while the crew is
--   active and the account still has the crew role. Policies use it, so
--   deactivating a crew or demoting its account hides its orders at once.
-- - admin_audit_log.entity_id is text, so one log covers tables keyed by
--   uuid, bigint or (type, size).

-- Crews --------------------------------------------------------------------------

create table public.crews (
  id uuid primary key default gen_random_uuid(),
  -- "فريق 1"
  name text not null unique check (char_length(name) between 2 and 30 and name = btrim(name)),
  user_id uuid not null unique references public.profiles (id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crews enable row level security;

create trigger crews_set_updated_at
before update on public.crews
for each row execute function private.set_updated_at();

-- A crew logs in with a crew-role account. Security definer: the role is
-- read from profiles whoever writes the row.
create function private.check_crew_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles as p
    where p.id = new.user_id and p.role = 'crew' and p.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'crew_account_role';
  end if;
  return new;
end;
$$;

create trigger crews_check_account
before insert or update of user_id on public.crews
for each row execute function private.check_crew_account();

-- The caller's crew, or null. Security definer so policies on crews itself
-- can call it without recursing.
create function private.current_crew_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.crews as c
  where c.user_id = (select auth.uid())
    and c.active
    and (select private.current_user_role()) = 'crew';
$$;

revoke all on public.crews from anon, authenticated;
grant select on public.crews to authenticated;

create policy "Crews read their own crew; admins read all"
on public.crews
for select
to authenticated
using (id = (select private.current_crew_id()) or (select private.is_admin()));

-- Admin audit log ------------------------------------------------------------------

-- Every admin write, written by the database functions that make it (spec §7).
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles (id) on delete restrict,
  -- e.g. 'order.transition'
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)*$' and char_length(action) <= 60),
  entity text not null check (entity ~ '^[a-z_]+$' and char_length(entity) <= 60),
  entity_id text not null check (char_length(entity_id) between 1 and 100),
  diff jsonb not null default '{}' check (jsonb_typeof(diff) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

create index admin_audit_log_entity_entity_id_idx on public.admin_audit_log (entity, entity_id);
create index admin_audit_log_admin_id_idx on public.admin_audit_log (admin_id);
create index admin_audit_log_created_at_idx on public.admin_audit_log (created_at);

-- Called by security definer RPCs, never by users.
create function private.log_admin_action(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_diff jsonb default '{}'
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit_log (admin_id, action, entity, entity_id, diff)
  values ((select auth.uid()), p_action, p_entity, p_entity_id, p_diff);
$$;

revoke all on public.admin_audit_log from anon, authenticated;
revoke all on sequence public.admin_audit_log_id_seq from anon, authenticated;
grant select on public.admin_audit_log to authenticated;

create policy "Admins read the audit log"
on public.admin_audit_log
for select
to authenticated
using ((select private.is_admin()));

revoke execute on all functions in schema private from public;
grant execute on function private.current_crew_id() to authenticated, service_role;
