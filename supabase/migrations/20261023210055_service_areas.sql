-- Service areas (spec §7, §9.3, decision 6-7): addresses outside every active
-- area are refused. Karbala's real polygon is drawn in the A13 editor before
-- launch; the local seed has a placeholder rectangle.
--
-- Departures from spec §7: `area` is a MultiPolygon, so an area can have
-- separate parts, and `active` lets admins switch one off without losing it.
-- Inactive areas are visible to admins only.

create table public.service_areas (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 2 and 60 and name = btrim(name)),
  area extensions.geography(multipolygon, 4326) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.service_areas enable row level security;

create index service_areas_area_idx on public.service_areas using gist (area);

create trigger service_areas_set_updated_at
before update on public.service_areas
for each row execute function private.set_updated_at();

-- True when the point is inside (or on the edge of) an active area. The
-- addresses trigger enforces it on save; the Location screen can call it
-- first to warn while the pin moves.
create function public.in_service_area(p_lat double precision, p_lng double precision)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.service_areas as a
    where a.active
      and extensions.st_covers(
        a.area,
        extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
      )
  );
$$;

grant execute on function public.in_service_area(double precision, double precision)
to anon, authenticated, service_role;

-- Writes come with the A13 map editor (Phase 3), through an audited RPC.
revoke all on public.service_areas from anon, authenticated;
revoke all on sequence public.service_areas_id_seq from anon, authenticated;
grant select on public.service_areas to anon, authenticated;

create policy "Everyone reads active service areas"
on public.service_areas
for select
to anon, authenticated
using (active);

create policy "Admins read every service area"
on public.service_areas
for select
to authenticated
using ((select private.is_admin()));
