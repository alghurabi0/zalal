-- The A13 service-area editor (spec §8.2, §7, §5.4):
-- - admin_service_areas(): every area (active or not) with its shape as
--   GeoJSON, so the app never handles PostGIS binary.
-- - admin_save_service_area(id, name, area, active): adds an area (id null)
--   or changes one. The shape is GeoJSON, a Polygon (stored as a
--   MultiPolygon) or a MultiPolygon. ZL016 invalid_area when it isn't one,
--   is empty or invalid (self-intersecting), has more than 5,000 points, or
--   lies outside Iraq (which catches swapped lat/lng). ZL017
--   last_active_area when the change would leave no active area. P0002
--   service_area_not_found for an unknown id. Logged as
--   'service_area.create' / 'service_area.update' (changed fields only).
--   Returns the area id and how many saved addresses are now outside every
--   active area; addresses are never changed.
-- - admin_addresses_outside_area(): that count on its own.
-- All three are admins only (42501 for everyone else; guests can't call
-- them). Nobody writes the table directly.
begin;
\ir _helpers.psql

select plan(29);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

delete from public.service_areas;
insert into public.service_areas (name, area)
values ('Test Karbala', 'SRID=4326;MULTIPOLYGON(((43.9 32.5, 44.1 32.5, 44.1 32.7, 43.9 32.7, 43.9 32.5)))');
create function tests.karbala() returns bigint language sql stable security definer
as $$ select id from public.service_areas where name = 'Test Karbala' $$;

-- Both addresses are at 32.616 N, 44.024 E, inside Test Karbala.
select tests.create_address(tests.user_id('+9647801111111'));
select tests.create_address(tests.user_id('+9647802222222'));

-- A box around Hindiya (no address there), and one of its shapes as GeoJSON.
create function tests.hindiya() returns jsonb language sql immutable
as $$ select '{"type": "Polygon", "coordinates": [[[44.2, 32.5], [44.3, 32.5], [44.3, 32.6], [44.2, 32.6], [44.2, 32.5]]]}'::jsonb $$;

create function tests.audit(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;

grant execute on all functions in schema tests to anon, authenticated;

-- Everyone but admins --------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.admin_service_areas() $$,
  '42501', null, 'a guest cannot list the areas'
);
select throws_ok(
  $$ select * from public.admin_save_service_area(null, 'Hindiya', tests.hindiya(), true) $$,
  '42501', null, 'a guest cannot add an area'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select * from public.admin_service_areas() $$,
  '42501', 'not_allowed', 'a customer cannot list the areas'
);
select throws_ok(
  $$ select * from public.admin_save_service_area(null, 'Hindiya', tests.hindiya(), true) $$,
  '42501', 'not_allowed', 'a customer cannot add an area'
);
select throws_ok(
  $$ select public.admin_addresses_outside_area() $$,
  '42501', 'not_allowed', 'a customer cannot count addresses outside the area'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select * from public.admin_save_service_area(tests.karbala(), 'Test Karbala', tests.hindiya(), true) $$,
  '42501', 'not_allowed', 'another customer cannot change an area'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select * from public.admin_save_service_area(tests.karbala(), 'Test Karbala', tests.hindiya(), true) $$,
  '42501', 'not_allowed', 'a crew cannot change an area'
);
select throws_ok(
  $$ select * from public.admin_service_areas() $$,
  '42501', 'not_allowed', 'a crew cannot list the areas'
);

select tests.clear_authentication();
select is((select count(*)::int from public.service_areas), 1, 'nothing was added by the refused callers');

-- Admin: read ------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select throws_ok(
  $$ insert into public.service_areas (name, area) values ('x', 'SRID=4326;MULTIPOLYGON(((44 32, 45 32, 45 33, 44 32)))') $$,
  '42501', null, 'an admin cannot insert into the table directly'
);
select results_eq(
  $$ select name, active, area -> 'type', area -> 'coordinates' -> 0 -> 0 -> 0 from public.admin_service_areas() $$,
  $$ values ('Test Karbala'::text, true, '"MultiPolygon"'::jsonb, '[43.9, 32.5]'::jsonb) $$,
  'an admin lists the areas as GeoJSON, longitude first'
);
select is(public.admin_addresses_outside_area(), 0, 'no address is outside the area yet');

-- Admin: add -------------------------------------------------------------------------

