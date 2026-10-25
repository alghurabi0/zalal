-- Booking and the order lifecycle (spec §5.9-5.11, §6, N6, N7):
-- booking_availability(), create_order() and transition_order().
--
-- Rules settled with the owner on Oct 25, 2026 (spec §13):
-- - The booking window is today in Baghdad plus booking_window_days - 1 days
--   (14 days, today included).
-- - A new booking follows the same cutoff as cancel and reschedule: the slot
--   must start at least cancel_cutoff_hours (2 h) from now.
-- - A new tank line is saved to the address as one tank; its quantity stays
--   on the order line.
--
-- How a place is taken: a transaction-level advisory lock per (slot, day)
-- puts concurrent bookings for that slot in a queue, then the count of held
-- places is checked against the slot's current capacity and the lowest free
-- seat number is inserted. The (service_date, slot_id, seat) primary key
-- stays as the last line of defence: two orders can never hold one place.
-- So the last place goes to exactly one of two parallel bookings
-- (tests/integration/booking-capacity.test.ts), and lowering a capacity
-- never lets new bookings past it.
--
-- Side effects that belong to later phases are added there by replacing
-- transition_order(): certificates (Phase 4), notifications and push
-- (Phase 5), subscription visits (Phase 6). Crew GPS sharing reads the
-- status and needs nothing here.
--
-- Errors the app shows (supabase/CLAUDE.md lists them): ZL001
-- outside_service_area, ZL004 slot_unavailable, ZL005 slot_full, ZL006
-- change_too_late, ZL007 too_many_tanks, ZL008 too_many_files, ZL009
-- upload_not_found, ZL010 invalid_transition, ZL011 (a requirement is
-- missing: before_photo_required, after_photo_required, cash_not_collected,
-- crew_not_assigned, reason_required), P0002 for a missing row, 22023 for
-- input the app should have refused, 42501 not_allowed.

-- Helpers ----------------------------------------------------------------------

create function private.baghdad_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Baghdad')::date;
$$;

