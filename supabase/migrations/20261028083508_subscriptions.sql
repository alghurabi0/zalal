-- Annual subscription (spec §1 decision G, §5.8, §5.11, N8, §6, §7, §8.2
-- A1/A2/A4/A7/A13, §9.2). Phase 6, task 2. Settled Oct 28, 2026 (the plan's
-- defaults, except that a subscription belongs to one address): one visit is
-- one order of up to tanks_covered tanks at the subscribed address, inside
-- the 12-month period; only a completed order uses a visit (a no-show or a
-- cancel uses none); unused visits lapse; "paid" is a tick for the admin and
-- doesn't block use; the subscription is paid outside the app.
--
-- 1. settings: subscription_price_iqd (null = not offered yet; the owner sets
--    it in A13 before launch), subscription_visits (2), subscription_tanks
--    (1). Departure from §7: three typed columns, as every other setting,
--    instead of one jsonb subscription_plan; no description (the plan's
--    words are in ar.json, as no Arabic is stored).
--
-- 2. subscriptions: one row per request. request_subscription(address_id)
--    makes it; admins activate, decline or cancel it, tick paid and adjust
--    visits through the A7 RPCs (audited). Customers read their own rows,
--    admins all; nobody writes the table directly. One request per address;
--    two active subscriptions on one address never overlap (an exclusion
--    constraint, with btree_gist). In the Realtime publication (uuid key).
--    Departures from §7:
--    - address_id: a subscription belongs to one address (settled Oct 28).
--    - No stored "expired" status: an active row past its ends_on (Baghdad)
--      is expired, so nothing goes stale at midnight; the nightly job only
--      sends the 30-day notice. A new "declined" status for a refused
--      request ("cancelled" ends an active one).
--    - No visits_used counter: visits used = completed orders on it +
--      visits_adjustment (A7's manual adjustment); open orders hold a visit.
--      So an override out of completed gives the visit back by itself, and
--      two bookings can't spend the same last visit (create_order locks the
--      row). This count is §6's "decrement subscription visit".
--    - No admin_note column: RLS can't hide one column from the customer, so
--      notes are a list in subscription_notes (as ticket_notes).
--    - requested_at, activated_at, ended_at and expiry_notified_on are new.
--
-- 3. orders.subscription_id: the subscription an order uses (null = cash).
--    Foreign key (subscription_id, address_id), so an order can use only its
--    own address's subscription. Departure: no uses_subscription column; it
--    is subscription_id is not null. total_iqd keeps the lines' sum; the crew
--    collects nothing on a covered order.
--
-- 4. subscription_overview (security invoker view): each subscription with
--    its state (requested, upcoming, active, expired, declined, cancelled),
--    visits used, held and left, the next covered order and the last covered
--    visit, its address and its customer's name and phone, under the tables'
--    own RLS.
--
-- 5. create_order(..., p_use_subscription): a covered booking needs an
--    active subscription on the address whose period holds the slot date,
--    with a visit left and no more tanks than it covers (ZL034
--    subscription_unavailable: no_subscription, outside_subscription_period,
--    no_visits_left, subscription_tanks_exceeded). transition_order:
--    completing a covered order needs no cash tick; confirming one re-checks
--    its coverage; a customer can't move it outside the period or keep it
--    on a subscription that ended. Cancelling a subscription makes its open
--    orders cash orders.
--    delete_address refuses (ZL012) while the address has a request or a
--    subscription that hasn't ended.
--
-- 6. Notifications (§9.2): subscription_requested (admins),
--    subscription_activated, subscription_declined and subscription_expiring
--    (the customer). The last comes from private.send_subscription_expiry_notices,
--    daily at 07:13 UTC (10:13 Baghdad), once per ends_on, unless the address
--    already has a renewal.

create extension if not exists btree_gist with schema extensions;

-- 1. Settings ---------------------------------------------------------------------------------

