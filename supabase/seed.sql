-- Local and dev seed data (spec §10.2). Never loaded into prod.
-- `supabase db reset` runs this after the migrations. Each phase adds the seed
-- rows for its own tables (prices, slots, service area, articles, ...).
-- The settings row comes from its migration, so prod has it too.

-- Service area: a placeholder rectangle around Karbala city (about 32.53–32.68 N,
-- 43.95–44.10 E). The real polygon is drawn in A13 before launch.
insert into public.service_areas (name, area)
values (
  'كربلاء',
  'SRID=4326;MULTIPOLYGON(((43.95 32.53, 44.10 32.53, 44.10 32.68, 43.95 32.68, 43.95 32.53)))'
);
