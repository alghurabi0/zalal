-- settings (spec §7, A13): one typed row with the spec defaults. Everyone,
-- guests included, can read it (Login needs sms_enabled). Only the server
-- writes it until Phase 3 adds audited admin RPCs.
begin;
\ir _helpers.psql

select plan(21);

select tests.create_user('+9647801111111');
select tests.create_user('+9647703333333', 'crew');
select tests.create_user('+9647504444444', 'admin');

-- Shape and defaults ----------------------------------------------------

select has_table('public', 'settings', 'settings exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.settings'::regclass),
  'settings has RLS enabled'
);

select is((select count(*)::int from public.settings), 1, 'settings has exactly one row');

select results_eq(
  $$ select sms_enabled, cleaning_interval_months, booking_window_days,
            cancel_cutoff_hours, max_tanks_per_order, maintenance_mode,
            min_app_version
     from public.settings $$,
  $$ values (true, 6::smallint, 14::smallint, 2::smallint, 6::smallint, false, '0.0.0'::text) $$,
  'settings start with the spec defaults'
);

select results_eq(
  $$ select working_hours_start, working_hours_end, working_days
     from public.settings $$,
  $$ values ('09:00'::time, '21:00'::time, array[0, 1, 2, 3, 4, 6]::smallint[]) $$,
  'support hours default to 9 AM to 9 PM, Saturday to Thursday'
);

select throws_ok(
  $$ insert into public.settings default values $$,
  '23505',
  null,
  'a second settings row is refused'
);

select throws_ok(
  $$ update public.settings set cancel_cutoff_hours = -1 $$,
  '23514',
  null,
  'a negative cancel cutoff is refused'
);

select throws_ok(
  $$ update public.settings set working_days = array[7]::smallint[] $$,
  '23514',
  null,
  'a weekday outside 0-6 is refused'
);

select throws_ok(
  $$ update public.settings set working_hours_start = '22:00' $$,
  '23514',
  null,
  'support hours that end before they start are refused'
);

select throws_ok(
  $$ update public.settings set company_phone = '0780 123 4567' $$,
  '23514',
  null,
  'a company phone that is not E.164 is refused'
);

select throws_ok(
  $$ update public.settings set min_app_version = 'v1' $$,
  '23514',
  null,
  'a min_app_version that is not x.y.z is refused'
);

-- Reads ----------------------------------------------------------------

select tests.authenticate_as_anon();
select is((select sms_enabled from public.settings), true, 'anon can read settings');
select throws_ok(
  $$ update public.settings set sms_enabled = false $$,
  '42501', null, 'anon cannot update settings'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select is((select count(*)::int from public.settings), 1, 'a customer can read settings');
select throws_ok(
  $$ update public.settings set sms_enabled = false $$,
  '42501', null, 'a customer cannot update settings'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is((select count(*)::int from public.settings), 1, 'a crew can read settings');
select throws_ok(
  $$ update public.settings set sms_enabled = false $$,
  '42501', null, 'a crew cannot update settings'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.settings), 1, 'an admin can read settings');
select throws_ok(
  $$ update public.settings set sms_enabled = false $$,
  '42501', null, 'an admin cannot update settings directly (Phase 3 adds audited RPCs)'
);
select throws_ok(
  $$ delete from public.settings $$,
  '42501', null, 'an admin cannot delete settings'
);

-- Server ---------------------------------------------------------------

select tests.authenticate_as_service_role();
select lives_ok(
  $$ update public.settings set sms_enabled = false $$,
  'the service role can turn SMS off'
);

select * from finish();
rollback;
