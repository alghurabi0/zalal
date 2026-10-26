-- RLS audit: admin_staff (admin_create_crew, admin_set_crew_phone,
-- admin_add_admin, admin_remove_admin). Edge cases the RPCs' own tests don't
-- cover, kept as regressions:
--
-- - A customer's history keeps their account from becoming a crew even when
--   it is soft-deleted (a deleted address still counts).
-- - A deleted account can't become a crew or take over a crew's phone.
-- - A switched-off crew's account is still a crew, so it can't become an admin.
-- - After admin_set_crew_phone the old account reads none of the crew's
--   orders or its crew row and can't move them through transition_order().
-- - A removed admin no longer reads the audit log or other profiles.
-- - A deleted admin and the server (service role, no session) can't call
--   the staff RPCs.
begin;
\ir _helpers.psql

select plan(16);

select tests.create_user('+9647504444444', 'admin');   -- the caller
select tests.create_user('+9647505555555', 'admin');   -- another admin, to be removed
select tests.create_user('+9647506666666', 'admin');   -- a deleted admin
select tests.create_user('+9647801111111');            -- customer with a deleted address
select tests.create_user('+9647802222222');            -- deleted, never signed in
select tests.create_user('+9647705555551');            -- untouched, for the phone move
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew_off', tests.create_crew('+9647703333334'));
update public.crews set active = false where id = tests.id('crew_off');
update public.profiles set deleted_at = now() where phone in ('+9647802222222', '+9647506666666');
update public.addresses set deleted_at = now()
where id = tests.create_address(tests.user_id('+9647801111111'));
insert into tests.ids values (
  'open_order',
  tests.create_order(tests.user_id('+9647801111111'), 'confirmed', now() + interval '3 days', tests.id('crew1'))
);

create function tests.profile(p_phone text) returns public.profiles language sql stable security definer
as $$ select * from public.profiles where phone = p_phone $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Crew creation and phone moves ---------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.admin_create_crew('+9647801111111', 'فريق جديد') $$,
  'ZL019', 'phone_has_account', 'a customer whose only address is deleted still cannot become a crew'
);
select throws_ok(
  $$ select public.admin_create_crew('+9647802222222', 'فريق جديد') $$,
  'P0002', 'account_not_found', 'a deleted account cannot become a crew'
);
select throws_ok(
  $$ select public.admin_set_crew_phone(tests.id('crew1'), '+9647802222222') $$,
  'P0002', 'account_not_found', 'a crew cannot move to a deleted account'
);
select throws_ok(
  $$ select public.admin_add_admin('+9647703333334', 'مشرف') $$,
  'ZL021', 'account_is_crew', 'a switched-off crew''s account cannot become an admin'
);

select lives_ok(
  $$ select public.admin_set_crew_phone(tests.id('crew1'), '+9647705555551') $$,
  'an admin moves crew1 to a new phone'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select 1 from public.orders $$, 'the old crew account reads none of the crew''s orders');
select is_empty($$ select 1 from public.crews $$, 'the old crew account no longer reads the crew');
select throws_ok(
  $$ select public.transition_order(tests.id('open_order'), 'on_the_way') $$,
  'P0002', 'order_not_found', 'the old crew account cannot move the crew''s orders'
);
select throws_ok(
  $$ insert into public.addresses (user_id, label, district, landmark, lat, lng)
     values (tests.user_id('+9647801111111'), 'home', 'حي الحسين', 'قرب الجامع', 32.616, 44.024) $$,
  '42501', null, 'the old crew account, now a customer, cannot add an address for someone else'
);

-- Removed and deleted admins ------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select public.admin_remove_admin(tests.user_id('+9647505555555')) $$,
  'an admin removes another admin'
);

select tests.authenticate_as(tests.user_id('+9647505555555'));
select is_empty($$ select 1 from public.admin_audit_log $$, 'a removed admin no longer reads the audit log');
select is_empty(
  $$ select 1 from public.profiles where id <> tests.user_id('+9647505555555') $$,
  'a removed admin no longer reads other profiles'
);

select tests.authenticate_as(tests.user_id('+9647506666666'));
select throws_ok(
  $$ select public.admin_add_admin('+9647801111111', 'مشرف') $$,
  '42501', 'not_allowed', 'a deleted admin cannot add an admin'
);
select throws_ok(
  $$ select public.admin_remove_admin(tests.user_id('+9647504444444')) $$,
  '42501', 'not_allowed', 'a deleted admin cannot remove the last live admin'
);

-- The server's secret key has no session, so it can't act as an admin.
select tests.authenticate_as_service_role();
select throws_ok(
  $$ select public.admin_add_admin('+9647801111111', 'مشرف') $$,
  '42501', 'not_allowed', 'the service role cannot add an admin'
);

select tests.clear_authentication();
select is(
  (select count(*)::int from public.profiles as p join tests.users as u on u.id = p.id where p.role = 'admin' and p.deleted_at is null),
  1,
  'of this test''s admins, one live admin remains'
);

select * from finish();
rollback;
