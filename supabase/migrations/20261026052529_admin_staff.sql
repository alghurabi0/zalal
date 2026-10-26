-- Staff accounts (spec §2, §8.2 A10 and A14, Phase 3 task 1 part C): the
-- audited admin RPCs for crews and admins.
--
-- Accounts are Supabase Auth users, which only the Auth admin API should
-- create (sign-ups are off). So the app server creates the account first,
-- with the phone confirmed and no password (the first login sets it, spec
-- §9.1), then calls these RPCs with the admin's own session. Everything that
-- decides who may become what, and the audit log, is here:
--
-- - admin_create_crew(phone, name): a crew needs an untouched account: a
--   customer that never signed in and has no addresses, tanks or orders.
--   That is an account the server just made (or made for an earlier try
--   that failed), never someone's customer account: a crew phone is shared
--   by a team, so a customer's history must not come with it (ZL019
--   phone_has_account). The account becomes a crew named like the crew.
-- - admin_update_crew(id, name, active): rename, switch on or off. Switching
--   off takes the crew's access away at once (current_crew_id()) and never
--   touches orders: only transition_order() and assign_crew() change orders.
--   It returns the open orders the crew still has, for the admin to
--   reassign in A2 (assign_crew refuses a switched-off crew, ZL013).
-- - admin_set_crew_phone(id, phone): for a lost or replaced crew phone. The
--   crew moves to another untouched account and keeps its orders; the old
--   account goes back to an unnamed customer, which sees nothing.
-- - admin_add_admin(phone, name): any customer account can be made an admin
--   (its own orders and addresses stay); a crew account can't (ZL021
--   account_is_crew). The name is used only when the account has none.
-- - admin_remove_admin(user_id): back to a customer. Nobody removes
--   themselves (ZL022 cannot_remove_self), and the caller is checked again
--   under a lock on every admin row, so two admins removing each other at
--   once can't leave none: the second one waits, then is no longer an admin.
--
-- Departures from spec §7: none in the tables. crews.name is also written to
-- the crew account's profiles.full_name, so the crew app can greet the team.
-- New error codes: ZL019 phone_has_account, ZL020 crew_name_taken, ZL021
-- account_is_crew, ZL022 cannot_remove_self.

-- Helpers ------------------------------------------------------------------------

-- True for an account nobody has used: a customer that never signed in and
-- owns nothing. Security definer: reads auth.users.
create function private.is_untouched_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from public.profiles as p
      join auth.users as u on u.id = p.id
      where p.id = p_user_id
        and p.role = 'customer'
        and p.deleted_at is null
        and u.last_sign_in_at is null
    )
    and not exists (select 1 from public.addresses as a where a.user_id = p_user_id)
    and not exists (select 1 from public.tanks as t where t.user_id = p_user_id)
    and not exists (select 1 from public.orders as o where o.customer_id = p_user_id);
$$;

