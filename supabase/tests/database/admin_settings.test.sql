-- admin_update_settings(patch) (spec §8.2 A13, §7) and the sterilant_text
-- setting (Phase 3, for the crew finish form C4). Admins only (42501 for
-- everyone else; guests can't call it). The patch names only the settings to
-- change; an unknown key or a server-owned one (id, updated_at) is 22023
-- unknown_setting, and something other than an object is 22023
-- invalid_settings. The table's checks still apply (23514, 23502 for null).
-- Each save that changes something is logged as 'settings.update' with the
-- old and new value of each changed setting; a save that changes nothing
-- logs nothing. Everyone still reads the row; nobody writes it directly.
begin;
\ir _helpers.psql

select plan(24);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

update public.settings
set sms_enabled = true, booking_window_days = 14, cancel_cutoff_hours = 2,
    working_days = '{0,1,2,3,4,6}', company_phone = null, sterilant_text = '';

create function tests.audit_rows() returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = 'settings.update' $$;

grant execute on all functions in schema tests to anon, authenticated;

-- The new setting ----------------------------------------------------------------

select col_not_null('public', 'settings', 'sterilant_text', 'sterilant_text is required');
select col_default_is('public', 'settings', 'sterilant_text', '', 'sterilant_text starts empty');
select throws_ok(
  $$ update public.settings set sterilant_text = ' كلور' $$,
  '23514', null, 'sterilant_text is trimmed'
);
select throws_ok(
  $$ update public.settings set sterilant_text = repeat('a', 101) $$,
  '23514', null, 'sterilant_text is at most 100 characters'
);

-- Everyone but admins ------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_update_settings('{"sms_enabled": false}') $$,
  '42501', null, 'a guest cannot change settings'
);
select is((select sterilant_text from public.settings), '', 'a guest reads sterilant_text');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_update_settings('{"sms_enabled": false}') $$,
  '42501', 'not_allowed', 'a customer cannot change settings'
);
select throws_ok(
  $$ update public.settings set sms_enabled = false $$,
  '42501', null, 'a customer cannot update the row directly'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select public.admin_update_settings('{"cancel_cutoff_hours": 0}') $$,
  '42501', 'not_allowed', 'another customer cannot change settings'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_update_settings('{"sterilant_text": "كلور"}') $$,
  '42501', 'not_allowed', 'a crew cannot change settings'
);
select is((select sterilant_text from public.settings), '', 'a crew reads sterilant_text');

select tests.clear_authentication();
select is((select sms_enabled from public.settings), true, 'nothing changed for the refused callers');

-- Admin ----------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select throws_ok(
  $$ update public.settings set sms_enabled = false $$,
  '42501', null, 'an admin cannot update the row directly either'
);
select lives_ok(
  $$ select public.admin_update_settings(
       '{"sms_enabled": false, "booking_window_days": 14, "working_days": [5, 6],
         "company_phone": "+9647801234567", "sterilant_text": "كلور 70%",
         "working_hours_start": "08:30"}') $$,
  'an admin changes several settings at once'
);
select results_eq(
  $$ select sms_enabled, booking_window_days, working_days, company_phone, sterilant_text, working_hours_start
     from public.settings $$,
  $$ values (false, 14::smallint, '{5,6}'::smallint[], '+9647801234567'::text, 'كلور 70%'::text, '08:30'::time) $$,
  'the settings are saved'
);
select results_eq(
  $$ select admin_id, entity, entity_id, diff from public.admin_audit_log where action = 'settings.update' $$,
  $$ values (
       tests.user_id('+9647504444444'), 'settings', 'settings',
       '{"sms_enabled": {"from": true, "to": false},
         "working_days": {"from": [0, 1, 2, 3, 4, 6], "to": [5, 6]},
         "company_phone": {"from": null, "to": "+9647801234567"},
         "sterilant_text": {"from": "", "to": "كلور 70%"},
         "working_hours_start": {"from": "09:00:00", "to": "08:30:00"}}'::jsonb
     ) $$,
  'only the changed settings are logged, with old and new values'
);
select lives_ok(
  $$ select public.admin_update_settings('{"company_phone": null}') $$,
  'an admin clears the company phone'
);
select lives_ok(
  $$ select public.admin_update_settings('{"company_phone": null, "sms_enabled": false}') $$,
  'saving the same values again works'
);
select is(tests.audit_rows(), 2, 'and logs nothing');

select throws_ok(
  $$ select public.admin_update_settings('{"cancel_cutoff_hours": 99}') $$,
  '23514', null, 'a value the table refuses is refused'
);
select throws_ok(
  $$ select public.admin_update_settings('{"sms_enabled": null}') $$,
  '23502', null, 'null for a required setting is refused'
);
select throws_ok(
  $$ select public.admin_update_settings('{"id": false}') $$,
  '22023', 'unknown_setting', 'the row key cannot be changed'
);
select throws_ok(
  $$ select public.admin_update_settings('{"sms_enabled": true, "colour": "red"}') $$,
  '22023', 'unknown_setting', 'an unknown setting is refused, with the rest of the patch'
);
select throws_ok(
  $$ select public.admin_update_settings('[1]') $$,
  '22023', 'invalid_settings', 'something other than an object is refused'
);

select * from finish();
rollback;
