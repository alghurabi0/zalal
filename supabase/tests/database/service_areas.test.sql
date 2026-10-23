-- service_areas (spec §7, §9.3): Karbala polygon(s) that addresses must fall
-- inside. Everyone reads the active areas; admins also see inactive ones.
-- Only the server writes them until Phase 3 adds the A13 map editor.
begin;
\ir _helpers.psql

select plan(18);

select tests.create_user('+9647801111111');
select tests.create_user('+9647703333333', 'crew');
select tests.create_user('+9647504444444', 'admin');

-- Replace the seeded placeholder with known test areas.
delete from public.service_areas;
insert into public.service_areas (name, area, active)
values
  ('Test Karbala', 'SRID=4326;MULTIPOLYGON(((43.9 32.5, 44.1 32.5, 44.1 32.7, 43.9 32.7, 43.9 32.5)))', true),
  ('Test Baghdad (off)', 'SRID=4326;MULTIPOLYGON(((44.2 33.2, 44.5 33.2, 44.5 33.4, 44.2 33.4, 44.2 33.2)))', false);

-- Shape ------------------------------------------------------------------

select has_table('public', 'service_areas', 'service_areas exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.service_areas'::regclass),
  'service_areas has RLS enabled'
);

select has_index('public', 'service_areas', 'service_areas_area_idx', 'the area has a spatial index');

select throws_ok(
  $$ insert into public.service_areas (name, area)
     values ('x', 'SRID=4326;MULTIPOLYGON(((43.9 32.5, 44.1 32.5, 44.1 32.7, 43.9 32.5)))') $$,
  '23514',
  null,
  'a one-character name is refused'
);

-- in_service_area --------------------------------------------------------

select is(public.in_service_area(32.616, 44.024), true, 'central Karbala is inside');
select is(public.in_service_area(32.5, 43.9), true, 'a corner of the area counts as inside');
select is(public.in_service_area(32.45, 44.0), false, 'a point south of the area is outside');
select is(public.in_service_area(33.31, 44.36), false, 'a point in an inactive area is outside');

-- Anon -------------------------------------------------------------------

select tests.authenticate_as_anon();

select results_eq(
  $$ select name from public.service_areas $$,
  $$ values ('Test Karbala'::text) $$,
  'anon reads only active areas'
);

select is(public.in_service_area(32.616, 44.024), true, 'anon can call in_service_area');

select throws_ok(
  $$ insert into public.service_areas (name, area)
     values ('Hack', 'SRID=4326;MULTIPOLYGON(((0 0, 1 0, 1 1, 0 0)))') $$,
  '42501', null, 'anon cannot add an area'
);

-- Customer ---------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select results_eq(
  $$ select name from public.service_areas $$,
  $$ values ('Test Karbala'::text) $$,
  'a customer reads only active areas'
);

select throws_ok(
  $$ update public.service_areas set active = true $$,
  '42501', null, 'a customer cannot change an area'
);

select throws_ok(
  $$ delete from public.service_areas $$,
  '42501', null, 'a customer cannot delete an area'
);

-- Crew -------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));

select results_eq(
  $$ select name from public.service_areas $$,
  $$ values ('Test Karbala'::text) $$,
  'a crew reads only active areas'
);

-- Admin ------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select results_eq(
  $$ select name from public.service_areas order by name $$,
  $$ values ('Test Baghdad (off)'::text), ('Test Karbala') $$,
  'an admin reads inactive areas too'
);

select throws_ok(
  $$ update public.service_areas set active = true $$,
  '42501', null, 'an admin cannot change an area directly (Phase 3 adds audited RPCs)'
);

-- Server -----------------------------------------------------------------

select tests.authenticate_as_service_role();

select lives_ok(
  $$ update public.service_areas set active = true where name = 'Test Baghdad (off)' $$,
  'the service role can change an area'
);

select * from finish();
rollback;
