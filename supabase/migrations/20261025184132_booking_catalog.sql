-- Prices, slots and blocked dates (spec §5.9, §7, §10.2; A8, A9).
--
-- Departures from spec §7:
-- - price_list has no updated_by. Every admin write goes to admin_audit_log
--   (Phase 3), which already records who changed what and when.
-- - slots have no label column. The app builds "8–10 الصبح" from the start
--   and end times, so the database holds no Arabic copy and a label can't
--   drift from the times it describes. Two slots can't share the same times.
-- - "seat ≤ capacity" is not a table constraint: create_order() and
--   transition_order() take a place only below the current capacity. So
--   lowering a capacity never breaks bookings that already exist.
--
-- Reads: everyone reads prices (guests see the price card on Home) and
-- active slots. Blocked dates are read by admins only; customers learn about
-- them, and about free places, through booking_availability(). Writes come in
-- Phase 3 as audited admin RPCs (A8, A9); until then the owner uses SQL.
--
-- The starting prices and slots are inserted here, not in seed.sql, because
-- hosted projects never load the seed (spec §10.2). Each insert skips itself
-- when rows already exist.

-- Prices ---------------------------------------------------------------------

create table public.price_list (
  tank_type public.tank_type not null,
  size public.tank_size not null,
  price_iqd integer not null check (price_iqd between 1 and 10000000),
  updated_at timestamptz not null default now(),
  primary key (tank_type, size)
);

alter table public.price_list enable row level security;

create trigger price_list_set_updated_at
before update on public.price_list
for each row execute function private.set_updated_at();

-- The Booking design's prices (spec §10.2).
insert into public.price_list (tank_type, size, price_iqd)
values
  ('roof', 's', 25000), ('roof', 'm', 35000), ('roof', 'l', 50000),
  ('ground', 's', 60000), ('ground', 'm', 80000), ('ground', 'l', 120000)
on conflict (tank_type, size) do nothing;

revoke all on public.price_list from anon, authenticated;
grant select on public.price_list to anon, authenticated;

create policy "Everyone reads prices"
on public.price_list
for select
to anon, authenticated
using (true);

-- Slots ------------------------------------------------------------------------

create table public.slots (
  id bigint generated always as identity primary key,
  -- Baghdad time.
  start_time time not null,
  end_time time not null,
  capacity smallint not null check (capacity between 1 and 20),
  -- extract(dow): 0 = Sunday … 6 = Saturday, as in settings.working_days.
  weekdays smallint[] not null check (
    cardinality(weekdays) > 0 and weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]
  ),
  -- Slots are switched off, never deleted: orders reference them.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slots_times_order check (start_time < end_time),
  constraint slots_times_key unique (start_time, end_time)
);

alter table public.slots enable row level security;

create trigger slots_set_updated_at
before update on public.slots
for each row execute function private.set_updated_at();

-- 8–10 الصبح, 10–12 الظهر, 4–6 العصر, 2 places each, Saturday to Thursday
-- (spec §10.2; capacity and days settled with the owner on Oct 25, 2026).
insert into public.slots (start_time, end_time, capacity, weekdays)
select v.start_time, v.end_time, 2, '{0,1,2,3,4,6}'
from (
  values ('08:00'::time, '10:00'::time), ('10:00', '12:00'), ('16:00', '18:00')
) as v (start_time, end_time)
where not exists (select 1 from public.slots);

revoke all on public.slots from anon, authenticated;
revoke all on sequence public.slots_id_seq from anon, authenticated;
grant select on public.slots to anon, authenticated;

create policy "Everyone reads active slots"
on public.slots
for select
to anon, authenticated
using (active);

create policy "Admins read every slot"
on public.slots
for select
to authenticated
using ((select private.is_admin()));

-- Blocked dates ------------------------------------------------------------------

-- Holidays such as Arbaeen and Ashura: no slot can be booked that day.
create table public.blocked_dates (
  date date primary key,
  reason text check (
    reason is null or (char_length(reason) between 2 and 100 and reason = btrim(reason))
  ),
  created_at timestamptz not null default now()
);

alter table public.blocked_dates enable row level security;

revoke all on public.blocked_dates from anon, authenticated;
grant select on public.blocked_dates to authenticated;

create policy "Admins read blocked dates"
on public.blocked_dates
for select
to authenticated
using ((select private.is_admin()));
