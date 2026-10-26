-- Crew writes for A10 (spec §2, §8.2, §7). Admins only (42501 for everyone
-- else; guests can't call them); nobody writes crews directly.
--
-- admin_create_crew(phone, name): the server creates the Auth account first;
-- the RPC accepts it only while it is untouched (a customer that never
-- signed in and has no addresses or orders), otherwise ZL019
-- phone_has_account. It makes the account a crew named like the crew,
-- inserts the crew and logs 'crew.create'. A taken name is ZL020.
--
-- admin_update_crew(id, name, active): renames (the account's name too) and
-- switches on or off. Orders are never touched; it returns how many open
-- orders the crew still has. Logs only the changed fields as 'crew.update'.
--
-- admin_set_crew_phone(id, phone): moves the crew to a new untouched
-- account; the old account goes back to an unnamed customer. Orders keep the
-- crew. Logs 'crew.phone' with the old and new phone.
begin;
\ir _helpers.psql

select plan(51);

select tests.create_user('+9647801111111');            -- customer A, has an address
select tests.create_user('+9647802222222');            -- customer B, has signed in
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
select tests.create_address(tests.user_id('+9647801111111'));
update auth.users set last_sign_in_at = now() where id = tests.user_id('+9647802222222');

-- Untouched accounts, as the server leaves them before the RPC.
select tests.create_user('+9647705555551');
select tests.create_user('+9647705555552');
select tests.create_user('+9647705555553');

-- Orders for crew1: one open, one done.
insert into tests.ids values (
  'open_order',
  tests.create_order(tests.user_id('+9647801111111'), 'confirmed', now() + interval '3 days', tests.id('crew1'))
);
select tests.create_order(tests.user_id('+9647801111111'), 'completed', now() - interval '3 days', tests.id('crew1'));

create function tests.audit_count(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
create function tests.profile(p_phone text) returns public.profiles language sql stable security definer
as $$ select * from public.profiles where phone = p_phone $$;
create function tests.crew(p_id uuid) returns public.crews language sql stable security definer
as $$ select * from public.crews where id = p_id $$;
grant execute on all functions in schema tests to anon, authenticated;

-- admin_create_crew: everyone but admins -----------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_create_crew('+9647705555551', 'فريق جديد') $$,
  '42501', null, 'a guest cannot create a crew'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_create_crew('+9647705555551', 'فريق جديد') $$,
  '42501', 'not_allowed', 'a customer cannot create a crew'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select public.admin_create_crew('+9647705555551', 'فريق جديد') $$,
  '42501', 'not_allowed', 'another customer cannot create a crew'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_create_crew('+9647705555551', 'فريق جديد') $$,
  '42501', 'not_allowed', 'a crew cannot create a crew'
);
select tests.clear_authentication();
select is((tests.profile('+9647705555551')).role, 'customer'::public.app_role, 'nothing changed for the refused callers');

-- admin_create_crew: admin -------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select throws_ok(
  $$ insert into public.crews (name, user_id) values ('فريق 9', tests.user_id('+9647705555551')) $$,
  '42501', null, 'an admin cannot insert crews directly'
);
select throws_ok(
  $$ select public.admin_create_crew('+9647801111111', 'فريق جديد') $$,
  'ZL019', 'phone_has_account', 'a customer with an address cannot become a crew'
);
select throws_ok(
  $$ select public.admin_create_crew('+9647802222222', 'فريق جديد') $$,
  'ZL019', 'phone_has_account', 'a customer who has signed in cannot become a crew'
);
select throws_ok(
  $$ select public.admin_create_crew('+9647703333333', 'فريق جديد') $$,
  'ZL019', 'phone_has_account', 'a crew account cannot become a second crew'
);
select throws_ok(
  $$ select public.admin_create_crew('+9647504444444', 'فريق جديد') $$,
  'ZL019', 'phone_has_account', 'an admin cannot become a crew'
);
select throws_ok(
  $$ select public.admin_create_crew('+9647709999999', 'فريق جديد') $$,
  'P0002', 'account_not_found', 'a phone without an account is refused'
);
select throws_ok(
  $$ select public.admin_create_crew('07705555551', 'فريق جديد') $$,
  '22023', 'invalid_phone', 'the phone must be E.164'
);
select throws_ok(
  $$ select public.admin_create_crew('+9647705555551', 'فريق 3333') $$,
  'ZL020', 'crew_name_taken', 'a crew name is unique'
);
select throws_ok(
  $$ select public.admin_create_crew('+9647705555551', 'ف') $$,
  '23514', null, 'a crew name is 2 to 30 characters'
);
select is((tests.profile('+9647705555551')).role, 'customer'::public.app_role, 'a refused create leaves the account alone');

select lives_ok(
  $$ insert into tests.ids values ('crew2', public.admin_create_crew('+9647705555551', 'فريق جديد')) $$,
  'an admin makes a crew from an untouched account'
);
select is((tests.crew(tests.id('crew2'))).name, 'فريق جديد', 'the crew has its name');
select ok((tests.crew(tests.id('crew2'))).active, 'a new crew is active');
select is((tests.profile('+9647705555551')).role, 'crew'::public.app_role, 'its account is now a crew');
select is((tests.profile('+9647705555551')).full_name, 'فريق جديد', 'the account is named like the crew');
select is(
  tests.last_diff('crew.create'),
  '{"name": "فريق جديد", "phone": "+9647705555551"}'::jsonb,
  'the create is logged with the name and phone'
);

-- admin_update_crew --------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_update_crew(tests.id('crew1'), 'فريق 3333', false) $$,
  '42501', null, 'a guest cannot update a crew'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_update_crew(tests.id('crew1'), 'فريق 3333', false) $$,
  '42501', 'not_allowed', 'a customer cannot update a crew'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select public.admin_update_crew(tests.id('crew1'), 'فريق 3333', false) $$,
  '42501', 'not_allowed', 'another customer cannot update a crew'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_update_crew(tests.id('crew1'), 'فريق 3333', false) $$,
  '42501', 'not_allowed', 'a crew cannot switch itself off'
);
select throws_ok(
  $$ update public.crews set active = false where id = tests.id('crew1') $$,
  '42501', null, 'a crew cannot update its row directly'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ update public.crews set active = false where id = tests.id('crew1') $$,
  '42501', null, 'an admin cannot update crews directly'
);
select throws_ok(
  $$ select public.admin_update_crew(gen_random_uuid(), 'فريق 3333', false) $$,
  'P0002', 'crew_not_found', 'an unknown crew is refused'
);
select throws_ok(
  $$ select public.admin_update_crew(tests.id('crew1'), 'فريق جديد', true) $$,
  'ZL020', 'crew_name_taken', 'a rename cannot take another crew''s name'
);
select is(
  public.admin_update_crew(tests.id('crew1'), 'فريق 3333', false),
  1,
  'switching off returns the open orders the crew still has'
);
select is(
  tests.last_diff('crew.update'),
  '{"active": {"from": true, "to": false}}'::jsonb,
  'only the changed field is logged'
);
select is(public.admin_update_crew(tests.id('crew1'), 'فريق 3333', false), 1, 'saving the same values works');
select is(tests.audit_count('crew.update'), 1, 'and logs nothing');

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select 1 from public.orders $$, 'a switched-off crew no longer reads its orders');

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is(
  (select crew_id from public.orders where id = tests.id('open_order')),
  tests.id('crew1'),
  'switching a crew off leaves its orders assigned'
);
select is(public.admin_update_crew(tests.id('crew1'), 'فريق الشمال', true), 1, 'an admin renames and switches a crew on');
select is((tests.profile('+9647703333333')).full_name, 'فريق الشمال', 'the account takes the new name');
select is(
  tests.last_diff('crew.update'),
  '{"name": {"from": "فريق 3333", "to": "فريق الشمال"}, "active": {"from": false, "to": true}}'::jsonb,
  'the rename and switch-on are logged'
);

