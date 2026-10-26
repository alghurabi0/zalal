-- Admin writes for prices, slots and blocked dates (spec §8.2 A8, A9, §7;
-- Phase 3 task 1 part B). Until now admins only read these tables and the
-- owner changed them with SQL. Every write is a security definer RPC that
-- checks the role (42501 otherwise) and logs to admin_audit_log; table
-- grants don't change, so nobody writes the tables directly.
--
-- - admin_update_prices(prices): the A8 grid, all six cells in one call.
--   Only changed cells are written and logged ('price.update', one row per
--   cell). Booked orders keep their snapshot prices (order_items).
-- - admin_create_slot(start, end, capacity, weekdays) /
--   admin_update_slot(id, capacity, weekdays, active): a slot's times are
--   fixed once it exists (settled with the owner, Oct 26, 2026). Orders copy
--   the slot's start and end, so changing them would show one time on the
--   board and another on the customer's order; the admin adds a new slot
--   and switches the old one off instead. Slots are never deleted.
-- - admin_block_date(date, reason) / admin_unblock_date(date).
-- - admin_schedule_conflicts(): booked orders that no longer fit the
--   schedule. None of the writes above touch orders: a lowered capacity, a
--   switched-off slot, a dropped weekday or a blocked day leaves existing
--   bookings in place (spec §6, §7: seat <= capacity is checked by the
--   booking functions, not a constraint). A9 lists these orders so the admin
--   reschedules them by hand.
--
-- Departures from spec §7: none in the tables. New error code: ZL015
-- slot_exists (two slots with the same times; the table's unique key is the
-- backstop).

-- Prices ---------------------------------------------------------------------------

