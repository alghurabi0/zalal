-- Cleaning up order-media files that were uploaded but never attached to an
-- order (spec §7 Storage, §3 Jobs). Two nightly jobs, one per folder:
--
-- 1. public.unattached_media(folder, limit, after…): the names the job may
--    delete, oldest first, a page at a time. Service role only. A file is listed only when no
--    order_media row has its path, and:
--    - customer/<user id>/…: it was uploaded more than 72 hours ago. A booking
--      abandoned at step 2 leaves these behind.
--    - crew/<crew id>/<order id>/…: it was uploaded more than 48 hours ago,
--      and the order no longer takes media from that crew: the order is gone,
--      assigned to another crew, not arrived or in progress, or completed
--      more than 48 hours ago. attach_job_media() stops taking files 24 hours
--      after completion, so the crew's phone queue (which may attach long
--      after uploading, with no signal) can't attach a listed file; the
--      extra 24 hours is a margin. An open job keeps its files however long
--      it stays open. remove_job_media() leaves a file here too when the
--      app's Storage delete fails.
--
-- 2. create_order() now takes a booking upload only within 48 hours of it
--    being uploaded (ZL009 upload_not_found otherwise; the customer adds the
--    file again). Without this, a customer booking with an old file at the
--    moment the job lists it would get an order whose file the job then
--    deletes. With it, a file over 72 hours old can't be booked, so the job
--    never races a booking. Same signature; the body is the one from
--    migration create_order_price_check plus that line.
--
-- 3. The delete itself goes through the Storage API (direct deletes from
--    storage.objects are refused and would leave the stored file behind),
--    from the Edge Function media-cleanup (supabase/functions/media-cleanup),
--    which pages through unattached_media() with the service key. pg_cron
--    calls it nightly through private.invoke_media_cleanup(folder), which
--    reads the project URL and the job's secret from Vault (project_url,
--    media_cleanup_secret; docs/supabase-setup.md) and sends the secret in
--    the x-media-cleanup-secret header. The function has verify_jwt off and
--    checks that header itself, since the new secret keys aren't JWTs. Until
--    the owner adds the Vault secrets, the jobs run and send nothing.
--
-- Booking videos kept after completion (spec §13, media retention) are not
-- touched here: they are attached. If retention is approved, deleting their
-- order_media rows is enough; this job then removes the files.
--
-- Departures from spec §7: none (no new tables).

-- 1. What may be deleted -------------------------------------------------------------

-- A page of names with their upload time, oldest first. The next page starts
-- after the last row (p_after_created_at, p_after_name), so files the Storage
-- API keeps refusing don't fill every page.
create function public.unattached_media(
  p_folder text,
  p_limit integer default 500,
  p_after_created_at timestamptz default null,
  p_after_name text default null
)
returns table (name text, created_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_folder is null or p_folder not in ('customer', 'crew') then
    raise exception using errcode = '22023', message = 'invalid_folder';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'invalid_limit';
  end if;
  if (p_after_created_at is null) <> (p_after_name is null) then
    raise exception using errcode = '22023', message = 'invalid_cursor';
  end if;

  if p_folder = 'customer' then
    return query
    select ob.name, ob.created_at
    from storage.objects as ob
    where ob.bucket_id = 'order-media'
      and starts_with(ob.name, 'customer/')
      -- create_order() takes uploads up to 48 hours old.
      and ob.created_at < now() - interval '72 hours'
      and (p_after_created_at is null or (ob.created_at, ob.name) > (p_after_created_at, p_after_name))
      and not exists (select 1 from public.order_media as m where m.path = ob.name)
    order by ob.created_at, ob.name
    limit p_limit;
  else
    return query
    select ob.name, ob.created_at
    from storage.objects as ob
    where ob.bucket_id = 'order-media'
      and starts_with(ob.name, 'crew/')
      and ob.created_at < now() - interval '48 hours'
      and (p_after_created_at is null or (ob.created_at, ob.name) > (p_after_created_at, p_after_name))
      and not exists (select 1 from public.order_media as m where m.path = ob.name)
      -- The order still takes media from this crew: the rule of
      -- private.job_takes_media() (attach_job_media), with 48 hours after
      -- completion instead of 24 as a margin. unattached_media.test.sql checks
      -- that no file it would accept is listed, should either window change.
      and not exists (
        select 1
        from public.orders as o
        where o.id = case
            when split_part(ob.name, '/', 3) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then split_part(ob.name, '/', 3)::uuid
          end
          and o.crew_id::text = split_part(ob.name, '/', 2)
          and (
            o.status in ('arrived', 'in_progress')
            or (
              o.status = 'completed'
              and exists (
                select 1 from public.order_events as e
                where e.order_id = o.id
                  and e.to_status = 'completed'
                  and e.created_at > now() - interval '48 hours'
              )
            )
          )
      )
    order by ob.created_at, ob.name
    limit p_limit;
  end if;
end;
$$;

revoke execute on function public.unattached_media(text, integer, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.unattached_media(text, integer, timestamptz, text) to service_role;

-- 2. create_order: uploads up to 48 hours old --------------------------------------------

-- Booking step 3 (spec §5.11, §6). p_items is a list of lines, each either
-- {"tank_id": <saved tank at this address>, "qty": n} or
-- {"tank_type": "roof"|"ground", "size": "s"|"m"|"l", "qty": n} for a tank
-- to save. p_media lists finished uploads: {"path": "customer/<uid>/…",
-- "duration_s": n} (duration for videos). p_request_id is made once per
-- checkout by the app; repeating it returns the first order.
create or replace function public.create_order(
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

revoke execute on function public.create_order(uuid, uuid, date, bigint, jsonb, text, jsonb, integer)
from public, anon;
grant execute on function public.create_order(uuid, uuid, date, bigint, jsonb, text, jsonb, integer)
to authenticated;

-- 3. The nightly jobs ---------------------------------------------------------------------

-- Posts {"folder": …} to the Edge Function. Returns the pg_net request id, or
-- null when the Vault secrets aren't set yet (nothing is sent).
create function private.invoke_media_cleanup(p_folder text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_folder is null or p_folder not in ('customer', 'crew') then
    raise exception using errcode = '22023', message = 'invalid_folder';
  end if;

  select s.decrypted_secret into v_url
  from vault.decrypted_secrets as s
  where s.name = 'project_url';
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets as s
  where s.name = 'media_cleanup_secret';
  if v_url is null or v_secret is null then
    raise notice 'media cleanup skipped: add the Vault secrets project_url and media_cleanup_secret';
    return null;
  end if;

  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/media-cleanup',
    body := jsonb_build_object('folder', p_folder),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-media-cleanup-secret', v_secret
    ),
    -- The function stops itself after about 50 seconds.
    timeout_milliseconds := 60000
  );
end;
$$;

-- Daily at 00:17 UTC (03:17 Baghdad) and 00:47 UTC (03:47 Baghdad), when no one
-- books or works. A file the Storage API fails to delete is tried again the
-- next night.
select cron.schedule(
  'media-cleanup-customer', '17 0 * * *', $$select private.invoke_media_cleanup('customer')$$
);
select cron.schedule(
  'media-cleanup-crew', '47 0 * * *', $$select private.invoke_media_cleanup('crew')$$
);

revoke execute on all functions in schema private from public;
