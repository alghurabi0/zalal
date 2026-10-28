-- Account deletion, phone change, log out on all devices, and subscribed
-- addresses (spec §5.8, N10, N13, §7, §9.1, §9.2, §13; Phase 6, task 3;
-- settled Oct 28, 2026).
--
-- - delete_account(): the caller's own account, customers only (42501
--   otherwise), refused while an order is pending … in progress (ZL039
--   account_has_open_orders). It anonymizes rather than deletes, because
--   orders, certificates and slot history stay as company records:
--   - profiles: no name, no phone, reminders off, deleted_at set;
--   - auth.users: no phone, banned for 100 years ('infinity' doesn't parse
--     in Auth), its sessions, refresh tokens, identities and one-time
--     tokens deleted, so every device is out at once and the phone can sign
--     up again as a new, empty account. Done here rather than through the
--     Auth admin API so it is one transaction; the admin API's own soft
--     delete writes a hashed email, which guard_auth_user refuses;
--   - addresses soft-deleted with the landmark replaced by '-deleted-' and
--     the pin rounded to 2 decimals (about 1 km: area stats, not the house);
--     their tanks deleted, as delete_address does;
--   - orders keep number, dates, slot, tanks, prices, cash and status; their
--     address copy gets the same treatment and the note goes; their
--     order_media rows go (the nightly media-cleanup then deletes the files
--     as unattached);
--   - certificates stay (N15 shows nothing personal and a printed QR keeps
--     working) without their PDF, which prints the name and phone; the paths
--     are returned so the server deletes the files (the certificates bucket
--     is service-role only);
--   - ratings keep their stars and tags, without the comment;
--   - tickets (their files, notes and notifications cascade), the chat
--     thread and every message in it (the nightly cleanup deletes the
--     files), notifications and push subscriptions deleted;
--   - a requested subscription is declined and an active one cancelled
--     (subscriptions_status_check allows cancelled only once activated).
--     Nobody is notified: the customer is gone and A7 lists it as ended.
-- - change_login_phone(user_id, phone): server only (service_role). The
--   server calls it after our own codes proved the current and the new
--   number (spec §9.1; Supabase's phone change is refused by the SMS hook).
--   Customers only: a crew's phone changes in A10, an admin's not in v1.
--   ZL040 phone_taken when another account holds the number.
-- - delete_my_push_subscriptions(): "log out on all devices" in N13 (spec
--   §13 "Push after a session ends") forgets every browser of the caller.
-- - private.guard_subscribed_address: the pin of an address with a requested
--   subscription, or an active one not past its end, can't move (ZL041
--   address_subscribed; spec §13 "Moving a subscribed address"). District
--   and landmark stay editable.
-- - check_address_service_area skips soft-deleted rows, so the rounded pin
--   of a deleted address never fails the area check. Customers can't write
--   deleted_at or update a deleted row, so this opens nothing.
-- - The orders and subscriptions read policies now also need the customer
--   role, so a deleted account's access token (it lives up to an hour after
--   its sessions are gone) reads nothing. Certificates, order lines, events
--   and media read through orders, so they follow.
--
-- Departures from spec §7:
-- - profiles.phone is nullable, but only for a deleted account (check), so
--   a deleted account keeps no phone and the number is free again.
-- - Address and order snapshots of a deleted account are anonymized in
--   place, orders.customer_note and ratings.comment cleared.

-- 1. profiles.phone ----------------------------------------------------------------------------

alter table public.profiles
alter column phone drop not null,
add constraint profiles_phone_or_deleted check (phone is not null or deleted_at is not null);

-- 2. Read policies need the customer role -------------------------------------------------------

alter policy "Customers read their orders; crews their assigned orders; admins all"
on public.orders
using (
  (customer_id = (select auth.uid()) and (select private.current_user_role()) = 'customer')
  or crew_id = (select private.current_crew_id())
  or (select private.is_admin())
);

alter policy "Customers read their subscriptions; admins read all"
on public.subscriptions
using (
  (user_id = (select auth.uid()) and (select private.current_user_role()) = 'customer')
  or (select private.is_admin())
);

-- 3. Addresses: the area check skips deleted rows; subscribed pins stay ------------------------

create or replace function private.check_address_service_area()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deleted_at is null and not public.in_service_area(new.lat, new.lng) then
    raise exception using errcode = 'ZL001', message = 'outside_service_area';
  end if;
  return new;
end;
$$;

-- Security definer: the caller can't read a subscription row of a deleted
-- account or another customer, and the check must see every one.
create function private.guard_subscribed_address()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null
    and (new.lat is distinct from old.lat or new.lng is distinct from old.lng)
    and exists (
      select 1
      from public.subscriptions as s
      where s.address_id = new.id
        and (
          s.status = 'requested'
          or (s.status = 'active' and s.ends_on >= (now() at time zone 'Asia/Baghdad')::date)
        )
    )
  then
    raise exception using errcode = 'ZL041', message = 'address_subscribed';
  end if;
  return new;
end;
$$;

create trigger addresses_guard_subscribed_pin
before update of lat, lng on public.addresses
for each row execute function private.guard_subscribed_address();

-- 4. delete_account() ----------------------------------------------------------------------------