-- p_prices: [{"tank_type": "roof"|"ground", "size": "s"|"m"|"l",
-- "price_iqd": n}, …], each cell at most once. Returns how many changed.
create function public.admin_update_prices(p_prices jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cell jsonb;
  v_key text;
  v_seen text[] := '{}';
  v_type public.tank_type;
  v_size public.tank_size;
  v_price integer;
  v_old integer;
  v_changed integer := 0;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  if p_prices is null or jsonb_typeof(p_prices) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_prices';
  end if;

  -- The whole list is checked before anything is written.
  for v_cell in select e.value from jsonb_array_elements(p_prices) as e loop
    v_key := (v_cell ->> 'tank_type') || '/' || (v_cell ->> 'size');
    if jsonb_typeof(v_cell) <> 'object'
      or coalesce(v_cell ->> 'tank_type', '') not in ('roof', 'ground')
      or coalesce(v_cell ->> 'size', '') not in ('s', 'm', 'l')
      or coalesce(jsonb_typeof(v_cell -> 'price_iqd'), '') <> 'number'
      or (v_cell ->> 'price_iqd') !~ '^-?[0-9]{1,9}$'
      or v_key = any (v_seen)
    then
      raise exception using errcode = '22023', message = 'invalid_prices';
    end if;
    v_seen := v_seen || v_key;
  end loop;

  for v_cell in select e.value from jsonb_array_elements(p_prices) as e loop
    v_type := (v_cell ->> 'tank_type')::public.tank_type;
    v_size := (v_cell ->> 'size')::public.tank_size;
    v_price := (v_cell ->> 'price_iqd')::integer;

    select p.price_iqd into v_old
    from public.price_list as p
    where p.tank_type = v_type and p.size = v_size
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'price_not_found';
    end if;

    if v_old <> v_price then
      update public.price_list as p
      set price_iqd = v_price
      where p.tank_type = v_type and p.size = v_size;

      perform private.log_admin_action(
        'price.update', 'price_list', v_type || '/' || v_size,
        jsonb_build_object('from', v_old, 'to', v_price)
      );
      v_changed := v_changed + 1;
    end if;
  end loop;

  return v_changed;
end;
$$;

revoke execute on function public.admin_update_prices(jsonb) from public, anon;
grant execute on function public.admin_update_prices(jsonb) to authenticated;

-- Slots ---------------------------------------------------------------------------------

-- Weekdays as stored: each day once, in order (0 = Sunday … 6 = Saturday).
-- The table's check refuses days outside 0-6 and an empty list.
create function private.normalize_weekdays(p_weekdays integer[])
returns smallint[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(d order by d), '{}')::smallint[]
  from (select distinct unnest(p_weekdays) as d) as days;
$$;

-- A new, active slot. Returns its id.
create function public.admin_create_slot(
  p_start_time time,
  p_end_time time,
  p_capacity integer,
  p_weekdays integer[]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot public.slots;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  if exists (
    select 1 from public.slots as s where s.start_time = p_start_time and s.end_time = p_end_time
  ) then
    raise exception using errcode = 'ZL015', message = 'slot_exists';
  end if;

  begin
    insert into public.slots (start_time, end_time, capacity, weekdays)
    values (p_start_time, p_end_time, p_capacity, private.normalize_weekdays(p_weekdays))
    returning * into v_slot;
  exception when unique_violation then
    -- Another admin added the same times at the same moment.
    raise exception using errcode = 'ZL015', message = 'slot_exists';
  end;

  perform private.log_admin_action(
    'slot.create', 'slots', v_slot.id::text,
    jsonb_build_object(
      'start_time', v_slot.start_time, 'end_time', v_slot.end_time,
      'capacity', v_slot.capacity, 'weekdays', to_jsonb(v_slot.weekdays)
    )
  );

  return v_slot.id;
end;
$$;

-- Capacity, weekdays and on/off. Existing bookings stay as they are.
create function public.admin_update_slot(
  p_slot_id bigint,
  p_capacity integer,
  p_weekdays integer[],
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.slots;
  v_weekdays smallint[] := private.normalize_weekdays(p_weekdays);
  v_diff jsonb := '{}';
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select * into v_old from public.slots as s where s.id = p_slot_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'slot_not_found';
  end if;

  if v_old.capacity is distinct from p_capacity then
    v_diff := v_diff || jsonb_build_object(
      'capacity', jsonb_build_object('from', v_old.capacity, 'to', p_capacity)
    );
  end if;
  if v_old.weekdays is distinct from v_weekdays then
    v_diff := v_diff || jsonb_build_object(
      'weekdays', jsonb_build_object('from', to_jsonb(v_old.weekdays), 'to', to_jsonb(v_weekdays))
    );
  end if;
  if v_old.active is distinct from p_active then
    v_diff := v_diff || jsonb_build_object(
      'active', jsonb_build_object('from', v_old.active, 'to', p_active)
    );
  end if;

  if v_diff = '{}' then
    return;
  end if;

  update public.slots as s
  set capacity = p_capacity, weekdays = v_weekdays, active = p_active
  where s.id = p_slot_id;

  perform private.log_admin_action('slot.update', 'slots', p_slot_id::text, v_diff);
end;
$$;

revoke execute on function public.admin_create_slot(time, time, integer, integer[]) from public, anon;
grant execute on function public.admin_create_slot(time, time, integer, integer[]) to authenticated;
revoke execute on function public.admin_update_slot(bigint, integer, integer[], boolean) from public, anon;
grant execute on function public.admin_update_slot(bigint, integer, integer[], boolean) to authenticated;

-- Blocked dates -------------------------------------------------------------------------

-- Blocks a day from today (Baghdad) on, or changes the reason of a blocked
-- day. The reason is optional (null).
create function public.admin_block_date(p_date date, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.blocked_dates;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  if p_date is null or p_date < private.baghdad_today() then
    raise exception using errcode = '22023', message = 'date_in_past';
  end if;

  select * into v_old from public.blocked_dates as b where b.date = p_date for update;

  if not found then
    insert into public.blocked_dates (date, reason) values (p_date, p_reason);
    perform private.log_admin_action(
      'blocked_date.add', 'blocked_dates', p_date::text, jsonb_build_object('reason', p_reason)
    );
  elsif v_old.reason is distinct from p_reason then
    update public.blocked_dates as b set reason = p_reason where b.date = p_date;
    perform private.log_admin_action(
      'blocked_date.update', 'blocked_dates', p_date::text,
      jsonb_build_object('reason', jsonb_build_object('from', v_old.reason, 'to', p_reason))
    );
  end if;
end;
$$;

create function public.admin_unblock_date(p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  delete from public.blocked_dates as b where b.date = p_date returning b.reason into v_reason;
  if not found then
    raise exception using errcode = 'P0002', message = 'blocked_date_not_found';
  end if;

  perform private.log_admin_action(
    'blocked_date.remove', 'blocked_dates', p_date::text, jsonb_build_object('reason', v_reason)
  );
end;
$$;

revoke execute on function public.admin_block_date(date, text) from public, anon;
grant execute on function public.admin_block_date(date, text) to authenticated;
revoke execute on function public.admin_unblock_date(date) from public, anon;
grant execute on function public.admin_unblock_date(date) to authenticated;

-- Schedule conflicts ----------------------------------------------------------------------

-- Pending and confirmed orders whose slot hasn't started but whose place no
-- longer fits the schedule, with the first reason that applies: 'blocked'
-- (the day), 'slot_off', 'weekday' (the slot no longer runs that day), or
-- 'over_capacity' (more orders than places that day; the orders past the
-- capacity by seat). Security invoker: admins already read orders, slots,
-- blocked dates and slot_bookings; the check gives everyone else a clear
-- error instead of an empty list.
create function public.admin_schedule_conflicts()
returns table (
  order_id uuid,
  number bigint,
  service_date date,
  slot_id bigint,
  slot_start_at timestamptz,
  status public.order_status,
  reason text
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  return query
  with held as (
    select
      b.order_id,
      b.service_date,
      b.slot_id,
      row_number() over (partition by b.service_date, b.slot_id order by b.seat) as place
    from public.slot_bookings as b
    where b.service_date >= (now() at time zone 'Asia/Baghdad')::date
  ),
  checked as (
    select
      o.id,
      o.number,
      o.service_date,
      o.slot_id,
      o.slot_start_at,
      o.status,
      case
        when bd.date is not null then 'blocked'
        when not s.active then 'slot_off'
        when not (extract(dow from h.service_date)::smallint = any (s.weekdays)) then 'weekday'
        when h.place > s.capacity then 'over_capacity'
      end as why
    from held as h
    join public.orders as o on o.id = h.order_id
    join public.slots as s on s.id = h.slot_id
    left join public.blocked_dates as bd on bd.date = h.service_date
    where o.status in ('pending_confirmation', 'confirmed')
      and o.slot_start_at > now()
  )
  select c.id, c.number, c.service_date, c.slot_id, c.slot_start_at, c.status, c.why
  from checked as c
  where c.why is not null
  order by c.slot_start_at, c.number;
end;
$$;

revoke execute on function public.admin_schedule_conflicts() from public, anon;
grant execute on function public.admin_schedule_conflicts() to authenticated;

revoke execute on all functions in schema private from public;
