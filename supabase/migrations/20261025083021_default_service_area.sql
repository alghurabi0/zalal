-- A placeholder Karbala service area in every environment (spec §5.4, §7,
-- §10.2).
--
-- Why: the area lived only in seed.sql, which local resets load but hosted
-- projects never do (the deploy runs `supabase db push`, migrations only).
-- So dev and prod had no service area, and every address was refused as
-- outside Karbala. Like the settings row, the starting area now comes from a
-- migration.
--
-- The area has two parts:
-- 1. Karbala city with Al-Hurr, Al-Hussainiya (east and northeast of the
--    city, toward the Euphrates), the Karbala–Hindiya road and Hindiya
--    (Tuwairij) town, about 32.49–32.75 N, 43.93–44.26 E. It stops short of
--    Al-Musayyib (Babil, 32.78 N 44.29 E).
-- 2. Ain al-Tamr, about 67 km west, as its own box (32.52–32.62 N,
--    43.43–43.55 E). The desert and Razzaza Lake in between are left out.
-- It is a generous approximation, not the governorate's legal boundary. The
-- real polygon is drawn in the A13 editor before launch (spec §12.4).
--
-- Inserted only when the project has no area yet, or when its only area is
-- still the old seed rectangle (43.95–44.10 E, 32.53–32.68 N, which the owner
-- may have added by hand on dev). An area drawn by an admin is never touched.

with old_rectangle as (
  select extensions.st_geomfromewkt(
    'SRID=4326;MULTIPOLYGON(((43.95 32.53, 44.10 32.53, 44.10 32.68, 43.95 32.68, 43.95 32.53)))'
  ) as geom
),
placeholder as (
  select 'SRID=4326;MULTIPOLYGON('
    || '((43.93 32.55, 44.00 32.52, 44.15 32.49, 44.26 32.52, 44.25 32.62, '
    || '44.20 32.72, 44.05 32.75, 43.93 32.70, 43.93 32.55)),'
    || '((43.43 32.52, 43.55 32.52, 43.55 32.62, 43.43 32.62, 43.43 32.52))'
    || ')' as ewkt
),
upgraded as (
  update public.service_areas as a
  set area = (select ewkt from placeholder)::extensions.geography
  where (select count(*) from public.service_areas) = 1
    and extensions.st_equals(a.area::extensions.geometry, (select geom from old_rectangle))
  returning a.id
)
insert into public.service_areas (name, area)
select 'كربلاء', (select ewkt from placeholder)::extensions.geography
where not exists (select 1 from public.service_areas)
  and not exists (select 1 from upgraded);