alter table public.settings
add column subscription_price_iqd integer check (
  subscription_price_iqd is null or subscription_price_iqd between 1 and 10000000
),
add column subscription_visits smallint not null default 2 check (subscription_visits between 1 and 12),
add column subscription_tanks smallint not null default 1 check (subscription_tanks between 1 and 6);

-- 2. subscriptions -------------------------------------------------------------------------------

create type public.subscription_status as enum ('requested', 'active', 'declined', 'cancelled');

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  address_id uuid not null,
  status public.subscription_status not null default 'requested',
  requested_at timestamptz not null default now(),
  price_iqd integer check (price_iqd between 1 and 10000000),
  visits_total smallint check (visits_total between 1 and 12),
  tanks_covered smallint check (tanks_covered between 1 and 6),
  starts_on date,
  ends_on date,
  -- Added to the visits used (A7): + counts a visit made outside the app,
  -- − gives one back.
  visits_adjustment smallint not null default 0 check (visits_adjustment between -12 and 12),
  paid boolean not null default false,
  activated_at timestamptz,
  ended_at timestamptz,
  -- The ends_on the 30-day notice went out for.
  expiry_notified_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (address_id, user_id) references public.addresses (id, user_id),
  constraint subscriptions_id_address_id_key unique (id, address_id),
  -- Activated rows have their plan and period; requests have none.
  constraint subscriptions_plan_check check (
    (activated_at is null) = (price_iqd is null)
    and (activated_at is null) = (visits_total is null)
    and (activated_at is null) = (tanks_covered is null)
    and (activated_at is null) = (starts_on is null)
    and (activated_at is null) = (ends_on is null)
  ),
  constraint subscriptions_period_check check (
    ends_on = (starts_on + interval '12 months' - interval '1 day')::date
  ),
  constraint subscriptions_status_check check (
    case status
      when 'requested' then activated_at is null and ended_at is null
      when 'active' then activated_at is not null and ended_at is null
      when 'declined' then activated_at is null and ended_at is not null
      when 'cancelled' then activated_at is not null and ended_at is not null
    end
  ),
  constraint subscriptions_no_overlap exclude using gist (
    address_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status = 'active')
);

alter table public.subscriptions enable row level security;

create unique index subscriptions_address_id_requested_key
on public.subscriptions (address_id) where status = 'requested';
create index subscriptions_user_id_idx on public.subscriptions (user_id);
create index subscriptions_address_id_idx on public.subscriptions (address_id);
create index subscriptions_status_ends_on_idx on public.subscriptions (status, ends_on);

create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function private.set_updated_at();

revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

create policy "Customers read their subscriptions; admins read all"
on public.subscriptions
for select
to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

alter publication supabase_realtime add table public.subscriptions;

-- subscription_notes ----------------------------------------------------------------------------

create table public.subscription_notes (
  id bigint generated always as identity primary key,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  note text not null check (char_length(note) between 1 and 1000 and note = btrim(note)),
  created_at timestamptz not null default now()
);

alter table public.subscription_notes enable row level security;

create index subscription_notes_subscription_id_idx on public.subscription_notes (subscription_id);
create index subscription_notes_author_id_idx on public.subscription_notes (author_id);

revoke all on public.subscription_notes from anon, authenticated;
revoke all on sequence public.subscription_notes_id_seq from anon, authenticated;
grant select on public.subscription_notes to authenticated;

create policy "Admins read subscription notes"
on public.subscription_notes
for select
to authenticated
using ((select private.is_admin()));

-- 3. orders.subscription_id -------------------------------------------------------------------

alter table public.orders
add column subscription_id uuid,
add constraint orders_subscription_id_address_id_fkey
  foreign key (subscription_id, address_id) references public.subscriptions (id, address_id);

create index orders_subscription_id_idx on public.orders (subscription_id)
where subscription_id is not null;

-- 4. subscription_overview -------------------------------------------------------------------

create view public.subscription_overview
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
      where o.status in ('pending_confirmation', 'confirmed', 'on_the_way', 'arrived', 'in_progress')
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