select results_eq(
  $$ select addresses_outside from public.admin_save_service_area(null, 'Hindiya', tests.hindiya(), false) $$,
  $$ values (0) $$,
  'an admin adds a switched-off area'
);
select results_eq(
  $$ select active, area -> 'type' from public.admin_service_areas() where name = 'Hindiya' $$,
  $$ values (false, '"MultiPolygon"'::jsonb) $$,
  'the polygon is stored as a MultiPolygon'
);
select results_eq(
  $$ select entity, diff ->> 'name', diff -> 'active', diff -> 'area' -> 'type' from public.admin_audit_log where action = 'service_area.create' $$,
  $$ values ('service_areas'::text, 'Hindiya'::text, 'false'::jsonb, '"MultiPolygon"'::jsonb) $$,
  'the new area is in the audit log'
);

select throws_ok(
  $$ select * from public.admin_save_service_area(null, 'Bowtie', '{"type": "Polygon", "coordinates": [[[44.0, 32.5], [44.1, 32.6], [44.1, 32.5], [44.0, 32.6], [44.0, 32.5]]]}', true) $$,
  'ZL016', 'invalid_area', 'a self-intersecting shape is refused'
);
select throws_ok(
  $$ select * from public.admin_save_service_area(null, 'Swapped', '{"type": "Polygon", "coordinates": [[[32.5, 44.2], [32.5, 44.3], [32.6, 44.3], [32.6, 44.2], [32.5, 44.2]]]}', true) $$,
  'ZL016', 'invalid_area', 'a shape outside Iraq (swapped lat/lng) is refused'
);
select throws_ok(
  $$ select * from public.admin_save_service_area(null, 'Point', '{"type": "Point", "coordinates": [44.0, 32.6]}', true) $$,
  'ZL016', 'invalid_area', 'a point is refused'
);
select throws_ok(
  $$ select * from public.admin_save_service_area(null, 'Junk', '{"type": "Polygon", "coordinates": "x"}', true) $$,
  'ZL016', 'invalid_area', 'malformed GeoJSON is refused'
);
select throws_ok(
  $$ select * from public.admin_save_service_area(
       null, 'Many points',
       jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(
         (select jsonb_agg(jsonb_build_array(44.0 + 0.1 * cos(radians(i * 360.0 / 5001)), 32.6 + 0.1 * sin(radians(i * 360.0 / 5001))) order by i)
          from generate_series(0, 5001) as i))),
       true) $$,
  'ZL016', 'invalid_area', 'more than 5,000 points is refused'
);
select throws_ok(
  $$ select * from public.admin_save_service_area(null, ' x', tests.hindiya(), true) $$,
  '23514', null, 'the name check still applies'
);

-- Admin: change ----------------------------------------------------------------------

select throws_ok(
  $$ select * from public.admin_save_service_area(tests.karbala(), 'Test Karbala', tests.hindiya(), false) $$,
  'ZL017', 'last_active_area', 'the last active area cannot be switched off'
);
select results_eq(
  $$ select addresses_outside from public.admin_save_service_area(tests.karbala(), 'Karbala', tests.hindiya(), true) $$,
  $$ values (2) $$,
  'an admin moves the area away from both addresses and is told 2 are outside'
);
select is(public.admin_addresses_outside_area(), 2, 'the count says the same');
select is(
  (select count(*)::int from public.addresses where deleted_at is null),
  2,
  'the addresses are untouched'
);
select results_eq(
  $$ select diff -> 'name', diff -> 'area' -> 'to' -> 'type', diff ? 'active'
     from public.admin_audit_log where action = 'service_area.update' $$,
  $$ values ('{"from": "Test Karbala", "to": "Karbala"}'::jsonb, '"MultiPolygon"'::jsonb, false) $$,
  'the change is logged with the old and new name and shape, not the unchanged switch'
);
select lives_ok(
  $$ select * from public.admin_save_service_area(
       (select id from public.service_areas where name = 'Hindiya'), 'Hindiya', tests.hindiya(), true) $$,
  'an admin switches the second area on'
);
select lives_ok(
  $$ select * from public.admin_save_service_area(tests.karbala(), 'Karbala', tests.hindiya(), false) $$,
  'now the first one can be switched off'
);
select throws_ok(
  $$ select * from public.admin_save_service_area(999999, 'x y', tests.hindiya(), true) $$,
  'P0002', 'service_area_not_found', 'an unknown area is refused'
);

select * from finish();
rollback;
