-- مؤجل, postponed (settled Oct 29, 2026; spec §6, §5.12, N4, N7, §8.2, §9.2):
-- an order put off with no new date, and customers changing an order until
-- its slot starts instead of 2 hours before.
--
-- transition_order:
-- - Customer: pending or confirmed → postponed, until the slot starts; a
--   postponed order → cancelled (N6 reason), at any time. Cancel and
--   reschedule are also allowed until the slot starts (ZL006 from then on):
--   no more 2-hour rule for changes. cancel_cutoff_hours still sets how soon
--   a slot can be booked, a reschedule's new slot included (bookable_slot).
-- - Admin: pending or confirmed → postponed (an optional note, internal);
--   postponed → pending_confirmation with a new date and slot (the old one
--   may be picked again) or → cancelled (reason). Only staff give the date
--   back. Confirming a postponed order needs a date first (ZL010).
-- - Postponing frees the place and removes the crew (kept in the event's
--   details as from_crew_id; the crew is told through orders_crew_notify).
--   The order keeps its old service_date, slot and times as a record.
--   Overrides into postponed do the same; out of it, the old place is taken
--   again (ZL005 if full).
-- Departure from §7: no nullable date. Orders keep service_date, slot_id and
-- the slot times (not null), so every screen and index that reads them keeps
-- working; the status says the date no longer holds, and the order holds no
-- slot_bookings row.
--
-- Open orders: a postponed order is still open. These now list it beside
-- pending … in progress: subscription visits held (subscription_visits and
-- subscription_overview's held count; its "next order" stays the ones with
-- a date), admin_end_subscription (open orders become cash orders),
-- admin_set_order_subscription (coverage can be put on), delete_address
-- (ZL012), delete_account (ZL039), the deleted-account reopening guard, and
-- the cleaning reminders (skipped while an order is open). assign_crew
-- already refuses statuses other than pending, confirmed and on the way
-- (ZL014), and the A9 conflicts list reads pending and confirmed only.
--
-- Notifications: customer_postponed (admins, a customer's postpone) and
-- order_postponed (the customer, a staff postpone), added by migration
-- order_status_postponed.

-- 1. transition_order -------------------------------------------------------------------

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
  v_sterilant text;
  v_chlorine numeric;
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

  v_from := v_order.status;
  v_reason := nullif(btrim(v_payload ->> 'reason'), '');
  v_cash := coalesce((v_payload ->> 'cash_collected')::boolean, false);
  v_reschedule := p_to_status = 'pending_confirmation'
    and v_from in ('pending_confirmation', 'confirmed', 'postponed');

  if p_to_status = v_from and not v_reschedule then
    raise exception using errcode = 'ZL010', message = 'invalid_transition';
  end if;

  -- The §6 table: who may make which move.
  if v_role = 'customer' then
    -- A postponed order gets its date back from staff only (settled Oct 29, 2026).
    v_allowed := (v_from in ('pending_confirmation', 'confirmed')
        and p_to_status in ('cancelled', 'pending_confirmation', 'postponed'))
      or (v_from = 'postponed' and p_to_status = 'cancelled');
  elsif v_role = 'crew' then
    v_allowed := (v_from = 'confirmed' and p_to_status = 'on_the_way')
      or (v_from = 'on_the_way' and p_to_status = 'arrived')
      or (v_from = 'arrived' and p_to_status = 'in_progress')
      or (v_from = 'in_progress' and p_to_status = 'completed')
      or (v_from in ('confirmed', 'on_the_way', 'arrived') and p_to_status = 'no_show');
  elsif v_role = 'admin' then
    v_allowed := (v_from = 'pending_confirmation' and p_to_status = 'confirmed')
      or (v_from in ('pending_confirmation', 'confirmed')
          and p_to_status in ('cancelled', 'pending_confirmation', 'postponed'))
      or (v_from = 'postponed' and p_to_status in ('cancelled', 'pending_confirmation'))
      or (v_from in ('confirmed', 'on_the_way', 'arrived') and p_to_status = 'no_show');
    v_override := not v_allowed and coalesce((v_payload ->> 'override')::boolean, false);
  end if;

  if not v_allowed and not v_override then
    raise exception using errcode = 'ZL010', message = 'invalid_transition';
  end if;

  -- Customers change an order until its slot starts (settled Oct 29, 2026;
  -- cancel_cutoff_hours now only sets how soon a slot can be booked). A
  -- postponed order has no slot, so it can be cancelled at any time.
  if v_role = 'customer'
    and v_from <> 'postponed'
    and now() >= v_order.slot_start_at
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
    -- A customer keeps a covered order inside its subscription's period;
    -- staff may move it anywhere.
    if v_role = 'customer' and v_order.subscription_id is not null and not exists (
      select 1 from public.subscriptions as s
      where s.id = v_order.subscription_id
        and s.status = 'active'
        and v_new_date between s.starts_on and s.ends_on
    ) then
      raise exception using errcode = 'ZL034', message = 'outside_subscription_period';
    end if;
    -- A postponed order may go back to the date it had.
    if v_from <> 'postponed'
      and v_new_date = v_order.service_date and v_new_slot.id = v_order.slot_id
    then
      raise exception using errcode = '22023', message = 'same_slot';
    end if;
  elsif p_to_status = 'confirmed' then
    -- §6: coverage verified when confirming. The order's own visit is
    -- already held, so it is left out of the count.
    if v_order.subscription_id is not null
      and private.usable_subscription(
        v_order.address_id, v_order.service_date,
        (select sum(i.qty)::int from public.order_items as i where i.order_id = v_order.id),
        v_order.id
      ) is distinct from v_order.subscription_id
    then
      raise exception using errcode = 'ZL034', message = 'no_subscription';
    end if;
  elsif p_to_status = 'on_the_way' then
    if v_order.crew_id is null then
      raise exception using errcode = 'ZL011', message = 'crew_not_assigned';
    end if;
  elsif p_to_status = 'completed' then
    -- Before and after photos are optional (settled Oct 26, 2026). A covered
    -- order collects no cash, and records none.
    if v_order.subscription_id is not null then
      v_cash := false;
    elsif not v_cash then
      raise exception using errcode = 'ZL011', message = 'cash_not_collected';
    end if;
    -- The C4 form (crew only; an admin override needs none of it).
    if v_role = 'crew' then
      v_sterilant := nullif(btrim(v_payload ->> 'sterilant'), '');
      if v_sterilant is null then
        raise exception using errcode = 'ZL011', message = 'sterilant_required';
      end if;
      if char_length(v_sterilant) not between 2 and 120 then
        raise exception using errcode = '22023', message = 'invalid_sterilant';
      end if;
      if coalesce(jsonb_typeof(v_payload -> 'residual_chlorine_mg_l'), 'null') <> 'null' then
        if jsonb_typeof(v_payload -> 'residual_chlorine_mg_l') <> 'number' then
          raise exception using errcode = '22023', message = 'invalid_chlorine';
        end if;
        v_chlorine := (v_payload -> 'residual_chlorine_mg_l')::numeric;
        if v_chlorine not between 0 and 10 or v_chlorine <> round(v_chlorine, 1) then
          raise exception using errcode = '22023', message = 'invalid_chlorine';
        end if;
      end if;
      -- The crew's note is internal, like every staff note (settled Oct 26, 2026).
      v_reason := nullif(btrim(v_payload ->> 'note'), '');
    end if;
  end if;

  -- A covered order collects no cash, whoever completes it.
  if v_order.subscription_id is not null then
    v_cash := false;
  end if;
  -- An override that brings a covered order back from cancelled or no-show
  -- (which hold no visit) takes a visit again: the same checks as a booking,
  -- with the subscription locked (RLS audit). The admin drops the coverage
  -- first (admin_set_order_subscription) to bring it back as a cash order.
  if v_override
    and v_order.subscription_id is not null
    and v_from in ('cancelled', 'no_show')
    and p_to_status not in ('cancelled', 'no_show')
    and private.usable_subscription(
      v_order.address_id, v_order.service_date,
      (select sum(i.qty)::int from public.order_items as i where i.order_id = v_order.id),
      v_order.id
    ) is distinct from v_order.subscription_id
  then
    raise exception using errcode = 'ZL034', message = 'no_subscription';
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
  elsif p_to_status in ('cancelled', 'postponed') then
    perform private.release_seat(v_order.id);
  elsif v_from in ('cancelled', 'postponed') then
    -- An override brings a cancelled or postponed order back on its old
    -- date: it needs its place again.
    perform private.reserve_seat(v_order.id, v_order.service_date, v_order.slot_id);
  end if;

  -- A postponed order has no date, so no crew either; the event keeps the
  -- crew it had. Removed before the status changes, so the crew is told
  -- (orders_crew_notify: job_changed, removed).
  if p_to_status = 'postponed' and v_order.crew_id is not null then
    v_details := v_details || jsonb_build_object('from_crew_id', v_order.crew_id);
    update public.orders as o set crew_id = null where o.id = v_order.id;
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

  if p_to_status = 'completed' and v_role = 'crew' then
    -- One report per order: completing again after an override replaces it.
    insert into public.job_reports (order_id, crew_id, sterilant, residual_chlorine_mg_l)
    values (v_order.id, v_order.crew_id, v_sterilant, v_chlorine)
    on conflict (order_id) do update
    set
      crew_id = excluded.crew_id,
      sterilant = excluded.sterilant,
      residual_chlorine_mg_l = excluded.residual_chlorine_mg_l;
  end if;

  -- Every move to completed issues (or refreshes) the certificate, after the
  -- report it copies (spec §6).
  if p_to_status = 'completed' then
    perform private.issue_certificate(v_order.id);
  end if;

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

-- 2. Notifications ------------------------------------------------------------------------

alter table public.notifications
alter column audience set expression as (
  case
    when type in (
      'new_booking', 'customer_rescheduled', 'customer_cancelled', 'customer_message', 'new_ticket',
      'subscription_requested', 'customer_postponed'
    ) then 'admin'::public.app_role
    when type in ('new_job', 'job_changed') then 'crew'::public.app_role
    else 'customer'::public.app_role
  end
);

create or replace function private.notify_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_data jsonb;
begin
  select * into v_order from public.orders as o where o.id = new.order_id;
  v_data := private.order_notice(v_order);

  -- A booking.
  if new.from_status is null then
    perform private.notify_admins('new_booking', v_data, v_order.id);
    return null;
  end if;

  -- A job the crew could see leaves its schedule.
  if v_order.crew_id is not null
    and new.from_status in ('confirmed', 'on_the_way', 'arrived', 'in_progress')
    and (
      new.to_status = 'cancelled'
      or (new.to_status = 'pending_confirmation' and not new.is_override)
    )
  then
    perform private.notify_crew(
      v_order.crew_id, 'job_changed',
      v_data || jsonb_build_object(
        'change', case when new.to_status = 'cancelled' then 'cancelled' else 'rescheduled' end
      ),
      v_order.id
    );
  end if;

  -- Overrides are corrections: only a certificate or a cancel is news.
  if new.is_override then
    if new.to_status = 'completed' then
      perform private.notify_user(v_order.customer_id, 'order_completed', v_data, v_order.id);
    elsif new.to_status = 'cancelled' then
      perform private.notify_user(v_order.customer_id, 'order_cancelled', v_data, v_order.id);
    end if;
    return null;
  end if;

  case new.to_status
    when 'confirmed' then
      perform private.notify_user(v_order.customer_id, 'order_confirmed', v_data, v_order.id);
      if v_order.crew_id is not null then
        perform private.notify_crew(v_order.crew_id, 'new_job', v_data, v_order.id);
      end if;
    when 'pending_confirmation' then
      if new.actor_role = 'customer' then
        perform private.notify_admins('customer_rescheduled', v_data, v_order.id);
      else
        perform private.notify_user(v_order.customer_id, 'order_rescheduled', v_data, v_order.id);
      end if;
    when 'cancelled' then
      if new.actor_role = 'customer' then
        perform private.notify_admins(
          'customer_cancelled',
          v_data || jsonb_strip_nulls(jsonb_build_object('cancel_reason', new.cancel_reason)),
          v_order.id
        );
      else
        perform private.notify_user(v_order.customer_id, 'order_cancelled', v_data, v_order.id);
      end if;
    when 'on_the_way' then
      perform private.notify_user(v_order.customer_id, 'crew_on_the_way', v_data, v_order.id);
    when 'arrived' then
      perform private.notify_user(v_order.customer_id, 'crew_arrived', v_data, v_order.id);
    when 'in_progress' then
      perform private.notify_user(v_order.customer_id, 'work_started', v_data, v_order.id);
    when 'completed' then
      perform private.notify_user(v_order.customer_id, 'order_completed', v_data, v_order.id);
    when 'no_show' then
      perform private.notify_user(v_order.customer_id, 'order_no_show', v_data, v_order.id);
    when 'postponed' then
      if new.actor_role = 'customer' then
        perform private.notify_admins('customer_postponed', v_data, v_order.id);
      else
        perform private.notify_user(v_order.customer_id, 'order_postponed', v_data, v_order.id);
      end if;
    else
      null;
  end case;
  return null;
end;
$$;

-- 3. A postponed order is still open -----------------------------------------------------

create or replace function private.subscription_visits(
  p_subscription_id uuid,
  p_order_id uuid default null,
  out used integer,
  out held integer
)
language sql
stable
set search_path = ''
as $$
  select
    (count(*) filter (where o.status = 'completed'))::int
      + (select s.visits_adjustment from public.subscriptions as s where s.id = p_subscription_id),
    (count(*) filter (
      where o.status in ('pending_confirmation', 'confirmed', 'postponed', 'on_the_way', 'arrived', 'in_progress')
    ))::int
  from public.orders as o
  where o.subscription_id = p_subscription_id
    and o.id is distinct from p_order_id;
$$;

create or replace function public.admin_end_subscription(p_subscription_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions := private.lock_subscription(p_subscription_id);
  v_reason text := nullif(btrim(p_reason), '');
  v_to public.subscription_status;
begin
  if v_sub.status = 'requested' then
    v_to := 'declined';
  elsif v_sub.status = 'active' and v_sub.ends_on >= (now() at time zone 'Asia/Baghdad')::date then
    v_to := 'cancelled';
  else
    raise exception using errcode = 'ZL036', message = 'invalid_subscription_status';
  end if;
  if v_reason is null then
    raise exception using errcode = 'ZL011', message = 'reason_required';
  end if;

  update public.subscriptions as s
  set status = v_to, ended_at = now()
  where s.id = v_sub.id
  returning * into v_sub;
  perform private.add_subscription_note(v_sub.id, v_reason);

  -- Its open orders become cash orders, so no crew finishes one for free on
  -- a cancelled subscription (code review). Completed ones keep it: they
  -- used their visit. Each is logged like A2's "شيل الاشتراك".
  with dropped as (
    update public.orders as o
    set subscription_id = null
    where o.subscription_id = v_sub.id
      and o.status in ('pending_confirmation', 'confirmed', 'postponed', 'on_the_way', 'arrived', 'in_progress')
    returning o.id
  )
  insert into public.admin_audit_log (admin_id, action, entity, entity_id, diff)
  select (select auth.uid()), 'order.subscription', 'orders', d.id::text,
    jsonb_build_object('from', v_sub.id, 'to', null)
  from dropped as d;

  perform private.log_admin_action(
    case when v_to = 'declined' then 'subscription.decline' else 'subscription.cancel' end,
    'subscriptions', v_sub.id::text,
    jsonb_build_object('reason', v_reason)
  );
  -- A cancel is support's to explain in chat; a decline tells the customer.
  if v_to = 'declined' then
    perform private.notify_user(v_sub.user_id, 'subscription_declined', private.subscription_notice(v_sub));
  end if;
end;
$$;

create or replace function public.admin_set_order_subscription(p_order_id uuid, p_use boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_sub_id uuid;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select * into v_order from public.orders as o where o.id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;
  -- Coverage is put on only while the order waits for its visit; it can be
  -- dropped until the order is completed (a subscription cancelled while
  -- the crew is on its way, or an order brought back from cancelled).
  if v_order.status = 'completed'
    or (coalesce(p_use, false) and v_order.status not in ('pending_confirmation', 'confirmed', 'postponed'))
  then
    raise exception using errcode = 'ZL038', message = 'subscription_change_not_allowed';
  end if;

  if coalesce(p_use, false) then
    if v_order.subscription_id is not null then
      return;
    end if;
    v_sub_id := private.usable_subscription(
      v_order.address_id, v_order.service_date,
      (select sum(i.qty)::int from public.order_items as i where i.order_id = v_order.id),
      v_order.id
    );
  elsif v_order.subscription_id is null then
    return;
  end if;

  update public.orders as o set subscription_id = v_sub_id where o.id = v_order.id;
  perform private.log_admin_action(
    'order.subscription', 'orders', v_order.id::text,
    jsonb_build_object('from', v_order.subscription_id, 'to', v_sub_id)
  );
end;
$$;

create or replace function public.delete_address(p_address_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_was_default boolean;
begin
  select a.is_default into v_was_default
  from public.addresses as a
  where a.id = p_address_id and a.user_id = v_user_id and a.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'address_not_found';
  end if;

  if exists (
    select 1 from public.orders as o
    where o.address_id = p_address_id
      and o.status in ('pending_confirmation', 'confirmed', 'postponed', 'on_the_way', 'arrived', 'in_progress')
  ) or exists (
    select 1 from public.subscriptions as s
    where s.address_id = p_address_id
      and (
        s.status = 'requested'
        or (s.status = 'active' and s.ends_on >= (now() at time zone 'Asia/Baghdad')::date)
      )
  ) then
    raise exception using errcode = 'ZL012', message = 'address_in_use';
  end if;

  delete from public.tanks as t where t.address_id = p_address_id;

  update public.addresses as a
  set deleted_at = now(), is_default = false
  where a.id = p_address_id;

  if v_was_default then
    update public.addresses as a
    set is_default = true
    where a.id = (
      select b.id from public.addresses as b
      where b.user_id = v_user_id and b.deleted_at is null
      order by b.created_at desc, b.id
      limit 1
    );
  end if;
end;
$$;

create or replace function public.delete_account()
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

  -- Lock order: the addresses first, as create_order and
  -- request_subscription do (address, then the profile through the foreign
  -- key), so a booking in another tab finishes first instead of deadlocking,
  -- and the open-order check below then sees it. Then the profile, so two
  -- deletions can't interleave.
  perform 1 from public.addresses as a where a.user_id = v_user_id for update;
  perform 1 from public.profiles as p where p.id = v_user_id for update;

  if exists (
    select 1
    from public.orders as o
    where o.customer_id = v_user_id
      and o.status in ('pending_confirmation', 'confirmed', 'postponed', 'on_the_way', 'arrived', 'in_progress')
  ) then
    raise exception using errcode = 'ZL039', message = 'account_has_open_orders';
  end if;

  -- Free text staff wrote about the account in the audit log (a reason, a
  -- note) often holds a name, a number or directions: blanked, before the
  -- tickets go. The rest of each row stays. The rows it is about are locked
  -- first, so an override reason or a note an admin is writing at this
  -- moment commits before the scrub reads (RLS audit of this migration).
  perform 1 from public.orders as o where o.customer_id = v_user_id for update;
  perform 1 from public.tickets as t where t.user_id = v_user_id for update;
  perform 1 from public.subscriptions as s where s.user_id = v_user_id for update;
  perform private.scrub_audit_text(v_user_id);

  -- Each admin's notification of a customer message keeps an excerpt of it
  -- (migration notifications): it goes with the thread (RLS audit of this
  -- migration).
  delete from public.notifications as n
  where n.type = 'customer_message'
    and n.data ->> 'thread_id' in (
      select t.id::text from public.chat_threads as t where t.user_id = v_user_id
    );

  -- Subscriptions end before the addresses move, so the pin guard lets go.
  update public.subscriptions as s
  set status = 'declined', ended_at = now()
  where s.user_id = v_user_id and s.status = 'requested';
  update public.subscriptions as s
  set status = 'cancelled', ended_at = now()
  where s.user_id = v_user_id and s.status = 'active';

  -- Staff notes are free text that often holds the customer's name, number
  -- or directions.
  delete from public.subscription_notes as n
  using public.subscriptions as s
  where s.id = n.subscription_id and s.user_id = v_user_id;
  delete from public.order_event_notes as n
  using public.orders as o
  where o.id = n.order_id and o.customer_id = v_user_id;

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

create or replace function private.refuse_reopening_deleted_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('pending_confirmation', 'confirmed', 'postponed', 'on_the_way', 'arrived', 'in_progress')
    and not exists (
      select 1 from public.profiles as p where p.id = new.customer_id and p.deleted_at is null
    )
  then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;
  return new;
end;
$$;

create or replace function private.send_cleaning_reminders(
  p_today date default (now() at time zone 'Asia/Baghdad')::date
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with candidates as (
    select
      c.id as certificate_id,
      c.next_due_on,
      case
        when c.next_due_on > p_today then 'week'
        else 'due'
      end::public.reminder_kind as kind,
      o.id as order_id,
      o.customer_id,
      a.label,
      c.issued_at
    from public.certificates as c
    join public.orders as o on o.id = c.order_id and o.status = 'completed'
    join public.profiles as p
      on p.id = o.customer_id and p.role = 'customer' and p.deleted_at is null and p.reminders_enabled
    join public.addresses as a on a.id = o.address_id and a.deleted_at is null
    where c.next_due_on between p_today - 6 and p_today + 7
      -- Cleaned again since: the newer certificate is the one that counts.
      and not exists (
        select 1
        from public.certificates as c2
        join public.orders as o2 on o2.id = c2.order_id
        where o2.address_id = o.address_id
          and o2.status = 'completed'
          and c2.id <> c.id
          -- One reminder per address: a tie goes to one of them.
          and (c2.next_due_on > c.next_due_on or (c2.next_due_on = c.next_due_on and c2.id > c.id))
      )
      -- Already booked.
      and not exists (
        select 1 from public.orders as o3
        where o3.address_id = o.address_id
          and o3.status in ('pending_confirmation', 'confirmed', 'postponed', 'on_the_way', 'arrived', 'in_progress')
      )
  ),
  recorded as (
    insert into public.cleaning_reminders (certificate_id, due_on, kind)
    select cd.certificate_id, cd.next_due_on, cd.kind from candidates as cd
    on conflict do nothing
    returning certificate_id, due_on, kind
  )
  insert into public.notifications (user_id, type, data, order_id)
  select
    cd.customer_id,
    'cleaning_reminder',
    jsonb_build_object(
      'kind', r.kind,
      'due_on', r.due_on,
      -- The certificate's own interval (the setting may have changed since).
      'months', greatest(1, (
        extract(year from age(r.due_on, (cd.issued_at at time zone 'Asia/Baghdad')::date)) * 12
        + extract(month from age(r.due_on, (cd.issued_at at time zone 'Asia/Baghdad')::date))
      )::integer),
      'label', cd.label
    ),
    cd.order_id
  from recorded as r
  join candidates as cd on cd.certificate_id = r.certificate_id and cd.kind = r.kind;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace view public.subscription_overview
with (security_invoker = true)
as
select
  s.id,
  s.user_id,
  s.address_id,
  s.status,
  case
    when s.status = 'active' and s.ends_on < (now() at time zone 'Asia/Baghdad')::date then 'expired'
    when s.status = 'active' and s.starts_on > (now() at time zone 'Asia/Baghdad')::date then 'upcoming'
    else s.status::text
  end as state,
  s.requested_at,
  s.activated_at,
  s.ended_at,
  s.price_iqd,
  s.visits_total,
  s.tanks_covered,
  s.starts_on,
  s.ends_on,
  s.paid,
  s.visits_adjustment,
  (v.completed + s.visits_adjustment)::int as visits_used,
  v.held as visits_held,
  greatest(coalesce(s.visits_total, 0) - v.completed - s.visits_adjustment - v.held, 0)::int
    as visits_left,
  n.id as next_order_id,
  n.slot_start_at as next_order_at,
  v.last_visit_on,
  a.label as address_label,
  a.district as address_district,
  a.landmark as address_landmark,
  p.full_name as customer_name,
  p.phone as customer_phone
from public.subscriptions as s
cross join lateral (
  select
    (count(*) filter (where o.status = 'completed'))::int as completed,
    (count(*) filter (
      where o.status in ('pending_confirmation', 'confirmed', 'postponed', 'on_the_way', 'arrived', 'in_progress')
    ))::int as held,
    max(o.service_date) filter (where o.status = 'completed') as last_visit_on
  from public.orders as o
  where o.subscription_id = s.id
) as v
left join lateral (
  select o.id, o.slot_start_at
  from public.orders as o
  where o.subscription_id = s.id
    and o.status in ('pending_confirmation', 'confirmed', 'on_the_way', 'arrived', 'in_progress')
  order by o.slot_start_at, o.id
  limit 1
) as n on true
left join public.addresses as a on a.id = s.address_id
left join public.profiles as p on p.id = s.user_id;


revoke all on public.subscription_overview from anon, authenticated;
grant select on public.subscription_overview to authenticated;

revoke execute on all functions in schema private from public;
