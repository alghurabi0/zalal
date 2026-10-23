begin;
\ir _helpers.psql

select plan(4);

select is(
  (select extnamespace::regnamespace::text from pg_extension where extname = 'postgis'),
  'extensions',
  'postgis is installed in the extensions schema'
);

select has_extension('pg_cron', 'pg_cron is installed');

select has_extension('pg_net', 'pg_net is installed');

-- Guards against PostGIS leaking into the public API through the public schema.
select hasnt_table('public', 'spatial_ref_sys', 'spatial_ref_sys is not in public');

select * from finish();
rollback;