create function public.delete_account()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_pdfs text[];
begin
  if v_user_id is null or (select private.current_user_role()) is distinct from 'customer' then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  -- Lock the profile, so two deletions (or a booking) can't interleave.
  perform 1 from public.profiles as p where p.id = v_user_id for update;

  if exists (
    select 1
    from public.orders as o
    where o.customer_id = v_user_id
      and o.status in ('pending_confirmation', 'confirmed', 'on_the_way', 'arrived', 'in_progress')
  ) then
    raise exception using errcode = 'ZL039', message = 'account_has_open_orders';
  end if;

  -- Subscriptions end before the addresses move, so the pin guard lets go.
  update public.subscriptions as s
  set status = 'declined', ended_at = now()
  where s.user_id = v_user_id and s.status = 'requested';
  update public.subscriptions as s
  set status = 'cancelled', ended_at = now()
  where s.user_id = v_user_id and s.status = 'active';

  -- Chat: messages (they reference tickets), then the thread.
  delete from public.chat_messages as m where m.customer_id = v_user_id;
  delete from public.chat_threads as t where t.user_id = v_user_id;

  -- Tickets; their files, notes and notifications cascade.
  update public.ratings as r
  set ticket_id = null
  where r.ticket_id in (select t.id from public.tickets as t where t.user_id = v_user_id);
  delete from public.tickets as t where t.user_id = v_user_id;

  update public.ratings as r
  set comment = null
  where r.comment is not null
    and r.order_id in (select o.id from public.orders as o where o.customer_id = v_user_id);

  select coalesce(array_agg(c.pdf_path order by c.pdf_path), '{}')
  into v_pdfs
  from public.certificates as c
  join public.orders as o on o.id = c.order_id
  where o.customer_id = v_user_id and c.pdf_path is not null;
  update public.certificates as c
  set pdf_path = null
  from public.orders as o
  where o.id = c.order_id and o.customer_id = v_user_id and c.pdf_path is not null;

  delete from public.order_media as m
  using public.orders as o
  where o.id = m.order_id and o.customer_id = v_user_id;

  update public.orders as o
  set landmark = '-deleted-',
    customer_note = null,
    lat = round(o.lat::numeric, 2)::double precision,
    lng = round(o.lng::numeric, 2)::double precision
  where o.customer_id = v_user_id;

  delete from public.tanks as t where t.user_id = v_user_id;
  update public.addresses as a
  set deleted_at = coalesce(a.deleted_at, now()),
    is_default = false,
    landmark = '-deleted-',
    lat = round(a.lat::numeric, 2)::double precision,
    lng = round(a.lng::numeric, 2)::double precision
  where a.user_id = v_user_id;

  delete from public.notifications as n where n.user_id = v_user_id;
  delete from public.push_subscriptions as s where s.user_id = v_user_id;

  update public.profiles as p
  set deleted_at = now(), full_name = null, phone = null, reminders_enabled = false
  where p.id = v_user_id;

  -- Auth: no phone (the trigger copies null to the profile), banned, and
  -- signed out everywhere.
  update auth.users as u
  set phone = null, phone_confirmed_at = null, phone_change = '', banned_until = now() + interval '100 years'
  where u.id = v_user_id;
  delete from auth.refresh_tokens as r where r.user_id = v_user_id::text;
  delete from auth.sessions as s where s.user_id = v_user_id;
  delete from auth.one_time_tokens as t where t.user_id = v_user_id;
  delete from auth.identities as i where i.user_id = v_user_id;

  return v_pdfs;
end;
$$;

-- 5. change_login_phone(user_id, phone) -------------------------------------------------------

create function public.change_login_phone(p_user_id uuid, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if p_phone is null or p_phone !~ '^\+9647[3-9][0-9]{8}$' then
    raise exception using errcode = '22023', message = 'invalid_phone';
  end if;

  select * into v_profile
  from public.profiles as p
  where p.id = p_user_id and p.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'account_not_found';
  end if;
  if v_profile.role <> 'customer' then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if v_profile.phone = p_phone then
    raise exception using errcode = '22023', message = 'same_phone';
  end if;
  if exists (select 1 from public.profiles as p where p.phone = p_phone)
    or exists (select 1 from auth.users as u where u.phone = ltrim(p_phone, '+'))
  then
    raise exception using errcode = 'ZL040', message = 'phone_taken';
  end if;

  update auth.users as u
  set phone = ltrim(p_phone, '+'), phone_confirmed_at = now(), phone_change = ''
  where u.id = p_user_id;
  update auth.identities as i
  set identity_data = jsonb_set(i.identity_data, '{phone}', to_jsonb(ltrim(p_phone, '+'))),
    updated_at = now()
  where i.user_id = p_user_id and i.provider = 'phone';
end;
$$;

-- 6. delete_my_push_subscriptions() -----------------------------------------------------------

create function public.delete_my_push_subscriptions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  delete from public.push_subscriptions as s where s.user_id = (select auth.uid());
end;
$$;

-- Grants ---------------------------------------------------------------------------------------

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
revoke execute on function public.change_login_phone(uuid, text) from public, anon, authenticated;
grant execute on function public.change_login_phone(uuid, text) to service_role;
revoke execute on function public.delete_my_push_subscriptions() from public, anon;
grant execute on function public.delete_my_push_subscriptions() to authenticated;

revoke execute on all functions in schema private from public;
