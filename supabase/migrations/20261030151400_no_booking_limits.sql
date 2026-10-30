-- No booking window and no tank limits (spec §0 #24, §5.9, §6, §7; settled
-- with the owner on Oct 30, 2026).
--
-- - Customers may book any future day. private.bookable_slot() no longer
--   checks booking_window_days; the past, blocked dates, inactive slots,
--   wrong weekdays, full slots and the cancel_cutoff_hours cutoff still
--   apply. "Any day" still means one the app can show: infinity and years
--   past 9999 are ZL004 for everyone (RLS audit: such a date makes the
--   app's date formatting throw on staff and customer screens).
-- - booking_availability(from, to) lists any range of up to 62 days (a month
--   in Booking's calendar), never before today; 22023 invalid_range for a
--   longer range or only one end. Without dates it lists Booking's row of
--   days, today plus 13 (the old default window), so the app deployed before
--   this migration keeps working.
-- - An order takes any number of tanks: create_order() drops the
--   max_tanks_per_order check (ZL007 too_many_tanks is no longer raised),
--   and order_items.qty loses its 1–20 cap. What a column can hold is the
--   only bound on quantities (22023 invalid_items, also for a line or total
--   beyond an integer). Lines (distinct tanks) stay at most 50 per order
--   (22023 invalid_items): the old tank limit also capped them, and each
--   line can save a tank (RLS audit: 5,000 lines in one call).
-- - A subscription covers any number of tanks: subscriptions.tanks_covered
--   and settings.subscription_tanks lose their 1–6 cap, and
--   admin_activate_subscription() no longer reads max_tanks_per_order.
--
-- Departure from §7: settings.booking_window_days and max_tanks_per_order
-- stay as columns, unused, because the app deployed before this migration
-- still reads them until the new app is live (docs/deploy-setup.md: the
-- migration runs first). A later migration drops them.

-- Constraints ------------------------------------------------------------------------------

alter table public.order_items drop constraint order_items_qty_check;
alter table public.order_items add constraint order_items_qty_check check (qty >= 1);

alter table public.subscriptions drop constraint subscriptions_tanks_covered_check;
alter table public.subscriptions add constraint subscriptions_tanks_covered_check
check (tanks_covered >= 1);

alter table public.settings drop constraint settings_subscription_tanks_check;
alter table public.settings add constraint settings_subscription_tanks_check
check (subscription_tanks >= 1);

comment on column public.settings.booking_window_days is
  'Unused since migration no_booking_limits; dropped later.';
comment on column public.settings.max_tanks_per_order is
  'Unused since migration no_booking_limits; dropped later.';

-- bookable_slot: no window ------------------------------------------------------------------

-- The slot, if it can take a booking that day; otherwise ZL004. Customers
-- book any future day at least cancel_cutoff_hours ahead; staff (an admin
-- rescheduling) only need a slot that hasn't started.
create or replace function private.bookable_slot(
  p_service_date date,
  p_slot_id bigint,
  p_customer_rules boolean
)
returns public.slots
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cutoff_hours smallint;
  v_slot public.slots;
  v_start timestamptz;
begin
  select st.cancel_cutoff_hours into v_cutoff_hours from public.settings as st;
  select * into v_slot from public.slots as s where s.id = p_slot_id and s.active;

  if not found
    or p_service_date is null
    or not isfinite(p_service_date)
    or p_service_date > date '9999-12-31'
    or not (extract(dow from p_service_date)::smallint = any (v_slot.weekdays))
    or exists (select 1 from public.blocked_dates as b where b.date = p_service_date)
  then
    raise exception using errcode = 'ZL004', message = 'slot_unavailable';
  end if;

  v_start := (p_service_date + v_slot.start_time) at time zone 'Asia/Baghdad';

  if p_customer_rules then
    if p_service_date < private.baghdad_today()
      or v_start < now() + make_interval(hours => v_cutoff_hours)
    then
      raise exception using errcode = 'ZL004', message = 'slot_unavailable';
    end if;
  elsif v_start <= now() then
    raise exception using errcode = 'ZL004', message = 'slot_unavailable';
  end if;

  return v_slot;
end;
$$;

-- booking_availability(from, to) -------------------------------------------------------------

drop function public.booking_availability();

-- One row per day and slot from p_from to p_to (or Booking's row of days,
-- today plus 13, without dates), for active slots on their weekdays, leaving
-- out blocked dates and days before today.
create function public.booking_availability(p_from date default null, p_to date default null)
returns table (
  service_date date,
  slot_id bigint,
  start_at timestamptz,
  end_at timestamptz,
  capacity smallint,
  remaining integer,
  bookable boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.baghdad_today();
  v_from date := p_from;
  v_to date := p_to;
begin
  if (v_from is null) <> (v_to is null)
    or not isfinite(v_from)
    or not isfinite(v_to)
    or v_to - v_from >= 62
  then
    raise exception using errcode = '22023', message = 'invalid_range';
  end if;
  if v_from is null then
    v_from := v_today;
    v_to := v_today + 13;
  end if;
  v_from := greatest(v_from, v_today);

  return query
  with day_slots as (
    select
      d.day,
      sl.id as slot_id,
      (d.day + sl.start_time) at time zone 'Asia/Baghdad' as start_at,
      (d.day + sl.end_time) at time zone 'Asia/Baghdad' as end_at,
      sl.capacity,
      (
        select count(*)::integer from public.slot_bookings as b
        where b.service_date = d.day and b.slot_id = sl.id
      ) as taken
    from generate_series(v_from, v_to, interval '1 day') as g(ts)
    cross join lateral (select g.ts::date as day) as d
    join public.slots as sl
      on sl.active and extract(dow from d.day)::smallint = any (sl.weekdays)
    where not exists (select 1 from public.blocked_dates as bd where bd.date = d.day)
  )
  select
    ds.day,
    ds.slot_id,
    ds.start_at,
    ds.end_at,
    ds.capacity,
    greatest(ds.capacity - ds.taken, 0),
    ds.capacity > ds.taken
      and ds.start_at >= now() + make_interval(
        hours => (select st.cancel_cutoff_hours from public.settings as st)
      )
  from day_slots as ds
  order by ds.day, ds.start_at;
end;
$$;

revoke execute on function public.booking_availability(date, date) from public, anon;
grant execute on function public.booking_availability(date, date) to authenticated;

-- create_order: no tank limit -----------------------------------------------------------------

create or replace function public.create_order(
  p_request_id uuid,
  p_address_id uuid,
  p_service_date date,
  p_slot_id bigint,
  p_items jsonb,
  p_note text default null,
  p_media jsonb default '[]',
  p_expected_total integer default null,
  p_use_subscription boolean default false,
  out order_id uuid,
  out order_number bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_address public.addresses;
  v_slot public.slots;
  v_item jsonb;
  v_tank_id uuid;
  v_type public.tank_type;
  v_size public.tank_size;
  v_qty integer;
  v_price integer;
  v_tank_ids uuid[] := '{}';
  v_types public.tank_type[] := '{}';
  v_sizes public.tank_size[] := '{}';
  v_qtys integer[] := '{}';
  v_prices integer[] := '{}';
  v_total bigint := 0;
  v_tank_count integer := 0;
  v_order_id uuid;
  v_number bigint;
  v_file jsonb;
  v_metadata jsonb;
  v_media_type public.media_type;
  v_subscription_id uuid;
begin
  if v_user_id is null or (select private.current_user_role()) is distinct from 'customer' then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  -- A retry returns the order the first request made.
  select o.id, o.number into v_order_id, v_number
  from public.orders as o
  where o.customer_id = v_user_id and o.client_request_id = p_request_id;
  if found then
    order_id := v_order_id;
    order_number := v_number;
    return;
  end if;

  -- Address: the caller's, live, and still inside the service area. The
  -- share lock makes a delete_address() at the same moment wait for this
  -- booking, and then refuse (address_in_use).
  select * into v_address
  from public.addresses as a
  where a.id = p_address_id and a.user_id = v_user_id and a.deleted_at is null
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'address_not_found';
  end if;
  if not public.in_service_area(v_address.lat, v_address.lng) then
    raise exception using errcode = 'ZL001', message = 'outside_service_area';
  end if;

  v_slot := private.bookable_slot(p_service_date, p_slot_id, true);

  -- Lines: checked and priced before anything is written.
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 50
  then
    raise exception using errcode = '22023', message = 'invalid_items';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_items) as e loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item ->> 'qty', '') !~ '^[0-9]{1,5}$' then
      raise exception using errcode = '22023', message = 'invalid_items';
    end if;
    v_qty := (v_item ->> 'qty')::integer;
    -- Any number of tanks; only what order_items.qty (smallint) can hold.
    if v_qty not between 1 and 32767 then
      raise exception using errcode = '22023', message = 'invalid_items';
    end if;
    v_tank_count := v_tank_count + v_qty;

    if v_item ? 'tank_id' then
      v_tank_id := (v_item ->> 'tank_id')::uuid;
      if v_tank_id = any (v_tank_ids) then
        raise exception using errcode = '22023', message = 'duplicate_tank';
      end if;
      select t.type, t.size into v_type, v_size
      from public.tanks as t
      where t.id = v_tank_id and t.user_id = v_user_id and t.address_id = v_address.id;
      if not found then
        raise exception using errcode = 'P0002', message = 'tank_not_found';
      end if;
    else
      if coalesce(v_item ->> 'tank_type', '') not in ('roof', 'ground')
        or coalesce(v_item ->> 'size', '') not in ('s', 'm', 'l')
      then
        raise exception using errcode = '22023', message = 'invalid_items';
      end if;
      v_tank_id := null;
      v_type := (v_item ->> 'tank_type')::public.tank_type;
      v_size := (v_item ->> 'size')::public.tank_size;
    end if;

    select p.price_iqd into v_price
    from public.price_list as p
    where p.tank_type = v_type and p.size = v_size;
    if not found then
      raise exception using errcode = 'P0002', message = 'price_not_found';
    end if;

    v_tank_ids := v_tank_ids || v_tank_id;
    v_types := v_types || v_type;
    v_sizes := v_sizes || v_size;
    v_qtys := v_qtys || v_qty;
    v_prices := v_prices || v_price;
    v_total := v_total + v_qty::bigint * v_price;
    -- orders.total_iqd is an integer.
    if v_total > 2147483647 then
      raise exception using errcode = '22023', message = 'invalid_items';
    end if;
  end loop;

  -- The total the customer saw on Checkout, when the app sends it.
  if p_expected_total is not null and p_expected_total <> v_total then
    raise exception using errcode = 'ZL018', message = 'price_changed';
  end if;

  -- "استخدم زيارة من اشتراكك": the address's subscription, locked until the
  -- booking commits, so two bookings can't spend the same last visit.
  if coalesce(p_use_subscription, false) then
    v_subscription_id := private.usable_subscription(v_address.id, p_service_date, v_tank_count);
  end if;

  p_media := coalesce(p_media, '[]');
  if jsonb_typeof(p_media) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_media';
  end if;
  if jsonb_array_length(p_media) > 4 then
    raise exception using errcode = 'ZL008', message = 'too_many_files';
  end if;

  -- The order. A request repeated at the same moment waits here for the
  -- first one and then returns its order.
  insert into public.orders (
    customer_id, address_id, district, landmark, lat, lng, service_date, slot_id,
    slot_start_at, slot_end_at, total_iqd, customer_note, client_request_id, subscription_id
  )
  values (
    v_user_id, v_address.id, v_address.district, v_address.landmark, v_address.lat,
    v_address.lng, p_service_date, v_slot.id,
    (p_service_date + v_slot.start_time) at time zone 'Asia/Baghdad',
    (p_service_date + v_slot.end_time) at time zone 'Asia/Baghdad',
    v_total, nullif(p_note, ''), p_request_id, v_subscription_id
  )
  on conflict (customer_id, client_request_id) do nothing
  returning id, number into v_order_id, v_number;

  if v_order_id is null then
    select o.id, o.number into v_order_id, v_number
    from public.orders as o
    where o.customer_id = v_user_id and o.client_request_id = p_request_id;
    order_id := v_order_id;
    order_number := v_number;
    return;
  end if;

  perform private.reserve_seat(v_order_id, p_service_date, v_slot.id);

  -- Lines, saving new tanks to the address.
  for i in 1 .. cardinality(v_types) loop
    v_tank_id := v_tank_ids[i];
    if v_tank_id is null then
      insert into public.tanks (user_id, address_id, type, size)
      values (v_user_id, v_address.id, v_types[i], v_sizes[i])
      returning id into v_tank_id;
    end if;
    insert into public.order_items (order_id, tank_id, tank_type, size, qty, unit_price_iqd)
    values (v_order_id, v_tank_id, v_types[i], v_sizes[i], v_qtys[i], v_prices[i]);
  end loop;

  insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role)
  values (v_order_id, null, 'pending_confirmation', v_user_id, 'customer');

  -- Uploads: finished (Storage made the object), in the caller's own folder,
  -- recent, and not attached to another order. Type and size come from Storage.
  for v_file in select e.value from jsonb_array_elements(p_media) as e loop
    select ob.metadata into v_metadata
    from storage.objects as ob
    where ob.bucket_id = 'order-media'
      and ob.name = v_file ->> 'path'
      and ob.name like 'customer/' || v_user_id || '/%'
      and ob.owner_id = v_user_id::text
      -- Within 48 hours of the upload: the cleanup job deletes unattached
      -- customer files after 72, so it never deletes one that can be booked.
      and ob.created_at > now() - interval '48 hours'
      and not exists (select 1 from public.order_media as m where m.path = ob.name);
    if not found then
      raise exception using errcode = 'ZL009', message = 'upload_not_found';
    end if;

    v_media_type := case when v_metadata ->> 'mimetype' like 'video/%' then 'video' else 'photo' end;
    insert into public.order_media (order_id, kind, media_type, path, bytes, duration_s, uploaded_by)
    values (
      v_order_id, 'customer', v_media_type, v_file ->> 'path', (v_metadata ->> 'size')::bigint,
      case when v_media_type = 'video' then (v_file ->> 'duration_s')::numeric end, v_user_id
    );
  end loop;

  order_id := v_order_id;
  order_number := v_number;
end;
$$;

-- admin_activate_subscription: no tank limit ---------------------------------------------------

create or replace function public.admin_activate_subscription(
  p_subscription_id uuid,
  p_starts_on date,
  p_visits integer,
  p_tanks integer,
  p_price_iqd integer,
  p_paid boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions := private.lock_subscription(p_subscription_id);
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_ends_on date;
  v_note text := nullif(btrim(p_note), '');
begin
  if v_sub.status <> 'requested' then
    raise exception using errcode = 'ZL036', message = 'invalid_subscription_status';
  end if;
  if p_starts_on is null or p_starts_on < v_today or p_starts_on > v_today + 366 then
    raise exception using errcode = '22023', message = 'invalid_start';
  end if;
  if p_visits is null or p_visits not between 1 and 12 then
    raise exception using errcode = '22023', message = 'invalid_visits';
  end if;
  -- Any number of tanks; only what tanks_covered (smallint) can hold.
  if p_tanks is null or p_tanks not between 1 and 32767 then
    raise exception using errcode = '22023', message = 'invalid_tanks';
  end if;
  if p_price_iqd is null or p_price_iqd not between 1 and 10000000 then
    raise exception using errcode = '22023', message = 'invalid_price';
  end if;

  v_ends_on := (p_starts_on + interval '12 months' - interval '1 day')::date;
  if exists (
    select 1 from public.subscriptions as s
    where s.address_id = v_sub.address_id
      and s.status = 'active'
      and daterange(s.starts_on, s.ends_on, '[]') && daterange(p_starts_on, v_ends_on, '[]')
  ) then
    raise exception using errcode = 'ZL035', message = 'subscription_exists';
  end if;

  update public.subscriptions as s
  set
    status = 'active',
    starts_on = p_starts_on,
    ends_on = v_ends_on,
    visits_total = p_visits,
    tanks_covered = p_tanks,
    price_iqd = p_price_iqd,
    paid = coalesce(p_paid, false),
    activated_at = now()
  where s.id = v_sub.id
  returning * into v_sub;

  if v_note is not null then
    perform private.add_subscription_note(v_sub.id, v_note);
  end if;

  perform private.log_admin_action(
    'subscription.activate', 'subscriptions', v_sub.id::text,
    jsonb_build_object(
      'starts_on', v_sub.starts_on,
      'ends_on', v_sub.ends_on,
      'visits_total', v_sub.visits_total,
      'tanks_covered', v_sub.tanks_covered,
      'price_iqd', v_sub.price_iqd,
      'paid', v_sub.paid
    )
  );
  perform private.notify_user(v_sub.user_id, 'subscription_activated', private.subscription_notice(v_sub));
end;
$$;

revoke execute on all functions in schema private from public;
