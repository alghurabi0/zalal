-- The placeholder Karbala service area that ships with the migrations
-- (migration default_service_area, spec §7, §10.2). Hosted projects never
-- load seed.sql, so without it every address was refused. It covers Karbala
-- city, Al-Hurr, Al-Hussainiya, the Karbala–Hindiya road and Hindiya town,
-- plus Ain al-Tamr as a separate part. The real polygon is drawn in A13
-- before launch (spec §12.4).
begin;
\ir _helpers.psql

select plan(13);

select is(
  (select count(*)::int from public.service_areas where active),
  1,
  'one active area ships with the migrations'
);

select is(
  (select extensions.st_numgeometries(area::extensions.geometry) from public.service_areas),
  2,
  'it has two parts: the city with its eastern towns, and Ain al-Tamr'
);

-- Inside (lat, lng).
select ok(public.in_service_area(32.6165, 44.0324), 'Karbala city center (the shrine)');
select ok(public.in_service_area(32.5500, 43.9600), 'the southwest edge of the city');
select ok(public.in_service_area(32.6800, 44.1200), 'Al-Hussainiya, northeast of the city');
select ok(public.in_service_area(32.5800, 44.1200), 'the Karbala–Hindiya road, halfway');
select ok(public.in_service_area(32.5440, 44.2200), 'Hindiya (Tuwairij) town');
select ok(public.in_service_area(32.5670, 43.4890), 'Ain al-Tamr town');

-- Outside.
select ok(not public.in_service_area(33.3150, 44.3660), 'Baghdad');
select ok(not public.in_service_area(32.7790, 44.2900), 'Al-Musayyib (Babil)');
select ok(not public.in_service_area(32.0300, 44.3300), 'Najaf');
select ok(not public.in_service_area(32.6000, 43.7000), 'the desert between the city and Ain al-Tamr');
select ok(not public.in_service_area(32.6800, 43.6500), 'Razzaza Lake');

select * from finish();
rollback;
