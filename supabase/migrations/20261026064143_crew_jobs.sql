-- The crew app, part A (spec §6, §8.1 C2–C3a).
--
-- 1. transition_order() no longer requires a before photo to start work or an
--    after photo to complete. The owner settled the §13 job-media question on
--    Oct 26, 2026: before photos, after photos and clips are all optional.
--    The function is otherwise unchanged (same signature, grants and checks);
--    the codes before_photo_required and after_photo_required are retired.
--
-- 2. crew_job_contact(order_id): the customer's name and phone for C3's
--    "اتصل بالزبون". Crews can't read profiles (and shouldn't: they see only
--    the address copy on the order), so this security definer function hands
--    out just these two fields, only to the crew assigned to the order and
--    only while the job is open (confirmed, on the way, arrived, in progress;
--    settled Oct 26, 2026), and never for a deleted account. No phone is
--    copied onto orders.

-- transition_order ------------------------------------------------------------------

create or replace function public.transition_order(
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
  v_event_id bigint;
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
  elsif p_to_status = 'completed' then
    -- Before and after photos are optional (settled Oct 26, 2026).
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
    order_id, from_status, to_status, actor_id, actor_role, cancel_reason, is_override, details
  )
  values (
    v_order.id, v_from, p_to_status, v_user_id, v_role, v_cancel_reason, v_override, v_details
  )
  returning id into v_event_id;

  -- Staff reasons are internal notes; customers send no free text here.
  if v_reason is not null and v_role <> 'customer' then
    insert into public.order_event_notes (event_id, order_id, note)
    values (v_event_id, v_order.id, v_reason);
  end if;

  if v_role = 'admin' then
    perform private.log_admin_action(
      'order.transition', 'orders', v_order.id::text,
      jsonb_build_object('from', v_from, 'to', p_to_status, 'override', v_override, 'reason', v_reason)
        || v_details
    );
  end if;
end;
$$;


-- crew_job_contact ---------------------------------------------------------------

create function public.crew_job_contact(p_order_id uuid)
returns table (full_name text, phone text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.current_user_role() is distinct from 'crew' then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  return query
  select p.full_name, p.phone
  from public.orders as o
  join public.profiles as p on p.id = o.customer_id
  where o.id = p_order_id
    and o.crew_id = private.current_crew_id()
    and o.status in ('confirmed', 'on_the_way', 'arrived', 'in_progress')
    -- A deleted account's contact is gone (N13), even on an open job.
    and p.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;
end;
$$;

revoke execute on function public.crew_job_contact(uuid) from public, anon;
grant execute on function public.crew_job_contact(uuid) to authenticated;