-- 6. Notification types -------------------------------------------------------------------------

-- The types come from migration subscription_notification_types.
alter table public.notifications
alter column audience set expression as (
  case
    when type in (
      'new_booking', 'customer_rescheduled', 'customer_cancelled', 'customer_message', 'new_ticket',
      'subscription_requested'
    ) then 'admin'::public.app_role
    when type in ('new_job', 'job_changed') then 'crew'::public.app_role
    else 'customer'::public.app_role
  end
);

-- Helpers -------------------------------------------------------------------------------------

-- Visits a subscription has used (completed orders + the adjustment) and
-- holds (open orders), leaving out p_order_id.
create function private.subscription_visits(
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
      where o.status in ('pending_confirmation', 'confirmed', 'on_the_way', 'arrived', 'in_progress')
    ))::int
  from public.orders as o
  where o.subscription_id = p_subscription_id
    and o.id is distinct from p_order_id;
$$;

-- The address's subscription that covers an order of p_tanks tanks on
-- p_date, locked for the rest of the transaction (so two bookings can't
-- spend the same last visit); p_order_id is the order itself when it
-- already holds a visit. Raises ZL034 with the reason otherwise.
create function private.usable_subscription(
  p_address_id uuid,
  p_date date,
  p_tanks integer,
  p_order_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
  v_visits record;
begin
  select * into v_sub
  from public.subscriptions as s
  where s.address_id = p_address_id
    and s.status = 'active'
    and p_date between s.starts_on and s.ends_on
  for update;
  if not found then
    if exists (
      select 1 from public.subscriptions as s
      where s.address_id = p_address_id
        and s.status = 'active'
        and s.ends_on >= (now() at time zone 'Asia/Baghdad')::date
    ) then
      raise exception using errcode = 'ZL034', message = 'outside_subscription_period';
    end if;
    raise exception using errcode = 'ZL034', message = 'no_subscription';
  end if;

  select * into v_visits from private.subscription_visits(v_sub.id, p_order_id);
  if v_visits.used + v_visits.held >= v_sub.visits_total then
    raise exception using errcode = 'ZL034', message = 'no_visits_left';
  end if;
  if p_tanks > v_sub.tanks_covered then
    raise exception using errcode = 'ZL034', message = 'subscription_tanks_exceeded';
  end if;
  return v_sub.id;
end;
$$;

-- What a subscription's notification needs.
create function private.subscription_notice(p_sub public.subscriptions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'subscription_id', p_sub.id,
    'address_id', p_sub.address_id,
    'label', a.label,
    'district', a.district
  ) || jsonb_strip_nulls(jsonb_build_object(
    'visits', p_sub.visits_total,
    'starts_on', p_sub.starts_on,
    'ends_on', p_sub.ends_on
  ))
  from public.addresses as a
  where a.id = p_sub.address_id;
$$;

-- Locks a subscription for an admin RPC, after the role check.
create function private.lock_subscription(p_subscription_id uuid)
returns public.subscriptions
language plpgsql
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select * into v_sub from public.subscriptions as s where s.id = p_subscription_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'subscription_not_found';
  end if;
  return v_sub;
end;
$$;

-- An A7 note (already trimmed and not empty), by the calling admin.
create function private.add_subscription_note(p_subscription_id uuid, p_note text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if char_length(p_note) > 1000 then
    raise exception using errcode = '22023', message = 'invalid_note';
  end if;
  insert into public.subscription_notes (subscription_id, author_id, note)
  values (p_subscription_id, (select auth.uid()), p_note);
end;
$$;

-- request_subscription --------------------------------------------------------------------------

create function public.request_subscription(p_address_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_address public.addresses;
  v_sub public.subscriptions;
begin
  if v_user_id is null or (select private.current_user_role()) is distinct from 'customer' then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  if (select s.subscription_price_iqd from public.settings as s) is null then
    raise exception using errcode = 'ZL037', message = 'subscription_not_offered';
  end if;

  -- The lock queues two requests for one address, and a delete_address() at
  -- the same moment.
  select * into v_address
  from public.addresses as a
  where a.id = p_address_id and a.user_id = v_user_id and a.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'address_not_found';
  end if;
  if not public.in_service_area(v_address.lat, v_address.lng) then
    raise exception using errcode = 'ZL001', message = 'outside_service_area';
  end if;

  -- Asking again returns the request already made.
  select * into v_sub
  from public.subscriptions as s
  where s.address_id = p_address_id and s.status = 'requested';
  if found then
    return v_sub.id;
  end if;

  -- A renewal is taken from 30 days before the current one ends.
  if exists (
    select 1 from public.subscriptions as s
    where s.address_id = p_address_id
      and s.status = 'active'
      and s.ends_on > (now() at time zone 'Asia/Baghdad')::date + 30
  ) then
    raise exception using errcode = 'ZL035', message = 'subscription_exists';
  end if;

  insert into public.subscriptions (user_id, address_id)
  values (v_user_id, p_address_id)
  returning * into v_sub;

  perform private.notify_admins('subscription_requested', private.subscription_notice(v_sub));
  return v_sub.id;
end;
$$;

revoke execute on function public.request_subscription(uuid) from public, anon;
grant execute on function public.request_subscription(uuid) to authenticated;

-- A7 ------------------------------------------------------------------------------------------

create function public.admin_activate_subscription(
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
  -- The table allows 6; the order limit may be lower.
  if p_tanks is null
    or p_tanks not between 1 and least(6, (select s.max_tanks_per_order from public.settings as s))
  then
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

create function public.admin_set_subscription_paid(p_subscription_id uuid, p_paid boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions := private.lock_subscription(p_subscription_id);
begin
  if v_sub.status <> 'active' then
    raise exception using errcode = 'ZL036', message = 'invalid_subscription_status';
  end if;
  if p_paid is null or v_sub.paid = p_paid then
    return;
  end if;
  update public.subscriptions as s set paid = p_paid where s.id = v_sub.id;
  perform private.log_admin_action(
    'subscription.paid', 'subscriptions', v_sub.id::text,
    jsonb_build_object('paid', jsonb_build_object('from', v_sub.paid, 'to', p_paid))
  );
end;
$$;

create function public.admin_adjust_subscription_visits(
  p_subscription_id uuid,
  p_delta integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions := private.lock_subscription(p_subscription_id);
  v_reason text := nullif(btrim(p_reason), '');
  v_visits record;
  v_left_before integer;
begin
  if v_sub.status <> 'active' then
    raise exception using errcode = 'ZL036', message = 'invalid_subscription_status';
  end if;
  if v_reason is null then
    raise exception using errcode = 'ZL011', message = 'reason_required';
  end if;
  select * into v_visits from private.subscription_visits(v_sub.id);
  if p_delta is null or p_delta = 0
    or v_visits.used + p_delta < 0
    or v_visits.used + p_delta + v_visits.held > v_sub.visits_total
    or v_sub.visits_adjustment + p_delta not between -12 and 12
  then
    raise exception using errcode = '22023', message = 'invalid_adjustment';
  end if;

  v_left_before := v_sub.visits_total - v_visits.used - v_visits.held;
  update public.subscriptions as s
  set visits_adjustment = s.visits_adjustment + p_delta
  where s.id = v_sub.id;
  perform private.add_subscription_note(v_sub.id, v_reason);

  perform private.log_admin_action(
    'subscription.adjust', 'subscriptions', v_sub.id::text,
    jsonb_build_object(
      'visits_left', jsonb_build_object('from', v_left_before, 'to', v_left_before - p_delta),
      'reason', v_reason
    )
  );
end;
$$;

create function public.admin_end_subscription(p_subscription_id uuid, p_reason text)
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
      and o.status in ('pending_confirmation', 'confirmed', 'on_the_way', 'arrived', 'in_progress')
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

create function public.admin_add_subscription_note(p_subscription_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions := private.lock_subscription(p_subscription_id);
  v_note text := nullif(btrim(p_note), '');
begin
  if v_note is null then
    raise exception using errcode = '22023', message = 'invalid_note';
  end if;
  perform private.add_subscription_note(v_sub.id, v_note);
  perform private.log_admin_action(
    'subscription.note', 'subscriptions', v_sub.id::text, jsonb_build_object('note', v_note)
  );
end;
$$;

-- A2's "verify subscription": puts the address's subscription on an order
-- while it is pending or confirmed, or drops an order's coverage in any
-- status but completed.
create function public.admin_set_order_subscription(p_order_id uuid, p_use boolean)
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
    or (coalesce(p_use, false) and v_order.status not in ('pending_confirmation', 'confirmed'))
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

revoke execute on function public.admin_activate_subscription(uuid, date, integer, integer, integer, boolean, text)
from public, anon;
grant execute on function public.admin_activate_subscription(uuid, date, integer, integer, integer, boolean, text)
to authenticated;
revoke execute on function public.admin_set_subscription_paid(uuid, boolean) from public, anon;
grant execute on function public.admin_set_subscription_paid(uuid, boolean) to authenticated;
revoke execute on function public.admin_adjust_subscription_visits(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_subscription_visits(uuid, integer, text) to authenticated;
revoke execute on function public.admin_end_subscription(uuid, text) from public, anon;
grant execute on function public.admin_end_subscription(uuid, text) to authenticated;
revoke execute on function public.admin_add_subscription_note(uuid, text) from public, anon;
grant execute on function public.admin_add_subscription_note(uuid, text) to authenticated;
revoke execute on function public.admin_set_order_subscription(uuid, boolean) from public, anon;
grant execute on function public.admin_set_order_subscription(uuid, boolean) to authenticated;

-- create_order: p_use_subscription ------------------------------------------------------------

-- The new parameter has a default, so the app deployed before it still books.
drop function public.create_order(uuid, uuid, date, bigint, jsonb, text, jsonb, integer);

create function public.create_order(
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

revoke execute on function public.create_order(uuid, uuid, date, bigint, jsonb, text, jsonb, integer, boolean)
from public, anon;
grant execute on function public.create_order(uuid, uuid, date, bigint, jsonb, text, jsonb, integer, boolean)
to authenticated;

-- transition_order: subscription coverage (§6) ---------------------------------------------

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
    if v_new_date = v_order.service_date and v_new_slot.id = v_order.slot_id then
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

-- delete_address: also refused while the address has a request or a
-- subscription that hasn't ended -------------------------------------------------------------

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
      and o.status in ('pending_confirmation', 'confirmed', 'on_the_way', 'arrived', 'in_progress')
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

-- The 30-day notice ----------------------------------------------------------------------------

create function private.send_subscription_expiry_notices(
  p_day date default (now() at time zone 'Asia/Baghdad')::date
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
  v_count integer := 0;
begin
  for v_sub in
    select s.*
    from public.subscriptions as s
    join public.profiles as p on p.id = s.user_id and p.deleted_at is null
    where s.status = 'active'
      and s.ends_on between p_day and p_day + 30
      and s.expiry_notified_on is distinct from s.ends_on
      and not exists (
        select 1 from public.subscriptions as r
        where r.address_id = s.address_id
          and r.id <> s.id
          and (r.status = 'requested' or (r.status = 'active' and r.starts_on > s.ends_on))
      )
    for update of s
  loop
    perform private.notify_user(v_sub.user_id, 'subscription_expiring', private.subscription_notice(v_sub));
    update public.subscriptions as s set expiry_notified_on = v_sub.ends_on where s.id = v_sub.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Daily at 07:13 UTC (10:13 Baghdad), beside the cleaning reminders.
select cron.schedule(
  'subscriptions-expiring', '13 7 * * *', $$select private.send_subscription_expiry_notices()$$
);

revoke execute on all functions in schema private from public;
