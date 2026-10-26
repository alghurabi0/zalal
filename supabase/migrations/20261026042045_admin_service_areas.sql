-- The A13 service-area editor (spec §8.2, §7, §5.4; Phase 3 task 1 part B).
--
-- - admin_service_areas(): every area with its shape as GeoJSON (longitude
--   first), so the app never handles PostGIS binary.
-- - admin_save_service_area(id, name, area, active): adds (id null) or
--   changes an area. Audited ('service_area.create' / '.update', with the
--   old and new shape when it changed). Areas are switched off, never
--   deleted, like slots.
-- - admin_addresses_outside_area(): how many saved addresses are outside
--   every active area. Shrinking an area never changes addresses;
--   create_order() already refuses a booking at an address outside
--   (ZL001), so the editor shows the count and the admin follows up.
--
-- New error codes: ZL016 invalid_area (not a Polygon or MultiPolygon,
-- empty, invalid such as self-intersecting, more than 5,000 points, or
-- outside Iraq's bounding box, which also catches swapped lat/lng); ZL017
-- last_active_area (with no active area every address and booking would be
-- refused).
--
-- Departures from spec §7: none.

-- The stored shape for GeoJSON from the editor, or ZL016.
create function private.service_area_shape(p_area jsonb)
returns extensions.geography
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_geom extensions.geometry;
begin
  if p_area is null
    or jsonb_typeof(p_area) <> 'object'
    or coalesce(p_area ->> 'type', '') not in ('Polygon', 'MultiPolygon')
  then
    raise exception using errcode = 'ZL016', message = 'invalid_area';
  end if;

  begin
    v_geom := extensions.st_multi(
      extensions.st_force2d(
        extensions.st_setsrid(extensions.st_geomfromgeojson(p_area::text), 4326)
      )
    );
  exception when others then
    raise exception using errcode = 'ZL016', message = 'invalid_area';
  end;

  if extensions.st_isempty(v_geom)
    or extensions.st_npoints(v_geom) > 5000
    or not extensions.st_isvalid(v_geom)
    -- Iraq, generously: 38.7-48.8 E, 29.0-37.4 N.
    or not extensions.st_coveredby(v_geom, extensions.st_makeenvelope(38.7, 29.0, 48.8, 37.4, 4326))
  then
    raise exception using errcode = 'ZL016', message = 'invalid_area';
  end if;

  return v_geom::extensions.geography;
end;
$$;

-- Security invoker: admins read every area and every address already.
create function public.admin_service_areas()
returns table (id bigint, name text, active boolean, area jsonb, updated_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  return query
  select a.id, a.name, a.active, extensions.st_asgeojson(a.area)::jsonb, a.updated_at
  from public.service_areas as a
  order by a.active desc, a.id;
end;
$$;

create function public.admin_addresses_outside_area()
returns integer
language plpgsql
stable
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  return (
    select count(*)::integer
    from public.addresses as ad
    where ad.deleted_at is null
      and not exists (
        select 1
        from public.service_areas as a
        where a.active and extensions.st_covers(a.area, ad.location)
      )
  );
end;
$$;

create function public.admin_save_service_area(
  p_id bigint,
  p_name text,
  p_area jsonb,
  p_active boolean,
  out area_id bigint,
  out addresses_outside integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_area extensions.geography;
  v_old public.service_areas;
  v_diff jsonb := '{}';
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  v_area := private.service_area_shape(p_area);

  -- One area change at a time, so two admins can't each switch off one of
  -- the last two active areas.
  perform 1 from public.service_areas for update;

  if p_id is null then
    insert into public.service_areas (name, area, active)
    values (p_name, v_area, p_active)
    returning id into area_id;

    perform private.log_admin_action(
      'service_area.create', 'service_areas', area_id::text,
      jsonb_build_object(
        'name', p_name, 'active', p_active, 'area', extensions.st_asgeojson(v_area)::jsonb
      )
    );
  else
    select * into v_old from public.service_areas as a where a.id = p_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'service_area_not_found';
    end if;

    if v_old.active and not p_active and not exists (
      select 1 from public.service_areas as a where a.active and a.id <> p_id
    ) then
      raise exception using errcode = 'ZL017', message = 'last_active_area';
    end if;

    if v_old.name is distinct from p_name then
      v_diff := v_diff || jsonb_build_object('name', jsonb_build_object('from', v_old.name, 'to', p_name));
    end if;
    if v_old.active is distinct from p_active then
      v_diff := v_diff || jsonb_build_object('active', jsonb_build_object('from', v_old.active, 'to', p_active));
    end if;
    if not extensions.st_equals(v_old.area::extensions.geometry, v_area::extensions.geometry) then
      v_diff := v_diff || jsonb_build_object('area', jsonb_build_object(
        'from', extensions.st_asgeojson(v_old.area)::jsonb,
        'to', extensions.st_asgeojson(v_area)::jsonb
      ));
    end if;

    if v_diff <> '{}' then
      update public.service_areas as a
      set name = p_name, area = v_area, active = p_active
      where a.id = p_id;
      perform private.log_admin_action('service_area.update', 'service_areas', p_id::text, v_diff);
    end if;
    area_id := p_id;
  end if;

  addresses_outside := public.admin_addresses_outside_area();
end;
$$;

revoke execute on function public.admin_service_areas() from public, anon;
grant execute on function public.admin_service_areas() to authenticated;
revoke execute on function public.admin_addresses_outside_area() from public, anon;
grant execute on function public.admin_addresses_outside_area() to authenticated;
revoke execute on function public.admin_save_service_area(bigint, text, jsonb, boolean) from public, anon;
grant execute on function public.admin_save_service_area(bigint, text, jsonb, boolean) to authenticated;

revoke execute on all functions in schema private from public;