-- The slot, if it can take a booking that day; otherwise ZL004. Customers
-- book inside the window and at least cancel_cutoff_hours ahead; staff
-- (an admin rescheduling) only need a slot that hasn't started.
create function private.bookable_slot(
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
  v_settings public.settings;
  v_slot public.slots;
  v_today date := private.baghdad_today();
  v_start timestamptz;
begin
  select * into v_settings from public.settings;
  select * into v_slot from public.slots as s where s.id = p_slot_id and s.active;

  if not found
    or p_service_date is null
    or not (extract(dow from p_service_date)::smallint = any (v_slot.weekdays))
    or exists (select 1 from public.blocked_dates as b where b.date = p_service_date)
  then
    raise exception using errcode = 'ZL004', message = 'slot_unavailable';
  end if;

  v_start := (p_service_date + v_slot.start_time) at time zone 'Asia/Baghdad';

  if p_customer_rules then
    if p_service_date < v_today
      or p_service_date > v_today + v_settings.booking_window_days - 1
      or v_start < now() + make_interval(hours => v_settings.cancel_cutoff_hours)
    then
      raise exception using errcode = 'ZL004', message = 'slot_unavailable';
    end if;
  elsif v_start <= now() then
    raise exception using errcode = 'ZL004', message = 'slot_unavailable';
  end if;

  return v_slot;
end;
$$;

-- Takes a place for the order in the slot on that day, or ZL005.
create function private.reserve_seat(p_order_id uuid, p_service_date date, p_slot_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_capacity integer;
  v_taken integer;
  v_seat integer;
begin
  -- One booking at a time per slot and day, until this transaction ends.
  perform pg_advisory_xact_lock(hashtextextended('slot:' || p_slot_id || ':' || p_service_date, 0));

  select s.capacity into v_capacity from public.slots as s where s.id = p_slot_id;
  select count(*) into v_taken
  from public.slot_bookings as b
  where b.service_date = p_service_date and b.slot_id = p_slot_id;

  if v_taken >= coalesce(v_capacity, 0) then
    raise exception using errcode = 'ZL005', message = 'slot_full';
  end if;

  select min(n) into v_seat
  from generate_series(1, v_capacity + v_taken) as n
  where not exists (
    select 1 from public.slot_bookings as b
    where b.service_date = p_service_date and b.slot_id = p_slot_id and b.seat = n
  );

  insert into public.slot_bookings (service_date, slot_id, seat, order_id)
  values (p_service_date, p_slot_id, v_seat, p_order_id);
end;
$$;

create function private.release_seat(p_order_id uuid)
returns void
language sql
set search_path = ''
as $$
  delete from public.slot_bookings as b where b.order_id = p_order_id;
$$;

-- booking_availability ---------------------------------------------------------

-- Booking 1 and Reschedule (N7): every day and slot in the window, with the
-- places left and whether it can be booked now. Security definer because
-- customers can't read slot_bookings (it names other people's orders) or
-- blocked_dates. A full day is one where no slot is bookable ("ممتلئ").
create function public.booking_availability()
returns table (
  service_date date,
  slot_id bigint,
  start_at timestamptz,
  end_at timestamptz,
  capacity smallint,
  remaining integer,
  bookable boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select st.booking_window_days, st.cancel_cutoff_hours from public.settings as st
  ),
  day_slots as (
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
    from cfg
    cross join lateral (
      select private.baghdad_today() + i as day
      from generate_series(0, cfg.booking_window_days - 1) as i
    ) as d
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
      and ds.start_at >= now() + make_interval(hours => (select cfg.cancel_cutoff_hours from cfg))
  from day_slots as ds
  order by ds.day, ds.start_at;
$$;

revoke execute on function public.booking_availability() from public, anon;
grant execute on function public.booking_availability() to authenticated;

-- create_order ---------------------------------------------------------------------

-- Booking step 3 (spec §5.11, §6). p_items is a list of lines, each either
-- {"tank_id": <saved tank at this address>, "qty": n} or
-- {"tank_type": "roof"|"ground", "size": "s"|"m"|"l", "qty": n} for a tank
-- to save. p_media lists finished uploads: {"path": "customer/<uid>/…",
-- "duration_s": n} (duration for videos). p_request_id is made once per
-- checkout by the app; repeating it returns the first order.
create function public.create_order(
  p_request_id uuid,
  p_address_id uuid,
  p_service_date date,
  p_slot_id bigint,
  p_items jsonb,
  p_note text default null,
  p_media jsonb default '[]',
  out order_id uuid,
  out order_number bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_settings public.settings;
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
  v_total integer := 0;
  v_tank_count integer := 0;
  v_order_id uuid;
  v_number bigint;
  v_file jsonb;
  v_metadata jsonb;
  v_media_type public.media_type;
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

  select * into v_settings from public.settings;

  -- Address: the caller's, live, and still inside the service area.
  select * into v_address
  from public.addresses as a
  where a.id = p_address_id and a.user_id = v_user_id and a.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'address_not_found';
  end if;
  if not public.in_service_area(v_address.lat, v_address.lng) then
    raise exception using errcode = 'ZL001', message = 'outside_service_area';
  end if;

  v_slot := private.bookable_slot(p_service_date, p_slot_id, true);

  -- Lines: checked and priced before anything is written.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'invalid_items';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_items) as e loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item ->> 'qty', '') !~ '^[0-9]{1,3}$' then
      raise exception using errcode = '22023', message = 'invalid_items';
    end if;
    v_qty := (v_item ->> 'qty')::integer;
    if v_qty < 1 then
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
    v_total := v_total + v_qty * v_price;
  end loop;

  if v_tank_count > v_settings.max_tanks_per_order then
    raise exception using errcode = 'ZL007', message = 'too_many_tanks';
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
    slot_start_at, slot_end_at, total_iqd, customer_note, client_request_id
  )
  values (
    v_user_id, v_address.id, v_address.district, v_address.landmark, v_address.lat,
    v_address.lng, p_service_date, v_slot.id,
    (p_service_date + v_slot.start_time) at time zone 'Asia/Baghdad',
    (p_service_date + v_slot.end_time) at time zone 'Asia/Baghdad',
    v_total, nullif(p_note, ''), p_request_id
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
  -- and not attached to another order. Type and size come from Storage.
  for v_file in select e.value from jsonb_array_elements(p_media) as e loop
    select ob.metadata into v_metadata
    from storage.objects as ob
    where ob.bucket_id = 'order-media'
      and ob.name = v_file ->> 'path'
      and ob.name like 'customer/' || v_user_id || '/%'
      and ob.owner_id = v_user_id::text
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

revoke execute on function public.create_order(uuid, uuid, date, bigint, jsonb, text, jsonb)
from public, anon;
grant execute on function public.create_order(uuid, uuid, date, bigint, jsonb, text, jsonb)
to authenticated;

-- transition_order -------------------------------------------------------------------

-- Every status change (spec §6). p_payload by move:
-- - cancel: {"cancel_reason": "plans_changed"|"time_unsuitable"|"other"} from
--   a customer; {"reason": text} from an admin.
-- - reschedule (to pending_confirmation from pending or confirmed):
--   {"service_date": "YYYY-MM-DD", "slot_id": n}.
-- - completed: {"cash_collected": true}.
-- - no_show: {"reason": text}.
-- - admin override (any other move): {"override": true, "reason": text}.
-- Security definer because nobody may update orders directly; the caller is
-- checked against the order (a hidden order reads as order_not_found).
create function public.transition_order(
  p_order_id uuid,
  p_to_status public.order_status,
  p_payload jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role public.app_role := (select private.current_user_role());
  v_payload jsonb := coalesce(p_payload, '{}');
  v_settings public.settings;
  v_order public.orders;
  v_from public.order_status;
  v_reason text;
  v_cancel_reason public.cancel_reason;
  v_override boolean := false;
  v_allowed boolean := false;
  v_reschedule boolean;
  v_new_date date;
  v_new_slot public.slots;
  v_cash boolean;
  v_details jsonb := '{}';
begin
  if v_user_id is null or v_role is null then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_payload';
  end if;

  select * into v_order from public.orders as o where o.id = p_order_id for update;
  if not found
    or (v_role = 'customer' and v_order.customer_id <> v_user_id)
    or (v_role = 'crew' and not coalesce(v_order.crew_id = private.current_crew_id(), false))
  then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;

  select * into v_settings from public.settings;
  v_from := v_order.status;
  v_reason := nullif(btrim(v_payload ->> 'reason'), '');
  v_cash := coalesce((v_payload ->> 'cash_collected')::boolean, false);
  v_reschedule := p_to_status = 'pending_confirmation'
    and v_from in ('pending_confirmation', 'confirmed');

  if p_to_status = v_from and not v_reschedule then
    raise exception using errcode = 'ZL010', message = 'invalid_transition';
  end if;

  -- The §6 table: who may make which move.
  if v_role = 'customer' then
    v_allowed := v_from in ('pending_confirmation', 'confirmed')
      and p_to_status in ('cancelled', 'pending_confirmation');
  elsif v_role = 'crew' then
    v_allowed := (v_from = 'confirmed' and p_to_status = 'on_the_way')
      or (v_from = 'on_the_way' and p_to_status = 'arrived')
      or (v_from = 'arrived' and p_to_status = 'in_progress')
      or (v_from = 'in_progress' and p_to_status = 'completed')
      or (v_from in ('confirmed', 'on_the_way', 'arrived') and p_to_status = 'no_show');
  elsif v_role = 'admin' then
    v_allowed := (v_from = 'pending_confirmation' and p_to_status = 'confirmed')
      or (v_from in ('pending_confirmation', 'confirmed')
          and p_to_status in ('cancelled', 'pending_confirmation'))
      or (v_from in ('confirmed', 'on_the_way', 'arrived') and p_to_status = 'no_show');
    v_override := not v_allowed and coalesce((v_payload ->> 'override')::boolean, false);
  end if;

  if not v_allowed and not v_override then
    raise exception using errcode = 'ZL010', message = 'invalid_transition';
  end if;

  -- Customers change an order only until cancel_cutoff_hours before the slot.
  if v_role = 'customer'
    and now() > v_order.slot_start_at - make_interval(hours => v_settings.cancel_cutoff_hours)
  then
    raise exception using errcode = 'ZL006', message = 'change_too_late';
  end if;

  -- What each move needs.
  if v_override then
    if v_reason is null then
      raise exception using errcode = 'ZL011', message = 'reason_required';
    end if;
  elsif p_to_status = 'cancelled' then
    if v_role = 'customer' then
      if v_payload ->> 'cancel_reason' is null then
        raise exception using errcode = '22023', message = 'cancel_reason_required';
      end if;
      if not (v_payload ->> 'cancel_reason' = any (enum_range(null::public.cancel_reason)::text[])) then
        raise exception using errcode = '22023', message = 'invalid_cancel_reason';
      end if;
      v_cancel_reason := (v_payload ->> 'cancel_reason')::public.cancel_reason;
    elsif v_reason is null then
      raise exception using errcode = 'ZL011', message = 'reason_required';
    end if;
  elsif p_to_status = 'no_show' then
    if v_reason is null then
      raise exception using errcode = 'ZL011', message = 'reason_required';
    end if;
  elsif v_reschedule then
    if not (v_payload ? 'service_date' and v_payload ? 'slot_id') then
      raise exception using errcode = '22023', message = 'new_slot_required';
    end if;
    v_new_date := (v_payload ->> 'service_date')::date;
    v_new_slot := private.bookable_slot(
      v_new_date, (v_payload ->> 'slot_id')::bigint, v_role = 'customer'
    );
    if v_new_date = v_order.service_date and v_new_slot.id = v_order.slot_id then
      raise exception using errcode = '22023', message = 'same_slot';
    end if;
  elsif p_to_status = 'on_the_way' then
    if v_order.crew_id is null then
      raise exception using errcode = 'ZL011', message = 'crew_not_assigned';
    end if;
  elsif p_to_status = 'in_progress' then
    if not exists (
      select 1 from public.order_media as m
      where m.order_id = v_order.id and m.kind = 'before' and m.media_type = 'photo'
    ) then
      raise exception using errcode = 'ZL011', message = 'before_photo_required';
    end if;
  elsif p_to_status = 'completed' then
    if not exists (
      select 1 from public.order_media as m
      where m.order_id = v_order.id and m.kind = 'after' and m.media_type = 'photo'
    ) then
      raise exception using errcode = 'ZL011', message = 'after_photo_required';
    end if;
    -- Phase 6: not needed for subscription orders.
    if not v_cash then
      raise exception using errcode = 'ZL011', message = 'cash_not_collected';
    end if;
  end if;

  -- Places.
  if v_reschedule and not v_override then
    perform private.release_seat(v_order.id);
    perform private.reserve_seat(v_order.id, v_new_date, v_new_slot.id);
    v_details := jsonb_build_object(
      'from_service_date', v_order.service_date,
      'from_slot_id', v_order.slot_id,
      'to_service_date', v_new_date,
      'to_slot_id', v_new_slot.id
    );
    update public.orders as o
    set
      service_date = v_new_date,
      slot_id = v_new_slot.id,
      slot_start_at = (v_new_date + v_new_slot.start_time) at time zone 'Asia/Baghdad',
      slot_end_at = (v_new_date + v_new_slot.end_time) at time zone 'Asia/Baghdad'
    where o.id = v_order.id;
  elsif p_to_status = 'cancelled' then
    perform private.release_seat(v_order.id);
  elsif v_from = 'cancelled' then
    -- An override brings a cancelled order back: it needs its place again.
    perform private.reserve_seat(v_order.id, v_order.service_date, v_order.slot_id);
  end if;

  if p_to_status = 'completed' then
    v_details := v_details || jsonb_build_object('cash_collected', v_cash);
    update public.tanks as t
    set last_cleaned_at = now()
    where t.id in (select i.tank_id from public.order_items as i where i.order_id = v_order.id);
  end if;

  update public.orders as o
  set
    status = p_to_status,
    cash_collected = o.cash_collected or (p_to_status = 'completed' and v_cash)
  where o.id = v_order.id;

  insert into public.order_events (
    order_id, from_status, to_status, actor_id, actor_role, reason, cancel_reason,
    is_override, details
  )
  values (
    v_order.id, v_from, p_to_status, v_user_id, v_role,
    case when v_role = 'customer' then null else v_reason end,
    v_cancel_reason, v_override, v_details
  );

  if v_role = 'admin' then
    perform private.log_admin_action(
      'order.transition', 'orders', v_order.id::text,
      jsonb_build_object('from', v_from, 'to', p_to_status, 'override', v_override, 'reason', v_reason)
        || v_details
    );
  end if;
end;
$$;

revoke execute on function public.transition_order(uuid, public.order_status, jsonb) from public, anon;
grant execute on function public.transition_order(uuid, public.order_status, jsonb) to authenticated;

revoke execute on all functions in schema private from public;
