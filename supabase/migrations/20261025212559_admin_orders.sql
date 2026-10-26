-- Admin orders (spec §6, §8.2 A2, Phase 3 task 1 part A): crew assignment
-- and the date × slot board.
--
-- - assign_crew(order_id, crew_id): the audited admin RPC for orders.crew_id
--   (spec §7 access rules). Status still changes only through
--   transition_order(); this changes only the crew.
-- - admin_slot_board(from, to): places taken per day and slot, for the A2
--   board and the admin reschedule picker. booking_availability() can't serve
--   admins: it applies the customer window and cutoff, while an admin may
--   reschedule into any slot that hasn't started (bookable_slot with staff
--   rules, as transition_order already does).
--
-- Departures from spec §7: none in the tables. Crew changes are not
-- order_events (events record status changes, and to_status is required);
-- they are in admin_audit_log as 'order.assign_crew' with the old and new
-- crew. New error codes: ZL013 crew_inactive, ZL014 crew_change_not_allowed.

-- assign_crew --------------------------------------------------------------------

-- Sets, changes or (with null) removes the order's crew. The crew must be
-- active with a crew-role account. A crew can be set while the order is
-- pending, confirmed or on the way (to swap a crew that broke down on the
-- way), and removed only while pending or confirmed: an order on the way
-- needs a crew to move on. Setting the same crew again does nothing.
-- Security definer because nobody may update orders directly.
create function public.assign_crew(p_order_id uuid, p_crew_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select * into v_order from public.orders as o where o.id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;

  if p_crew_id is not null then
    -- Held until commit, so a crew switched off meanwhile (A10) can't be
    -- given this order.
    perform 1 from public.crews as c where c.id = p_crew_id for share;
    if not found then
      raise exception using errcode = 'P0002', message = 'crew_not_found';
    end if;
    if not exists (
      select 1
      from public.crews as c
      join public.profiles as p on p.id = c.user_id
      where c.id = p_crew_id and c.active and p.role = 'crew' and p.deleted_at is null
    ) then
      raise exception using errcode = 'ZL013', message = 'crew_inactive';
    end if;
  end if;

  if not (
    v_order.status in ('pending_confirmation', 'confirmed')
    or (v_order.status = 'on_the_way' and p_crew_id is not null)
  ) then
    raise exception using errcode = 'ZL014', message = 'crew_change_not_allowed';
  end if;

  if v_order.crew_id is not distinct from p_crew_id then
    return;
  end if;

  update public.orders as o set crew_id = p_crew_id where o.id = v_order.id;

  perform private.log_admin_action(
    'order.assign_crew', 'orders', v_order.id::text,
    jsonb_build_object('from', v_order.crew_id, 'to', p_crew_id)
  );
end;
$$;

revoke execute on function public.assign_crew(uuid, uuid) from public, anon;
grant execute on function public.assign_crew(uuid, uuid) to authenticated;

-- admin_slot_board ---------------------------------------------------------------------

-- One row per day from p_from to p_to (Baghdad dates, at most 62) and slot
-- that runs that day, plus any slot that still holds places that day
-- (switched off or moved off the weekday since), so no booked order drops
-- off the board. `bookable` means an admin can move an order there: the slot
-- runs that day, the day isn't blocked, it hasn't started and a place is
-- left. Security invoker: admins already read slots, blocked dates and
-- slot_bookings; the check below gives everyone else a clear error instead
-- of an empty board.
create function public.admin_slot_board(p_from date, p_to date)
returns table (
  service_date date,
  slot_id bigint,
  start_at timestamptz,
  end_at timestamptz,
  capacity smallint,
  taken integer,
  blocked boolean,
  bookable boolean
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 61 then
    raise exception using errcode = '22023', message = 'invalid_range';
  end if;

  return query
  with days as (
    select d::date as day
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  ),
  held as (
    select b.service_date, b.slot_id, count(*)::integer as n
    from public.slot_bookings as b
    where b.service_date between p_from and p_to
    group by b.service_date, b.slot_id
  ),
  cells as (
    select
      days.day,
      sl.id,
      sl.start_time,
      sl.end_time,
      sl.capacity,
      sl.active and extract(dow from days.day)::smallint = any (sl.weekdays) as runs,
      coalesce(h.n, 0) as n
    from days
    cross join public.slots as sl
    left join held as h on h.service_date = days.day and h.slot_id = sl.id
    where (sl.active and extract(dow from days.day)::smallint = any (sl.weekdays))
      or h.n is not null
  )
  select
    c.day,
    c.id,
    (c.day + c.start_time) at time zone 'Asia/Baghdad',
    (c.day + c.end_time) at time zone 'Asia/Baghdad',
    c.capacity,
    c.n,
    bd.date is not null,
    c.runs
      and bd.date is null
      and (c.day + c.start_time) at time zone 'Asia/Baghdad' > now()
      and c.n < c.capacity
  from cells as c
  left join public.blocked_dates as bd on bd.date = c.day
  order by c.day, c.start_time, c.id;
end;
$$;

revoke execute on function public.admin_slot_board(date, date) from public, anon;
grant execute on function public.admin_slot_board(date, date) to authenticated;