-- The live account with this phone, locked until commit, so two admins
-- acting on the same phone take turns. 22023 for a malformed phone (the
-- app's Zod schema refuses it first), P0002 when there is no live account.
create function private.lock_account(p_phone text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.profiles;
begin
  if p_phone is null or p_phone !~ '^\+9647[3-9][0-9]{8}$' then
    raise exception using errcode = '22023', message = 'invalid_phone';
  end if;
  select * into v_account
  from public.profiles as p
  where p.phone = p_phone and p.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'account_not_found';
  end if;
  return v_account;
end;
$$;

-- Open orders: from booked to in progress.
create function private.crew_open_orders(p_crew_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.orders as o
  where o.crew_id = p_crew_id
    and o.status in ('pending_confirmation', 'confirmed', 'on_the_way', 'arrived', 'in_progress');
$$;

-- admin_create_crew ------------------------------------------------------------------

create function public.admin_create_crew(p_phone text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.profiles;
  v_crew_id uuid;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  v_account := private.lock_account(p_phone);
  if not private.is_untouched_account(v_account.id) then
    raise exception using errcode = 'ZL019', message = 'phone_has_account';
  end if;
  if exists (select 1 from public.crews as c where c.name = p_name) then
    raise exception using errcode = 'ZL020', message = 'crew_name_taken';
  end if;

  update public.profiles as p
  set role = 'crew', full_name = p_name
  where p.id = v_account.id;

  begin
    insert into public.crews (name, user_id)
    values (p_name, v_account.id)
    returning id into v_crew_id;
  exception when unique_violation then
    -- Another admin took the name a moment ago.
    raise exception using errcode = 'ZL020', message = 'crew_name_taken';
  end;

  perform private.log_admin_action(
    'crew.create', 'crews', v_crew_id::text,
    jsonb_build_object('name', p_name, 'phone', v_account.phone)
  );
  return v_crew_id;
end;
$$;

-- admin_update_crew ------------------------------------------------------------------

create function public.admin_update_crew(p_crew_id uuid, p_name text, p_active boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.crews;
  v_diff jsonb := '{}';
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  -- Waits for an assign_crew() holding this crew, and holds it off.
  select * into v_old from public.crews as c where c.id = p_crew_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'crew_not_found';
  end if;

  if v_old.name is distinct from p_name then
    if exists (select 1 from public.crews as c where c.name = p_name and c.id <> p_crew_id) then
      raise exception using errcode = 'ZL020', message = 'crew_name_taken';
    end if;
    v_diff := v_diff || jsonb_build_object('name', jsonb_build_object('from', v_old.name, 'to', p_name));
  end if;
  if v_old.active is distinct from p_active then
    v_diff := v_diff || jsonb_build_object('active', jsonb_build_object('from', v_old.active, 'to', p_active));
  end if;

  if v_diff <> '{}' then
    begin
      update public.crews as c
      set name = p_name, active = p_active
      where c.id = p_crew_id;
    exception when unique_violation then
      raise exception using errcode = 'ZL020', message = 'crew_name_taken';
    end;
    if v_diff ? 'name' then
      update public.profiles as p set full_name = p_name where p.id = v_old.user_id;
    end if;
    perform private.log_admin_action('crew.update', 'crews', p_crew_id::text, v_diff);
  end if;

  return private.crew_open_orders(p_crew_id);
end;
$$;

-- admin_set_crew_phone -----------------------------------------------------------------

create function public.admin_set_crew_phone(p_crew_id uuid, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crew public.crews;
  v_old_phone text;
  v_account public.profiles;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select * into v_crew from public.crews as c where c.id = p_crew_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'crew_not_found';
  end if;
  select p.phone into v_old_phone from public.profiles as p where p.id = v_crew.user_id;
  if v_old_phone = p_phone then
    return;
  end if;

  -- Both accounts, in id order, so two moves between the same two phones
  -- wait for each other instead of deadlocking.
  perform 1
  from public.profiles as p
  where p.id = v_crew.user_id or p.phone = p_phone
  order by p.id
  for update;
  v_account := private.lock_account(p_phone);
  if not private.is_untouched_account(v_account.id) then
    raise exception using errcode = 'ZL019', message = 'phone_has_account';
  end if;

  -- The new account is a crew before the crew points at it (the
  -- crews_check_account trigger checks the role).
  update public.profiles as p
  set role = 'crew', full_name = v_crew.name
  where p.id = v_account.id;
  update public.crews as c set user_id = v_account.id where c.id = p_crew_id;
  update public.profiles as p
  set role = 'customer', full_name = null
  where p.id = v_crew.user_id;

  perform private.log_admin_action(
    'crew.phone', 'crews', p_crew_id::text,
    jsonb_build_object('from', v_old_phone, 'to', v_account.phone)
  );
end;
$$;

-- admin_add_admin ---------------------------------------------------------------------

create function public.admin_add_admin(p_phone text, p_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.profiles;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  v_account := private.lock_account(p_phone);
  if v_account.role = 'admin' then
    return false;
  end if;
  if v_account.role = 'crew' then
    raise exception using errcode = 'ZL021', message = 'account_is_crew';
  end if;

  v_diff := jsonb_build_object(
    'phone', v_account.phone,
    'role', jsonb_build_object('from', v_account.role, 'to', 'admin')
  );
  if v_account.full_name is null and p_name is not null then
    v_diff := v_diff || jsonb_build_object('full_name', jsonb_build_object('from', null, 'to', p_name));
  end if;

  update public.profiles as p
  set role = 'admin', full_name = coalesce(p.full_name, p_name)
  where p.id = v_account.id;

  perform private.log_admin_action('admin.add', 'profiles', v_account.id::text, v_diff);
  return true;
end;
$$;

-- admin_remove_admin ------------------------------------------------------------------

create function public.admin_remove_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception using errcode = 'ZL022', message = 'cannot_remove_self';
  end if;

  -- Every admin row, in one order, so removals take turns. Then the caller
  -- again: an admin removed by someone else meanwhile can't go on, so the
  -- caller always remains an admin and there is never none.
  perform 1 from public.profiles as p where p.role = 'admin' order by p.id for update;
  if not exists (
    select 1 from public.profiles as p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select * into v_target from public.profiles as p where p.id = p_user_id and p.role = 'admin';
  if not found then
    raise exception using errcode = 'P0002', message = 'admin_not_found';
  end if;

  update public.profiles as p set role = 'customer' where p.id = p_user_id;

  perform private.log_admin_action(
    'admin.remove', 'profiles', p_user_id::text,
    jsonb_build_object('phone', v_target.phone, 'role', jsonb_build_object('from', 'admin', 'to', 'customer'))
  );
end;
$$;

-- Access ------------------------------------------------------------------------------

revoke execute on function public.admin_create_crew(text, text) from public, anon;
grant execute on function public.admin_create_crew(text, text) to authenticated;
revoke execute on function public.admin_update_crew(uuid, text, boolean) from public, anon;
grant execute on function public.admin_update_crew(uuid, text, boolean) to authenticated;
revoke execute on function public.admin_set_crew_phone(uuid, text) from public, anon;
grant execute on function public.admin_set_crew_phone(uuid, text) to authenticated;
revoke execute on function public.admin_add_admin(text, text) from public, anon;
grant execute on function public.admin_add_admin(text, text) to authenticated;
revoke execute on function public.admin_remove_admin(uuid) from public, anon;
grant execute on function public.admin_remove_admin(uuid) to authenticated;

-- The helpers run only inside the RPCs above (as their owner).
revoke execute on all functions in schema private from public;