-- admin_set_crew_phone -------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_set_crew_phone(tests.id('crew1'), '+9647705555552') $$,
  '42501', null, 'a guest cannot change a crew''s phone'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_set_crew_phone(tests.id('crew1'), '+9647705555552') $$,
  '42501', 'not_allowed', 'a customer cannot change a crew''s phone'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select public.admin_set_crew_phone(tests.id('crew1'), '+9647705555552') $$,
  '42501', 'not_allowed', 'another customer cannot change a crew''s phone'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_set_crew_phone(tests.id('crew1'), '+9647705555552') $$,
  '42501', 'not_allowed', 'a crew cannot change its phone'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.admin_set_crew_phone(gen_random_uuid(), '+9647705555552') $$,
  'P0002', 'crew_not_found', 'an unknown crew is refused'
);
select throws_ok(
  $$ select public.admin_set_crew_phone(tests.id('crew1'), '+9647802222222') $$,
  'ZL019', 'phone_has_account', 'the new phone cannot be an account in use'
);
select lives_ok(
  $$ select public.admin_set_crew_phone(tests.id('crew1'), '+9647703333333') $$,
  'the crew''s own phone changes nothing'
);
select is(tests.audit_count('crew.phone'), 0, 'and logs nothing');
select lives_ok(
  $$ select public.admin_set_crew_phone(tests.id('crew1'), '+9647705555552') $$,
  'an admin moves a crew to a new phone'
);
select is((tests.crew(tests.id('crew1'))).user_id, tests.user_id('+9647705555552'), 'the crew logs in with the new account');
select ok(
  (tests.profile('+9647703333333')).role = 'customer' and (tests.profile('+9647703333333')).full_name is null,
  'the old account is an unnamed customer again'
);
select is(
  tests.last_diff('crew.phone'),
  '{"from": "+9647703333333", "to": "+9647705555552"}'::jsonb,
  'the phone change is logged'
);

select tests.authenticate_as(tests.user_id('+9647705555552'));
select results_eq(
  $$ select id from public.orders where id = tests.id('open_order') $$,
  $$ select tests.id('open_order') $$,
  'the new account reads the crew''s orders'
);

select * from finish();
rollback;
