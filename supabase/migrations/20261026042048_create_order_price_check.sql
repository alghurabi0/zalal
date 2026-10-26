-- create_order() refuses a total the customer didn't see (spec §5.11, §8.2
-- A8; Phase 3 task 1 part B, settled with the owner on Oct 26, 2026).
--
-- Admins can now change prices (admin_update_prices), so a customer may be on
-- Checkout with an old price while create_order() charges the new one. The
-- app now sends the total shown on Checkout as p_expected_total; when the
-- current prices give another total the booking is refused with ZL018
-- price_changed before anything is written, and Checkout reloads with the
-- new price. The parameter defaults to null (no check), so an app deployed
-- before this migration keeps booking.
--
-- The function is dropped and made again because its signature changes;
-- the body is the one from migration booking_functions plus the check.
-- Departures from spec §7: none.

drop function public.create_order(uuid, uuid, date, bigint, jsonb, text, jsonb);

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
  p_expected_total integer default null,
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

  -- The total the customer saw on Checkout, when the app sends it.
  if p_expected_total is not null and p_expected_total <> v_total then
    raise exception using errcode = 'ZL018', message = 'price_changed';
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

revoke execute on function public.create_order(uuid, uuid, date, bigint, jsonb, text, jsonb, integer)
from public, anon;
grant execute on function public.create_order(uuid, uuid, date, bigint, jsonb, text, jsonb, integer)
to authenticated;
