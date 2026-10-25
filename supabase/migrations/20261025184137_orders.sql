-- Orders (spec §5.9-5.15, §6, §7): orders, the places they hold
-- (slot_bookings), their tank lines, events, staff notes and media.
--
-- Nobody writes these tables through the API. create_order() and
-- transition_order() (migration booking_functions) are the only writers, so
-- orders.status changes only through transition_order().
--
-- Departures from spec §7:
-- - orders.date is service_date, and the address copy keeps lat/lng with a
--   generated `location`, as addresses do. slot_end_at is copied too, so an
--   order keeps its times if the slot is edited later.
-- - orders.client_request_id: create_order() returns the same order when the
--   app retries a request, so a lost response on a bad network can't book
--   twice.
-- - No cancel_reason column on orders: the customer's N6 choice lives on the
--   cancel event (order_events.cancel_reason), so it is stored once.
-- - order_event_notes (new): staff write a reason when they cancel, mark a
--   no-show or override. These notes are internal (settled with the owner
--   on Oct 25, 2026): admins and the assigned crew read them, the customer
--   never does. They sit in their own table because RLS can't hide one
--   column from customers while crews and admins read it, and the customer
--   reads the rest of the timeline. No uses_subscription / subscription_id
--   yet: they come with subscriptions (Phase 6).
-- - order_items.tank_id is cleared if the saved tank is deleted later; the
--   line keeps its type, size and price.
-- - order_events.details holds the old and new slot of a reschedule; actor_id
--   is required for every event a person makes (all of them, in v1).
-- - order_media.bytes and media_type come from Storage when create_order()
--   attaches a file, not from the app.
-- - slot_bookings is keyed by (service_date, slot_id, seat); order_id is
--   unique, so an order holds at most one place. Cancelled orders hold none.
-- - Crews never read the addresses table. They read the address copy on the
--   orders assigned to them.

create type public.order_status as enum (
  'pending_confirmation',
  'confirmed',
  'on_the_way',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'no_show'
);

-- Cash only in v1; ZainCash and cards are v2 (spec §1).
create type public.payment_method as enum ('cash');

-- The N6 cancel sheet: تغيرت ظروفي / الموعد ما يناسبني / شي ثاني.
create type public.cancel_reason as enum ('plans_changed', 'time_unsuitable', 'other');

create type public.order_media_kind as enum ('customer', 'before', 'after', 'clip');
create type public.media_type as enum ('photo', 'video');

-- Orders ------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Shown as #1024.
  number bigint generated always as identity (start with 1001) unique,
  customer_id uuid not null references public.profiles (id) on delete restrict,
  -- The address booked, and a copy of it as it was (history never changes).
  address_id uuid not null,
  district text not null check (char_length(district) between 2 and 60),
  landmark text not null check (char_length(landmark) between 2 and 120),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  location extensions.geography(point, 4326) generated always as (
    extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
  ) stored,
  service_date date not null,
  slot_id bigint not null references public.slots (id),
  slot_start_at timestamptz not null,
  slot_end_at timestamptz not null,
  status public.order_status not null default 'pending_confirmation',
  crew_id uuid references public.crews (id),
  -- Σ qty × unit price of the lines, in IQD.
  total_iqd integer not null check (total_iqd >= 0),
  payment_method public.payment_method not null default 'cash',
  -- Ticked by the crew on completion (C4).
  cash_collected boolean not null default false,
  customer_note text check (
    customer_note is null
    or (char_length(customer_note) between 1 and 500 and customer_note = btrim(customer_note))
  ),
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_slot_times_order check (slot_start_at < slot_end_at),
  constraint orders_customer_request_key unique (customer_id, client_request_id),
  foreign key (address_id, customer_id) references public.addresses (id, user_id)
);

alter table public.orders enable row level security;

-- Orders list (newest first) and the Home active card.
create index orders_customer_id_created_at_idx on public.orders (customer_id, created_at desc);
create index orders_address_id_customer_id_idx on public.orders (address_id, customer_id);
create index orders_crew_id_slot_start_at_idx on public.orders (crew_id, slot_start_at);
create index orders_slot_id_service_date_idx on public.orders (slot_id, service_date);
-- Admin lists by day and status (A1, A2).
create index orders_slot_start_at_idx on public.orders (slot_start_at);
create index orders_status_idx on public.orders (status);

create trigger orders_set_updated_at
before update on public.orders
for each row execute function private.set_updated_at();

-- Order status reaches open screens (Home cards, Orders, N4) through Realtime,
-- which applies the select policy below to each subscriber.
alter publication supabase_realtime add table public.orders;

-- Places held ------------------------------------------------------------------

