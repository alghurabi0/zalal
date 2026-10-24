-- profiles (spec §2, §7): created by a trigger on signup, one per auth user.
-- Users read their own profile and edit only full_name and reminders_enabled;
-- admins read every profile. Nobody but the server changes role or phone.
begin;
\ir _helpers.psql

select plan(37);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647703333333', 'crew');
select tests.create_user('+9647504444444', 'admin');

-- Shape ------------------------------------------------------------------

select has_table('public', 'profiles', 'profiles exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);

-- Signup trigger ---------------------------------------------------------

select results_eq(
  $$ select phone, role::text, full_name, reminders_enabled, deleted_at
     from public.profiles where id = tests.user_id('+9647801111111') $$,
  $$ values ('+9647801111111'::text, 'customer'::text, null::text, true, null::timestamptz) $$,
  'signup creates a customer profile with the E.164 phone and no name yet'
);

select throws_ok(
  $$ select tests.create_user('+9647201234567') $$,
  '23514',
  null,
  'signup with a non-mobile 07X number (072) is refused'
);

select throws_ok(
  $$ select tests.create_user('+14155550100') $$,
  '23514',
  null,
  'signup with a foreign number is refused'
);

-- The auth.users guard refuses the email before the profile's phone check
-- runs (auth_user_guard.test.sql).
select throws_ok(
  $$ insert into auth.users (id, instance_id, aud, role, email)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
             'authenticated', 'authenticated', 'someone@example.com') $$,
  'ZL003',
  'email_not_allowed',
  'signup without a phone (email) is refused'
);

select tests.create_user('+9647805555555');
update auth.users set phone = '9647806666666'
where id = tests.user_id('+9647805555555');

select is(
  (select phone from public.profiles where id = tests.user_id('+9647805555555')),
  '+9647806666666',
  'a phone change in Auth is copied to the profile'
);

delete from auth.users where id = tests.user_id('+9647805555555');

select is_empty(
  $$ select 1 from public.profiles where id = tests.user_id('+9647805555555') $$,
  'deleting the auth user deletes the profile'
);

-- Role helpers -----------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));
select is(private.current_user_role()::text, 'customer', 'current_user_role() is customer for a customer');
select is(private.is_admin(), false, 'is_admin() is false for a customer');

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is(private.current_user_role()::text, 'admin', 'current_user_role() is admin for an admin');
select is(private.is_admin(), true, 'is_admin() is true for an admin');

select tests.clear_authentication();
update public.profiles set deleted_at = now()
where id = tests.user_id('+9647504444444');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is(private.is_admin(), false, 'a deleted admin profile is not an admin');
select is_empty(
  $$ update public.profiles set full_name = 'رجعت'
     where id = tests.user_id('+9647504444444') returning 1 $$,
  'a deleted account cannot write its name back'
);
select tests.clear_authentication();
update public.profiles set deleted_at = null
where id = tests.user_id('+9647504444444');

select tests.authenticate_as_anon();
select throws_ok(
  $$ select private.is_admin() $$,
  '42501',
  null,
  'anon cannot call the role helpers'
);

-- Anon -------------------------------------------------------------------

select throws_ok(
  $$ select * from public.profiles $$,
  '42501',
  null,
  'anon cannot read profiles'
);

-- Customer A -------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select results_eq(
  $$ select id from public.profiles $$,
  $$ values (tests.user_id('+9647801111111')) $$,
  'a customer reads only their own profile'
);

select lives_ok(
  $$ update public.profiles
     set full_name = 'زيد', reminders_enabled = false
     where id = tests.user_id('+9647801111111') $$,
  'a customer can set their own name and reminder toggle'
);

select results_eq(
  $$ select full_name, reminders_enabled from public.profiles
     where id = tests.user_id('+9647801111111') $$,
  $$ values ('زيد'::text, false) $$,
  'the name and reminder toggle were saved'
);

select throws_ok(
  $$ update public.profiles set full_name = 'ز'
     where id = tests.user_id('+9647801111111') $$,
  '23514',
  null,
  'a one-character name is refused'
);

select throws_ok(
  $$ update public.profiles set full_name = repeat('ز', 41)
     where id = tests.user_id('+9647801111111') $$,
  '23514',
  null,
  'a name over 40 characters is refused'
);

select throws_ok(
  $$ update public.profiles set full_name = ' زيد '
     where id = tests.user_id('+9647801111111') $$,
  '23514',
  null,
  'a name with surrounding spaces is refused'
);

select throws_ok(
  $$ update public.profiles set role = 'admin'
     where id = tests.user_id('+9647801111111') $$,
  '42501',
  null,
  'a customer cannot change their role'
);

select throws_ok(
  $$ update public.profiles set phone = '+9647809999999'
     where id = tests.user_id('+9647801111111') $$,
  '42501',
  null,
  'a customer cannot change their phone directly'
);

select throws_ok(
  $$ update public.profiles set deleted_at = now()
     where id = tests.user_id('+9647801111111') $$,
  '42501',
  null,
  'a customer cannot set deleted_at directly'
);

select throws_ok(
  $$ insert into public.profiles (id, phone)
     values (gen_random_uuid(), '+9647809999999') $$,
  '42501',
  null,
  'a customer cannot insert a profile'
);

select throws_ok(
  $$ delete from public.profiles where id = tests.user_id('+9647801111111') $$,
  '42501',
  null,
  'a customer cannot delete a profile'
);

-- Customer A against customer B -----------------------------------------

select is_empty(
  $$ select 1 from public.profiles where id = tests.user_id('+9647802222222') $$,
  'a customer cannot read another customer''s profile'
);

select is_empty(
  $$ update public.profiles set full_name = 'مخترق'
     where id = tests.user_id('+9647802222222') returning 1 $$,
  'a customer cannot rename another customer'
);

-- Crew -------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));

select results_eq(
  $$ select id from public.profiles $$,
  $$ values (tests.user_id('+9647703333333')) $$,
  'a crew reads only its own profile'
);

select throws_ok(
  $$ update public.profiles set role = 'admin'
     where id = tests.user_id('+9647703333333') $$,
  '42501',
  null,
  'a crew cannot change its role'
);

-- Admin ------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select is(
  (select count(*)::int from public.profiles
   where id in (select id from tests.users)),
  4,
  'an admin reads every profile'
);

select is_empty(
  $$ update public.profiles set full_name = 'مدير'
     where id = tests.user_id('+9647802222222') returning 1 $$,
  'an admin cannot edit a customer''s profile directly (Phase 3 adds audited RPCs)'
);

select throws_ok(
  $$ update public.profiles set role = 'customer'
     where id = tests.user_id('+9647703333333') $$,
  '42501',
  null,
  'an admin cannot change roles directly (Phase 3 adds audited RPCs)'
);

-- Service role -----------------------------------------------------------

select tests.authenticate_as_service_role();

select lives_ok(
  $$ update public.profiles set role = 'crew'
     where id = tests.user_id('+9647802222222') $$,
  'the service role can change a role'
);

select tests.clear_authentication();

select is(
  (select role::text from public.profiles where id = tests.user_id('+9647802222222')),
  'crew',
  'the role change was saved'
);

alter table public.profiles disable trigger profiles_set_updated_at;
update public.profiles set updated_at = '2000-01-01'
where id = tests.user_id('+9647802222222');
alter table public.profiles enable trigger profiles_set_updated_at;
update public.profiles set reminders_enabled = false
where id = tests.user_id('+9647802222222');

select is(
  (select updated_at from public.profiles where id = tests.user_id('+9647802222222')),
  now(),
  'updated_at is set on update'
);

select * from finish();
rollback;
