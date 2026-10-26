-- Live job (spec §5.13 Tracking, §5.14 Job progress, §6, §7, §8.1 GPS rule,
-- §8.2 A3 live map; Phase 3 task 2 part C and Phase 4 task 1).
--
-- 1. crew_live_location: the crew phone's latest position for a job on the
--    way, one row per order. The crew app sends it at most every 15 s through
--    share_crew_location(); the customer's Tracking screen and the admin
--    live map read it through Realtime. Departures from §7:
--    - lat/lng columns with a generated `location` point (as on addresses),
--      so the app never handles PostGIS binary;
--    - updated_at is the server's time, never the phone's, so "last update
--      X seconds ago" and the 2-minute stale rule don't depend on the
--      phone's clock.
--    Reads: the customer only while the order is on the way and the row is
--    from the crew now assigned (an admin can give a job on the way to
--    another crew; the old crew's position must not show); the assigned
--    crew; admins. Nobody writes the table directly.
--    Rows are not deleted when the crew arrives: Realtime sends DELETE events
--    to every subscriber of a table, whatever RLS says, so live screens
--    would learn other orders' ids. The policy hides the row from the
--    customer instead, and a nightly job deletes rows of orders no longer on
--    the way 24 h after their last update (settled Oct 26, 2026).
--
-- 2. share_crew_location(order_id, lat, lng, accuracy_m): the only writer.
--    The assigned, active crew, while the order is on_the_way (new error
--    ZL024 location_not_allowed); others get P0002 order_not_found, other
--    roles 42501. A call less than 10 s after the last saved position from
--    the same crew writes nothing and returns false, so a phone that sends
--    too often can't flood Realtime.
--
-- 3. order_media joins the Realtime publication, so Job progress shows the
--    crew's photos and clips as they are attached. Screens subscribe to
--    INSERT only (removals arrive with the next page load), for the same
--    reason as above.

-- crew_live_location --------------------------------------------------------------------

create table public.crew_live_location (
  order_id uuid primary key references public.orders (id) on delete cascade,
  crew_id uuid not null references public.crews (id),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  location extensions.geography(point, 4326) generated always as (
    extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
  ) stored,
  -- Metres, as the phone reports it (rounded).
  accuracy_m integer not null check (accuracy_m between 0 and 100000),
  updated_at timestamptz not null default now()
);

alter table public.crew_live_location enable row level security;

create index crew_live_location_crew_id_idx on public.crew_live_location (crew_id);

create trigger crew_live_location_set_updated_at
before update on public.crew_live_location
for each row execute function private.set_updated_at();

revoke all on public.crew_live_location from anon, authenticated;
grant select on public.crew_live_location to authenticated;

create policy "Customers read the position on the way; the assigned crew and admins read it"
on public.crew_live_location
for select
to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1 from public.orders as o
    where o.id = crew_live_location.order_id
      -- Qualified: a bare crew_id here would be the order's own.
      and o.crew_id = crew_live_location.crew_id
      and (
        (o.customer_id = (select auth.uid()) and o.status = 'on_the_way')
        or o.crew_id = (select private.current_crew_id())
      )
  )
);

alter publication supabase_realtime add table public.crew_live_location;
alter publication supabase_realtime add table public.order_media;

-- share_crew_location ---------------------------------------------------------------------

create function public.share_crew_location(
  p_order_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crew_id uuid := (select private.current_crew_id());
  v_order public.orders;
  v_saved boolean;
begin
  if (select auth.uid()) is null
    or (select private.current_user_role()) is distinct from 'crew'
  then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_lat is null or p_lng is null or p_accuracy_m is null
    or p_lat not between -90 and 90
    or p_lng not between -180 and 180
    or p_accuracy_m not between 0 and 100000
  then
    raise exception using errcode = '22023', message = 'invalid_location';
  end if;

  -- Shares the lock transition_order takes, so a position never lands after
  -- the crew's own "arrived" has committed.
  select * into v_order from public.orders as o where o.id = p_order_id for share;
  if not found or v_crew_id is null or v_order.crew_id is distinct from v_crew_id then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;
  if v_order.status <> 'on_the_way' then
    raise exception using errcode = 'ZL024', message = 'location_not_allowed';
  end if;

  insert into public.crew_live_location as l (order_id, crew_id, lat, lng, accuracy_m, updated_at)
  values (p_order_id, v_crew_id, p_lat, p_lng, round(p_accuracy_m)::integer, now())
  on conflict (order_id) do update
  set
    crew_id = excluded.crew_id,
    lat = excluded.lat,
    lng = excluded.lng,
    accuracy_m = excluded.accuracy_m,
    updated_at = excluded.updated_at
  -- At most one position per 10 s from the same crew; a new crew writes at once.
  where l.crew_id <> excluded.crew_id or l.updated_at <= now() - interval '10 seconds'
  returning true into v_saved;

  return coalesce(v_saved, false);
end;
$$;

revoke execute on function public.share_crew_location(uuid, double precision, double precision, double precision)
from public, anon;
grant execute on function public.share_crew_location(uuid, double precision, double precision, double precision)
to authenticated;

-- Nightly purge ---------------------------------------------------------------------------

-- Positions of jobs no longer on the way, 24 h after the last update.
create function private.purge_live_locations()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.crew_live_location as l
    where l.updated_at < now() - interval '24 hours'
      and not exists (
        select 1 from public.orders as o where o.id = l.order_id and o.status = 'on_the_way'
      )
    returning 1
  )
  select count(*)::integer from gone;
$$;

-- Daily at 00:27 UTC (03:27 Baghdad), between the two media-cleanup jobs.
select cron.schedule('purge-live-locations', '27 0 * * *', $$select private.purge_live_locations()$$);

revoke execute on all functions in schema private from public;