create table public.slot_bookings (
  service_date date not null,
  slot_id bigint not null references public.slots (id),
  seat smallint not null check (seat >= 1),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Two orders can't hold the same place, even when booked at the same
  -- moment (spec §6).
  primary key (service_date, slot_id, seat)
);

alter table public.slot_bookings enable row level security;

create index slot_bookings_slot_id_idx on public.slot_bookings (slot_id);

-- Lines ------------------------------------------------------------------------

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  tank_id uuid references public.tanks (id) on delete set null,
  tank_type public.tank_type not null,
  size public.tank_size not null,
  qty smallint not null check (qty between 1 and 20),
  -- The price list's price when booked.
  unit_price_iqd integer not null check (unit_price_iqd >= 0),
  constraint order_items_order_tank_key unique (order_id, tank_id)
);

alter table public.order_items enable row level security;

create index order_items_tank_id_idx on public.order_items (tank_id);

-- Events ------------------------------------------------------------------------

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  -- Null for the booking itself.
  from_status public.order_status,
  to_status public.order_status not null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_role public.app_role,
  -- The customer's choice on the N6 cancel sheet.
  cancel_reason public.cancel_reason,
  is_override boolean not null default false,
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  -- Target of the order_event_notes (event_id, order_id) foreign key.
  constraint order_events_id_order_key unique (id, order_id)
);

alter table public.order_events enable row level security;

create index order_events_order_id_idx on public.order_events (order_id);
create index order_events_actor_id_idx on public.order_events (actor_id);

-- Staff notes ------------------------------------------------------------------

-- The reason staff give with an event: an admin's cancel reason, a no-show
-- note, an override reason. Internal: never shown to the customer.
create table public.order_event_notes (
  event_id bigint primary key,
  order_id uuid not null,
  note text not null check (char_length(note) between 1 and 500 and note = btrim(note)),
  created_at timestamptz not null default now(),
  -- The note's order is its event's order, so the crew policy below can't be
  -- pointed at the wrong order.
  foreign key (event_id, order_id) references public.order_events (id, order_id) on delete cascade
);

alter table public.order_event_notes enable row level security;

create index order_event_notes_order_id_idx on public.order_event_notes (order_id);

-- Media --------------------------------------------------------------------------

create table public.order_media (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kind public.order_media_kind not null,
  media_type public.media_type not null,
  -- Object name in the order-media bucket.
  path text not null unique check (char_length(path) between 1 and 300),
  bytes bigint not null check (bytes between 1 and 104857600),
  -- Videos only, 60 s at most (spec §5.10, C3b).
  duration_s numeric(4, 1) check (duration_s between 0 and 60),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_media_duration_for_video check ((media_type = 'video') = (duration_s is not null))
);

alter table public.order_media enable row level security;

create index order_media_order_id_idx on public.order_media (order_id);
create index order_media_uploaded_by_idx on public.order_media (uploaded_by);

-- Access ---------------------------------------------------------------------------
--
-- Select only. The child tables reuse the orders policy through a subquery,
-- which RLS on orders filters.

revoke all on public.orders from anon, authenticated;
revoke all on sequence public.orders_number_seq from anon, authenticated;
grant select on public.orders to authenticated;

create policy "Customers read their orders; crews their assigned orders; admins all"
on public.orders
for select
to authenticated
using (
  customer_id = (select auth.uid())
  or crew_id = (select private.current_crew_id())
  or (select private.is_admin())
);

revoke all on public.order_items from anon, authenticated;
revoke all on sequence public.order_items_id_seq from anon, authenticated;
grant select on public.order_items to authenticated;

create policy "Order lines are read with their order"
on public.order_items
for select
to authenticated
using (exists (select 1 from public.orders as o where o.id = order_id));

revoke all on public.order_events from anon, authenticated;
revoke all on sequence public.order_events_id_seq from anon, authenticated;
grant select on public.order_events to authenticated;

create policy "Order events are read with their order"
on public.order_events
for select
to authenticated
using (exists (select 1 from public.orders as o where o.id = order_id));

revoke all on public.order_event_notes from anon, authenticated;
grant select on public.order_event_notes to authenticated;

create policy "Admins and the assigned crew read staff notes; customers never do"
on public.order_event_notes
for select
to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1 from public.orders as o
    where o.id = order_id and o.crew_id = (select private.current_crew_id())
  )
);

revoke all on public.order_media from anon, authenticated;
grant select on public.order_media to authenticated;

create policy "Order media is read with its order"
on public.order_media
for select
to authenticated
using (exists (select 1 from public.orders as o where o.id = order_id));

revoke all on public.slot_bookings from anon, authenticated;
grant select on public.slot_bookings to authenticated;

create policy "Admins read slot bookings"
on public.slot_bookings
for select
to authenticated
using ((select private.is_admin()));

-- delete_address: refused while an active order uses the address (N2) ----------------

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
