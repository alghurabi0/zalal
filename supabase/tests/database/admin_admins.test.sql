-- Admin writes for A14 (spec §2, §8.2, §7). Admins only (42501 for everyone
-- else; guests can't call them); nobody writes profiles.role directly.
--
-- admin_add_admin(phone, name): makes the account with that phone an admin.
-- Any customer account qualifies (its orders and addresses stay); the name
-- is used only when the account has none. A crew account is ZL021
-- account_is_crew; a phone without a live account is P0002. Returns false
-- and logs nothing when the account is already an admin; otherwise logs
-- 'admin.add'.
--
-- admin_remove_admin(user_id): the admin goes back to a customer and the
-- change is logged as 'admin.remove'. An admin cannot remove themselves
-- (ZL022 cannot_remove_self), so the caller, rechecked under a lock on every
-- admin row, always remains: two admins removing each other at once can't
-- leave nobody (the second waits, then is no longer an admin: 42501).
begin;
\ir _helpers.psql

select plan(30);

select tests.create_user('+9647801111111');            -- customer A, named, with an address
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');   -- the caller
select tests.create_user('+9647505555555', 'admin');   -- another admin
select tests.create_crew('+9647703333333');
select tests.create_user('+9647706666666');            -- untouched, no name
select tests.create_user('+9647707777777');            -- deleted
update public.profiles set full_name = 'زبون أ' where phone = '+9647801111111';
update public.profiles set deleted_at = now() where phone = '+9647707777777';
select tests.create_address(tests.user_id('+9647801111111'));

create function tests.audit_count(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
create function tests.profile(p_phone text) returns public.profiles language sql stable security definer
as $$ select * from public.profiles where phone = p_phone $$;
grant execute on all functions in schema tests to anon, authenticated;

-- admin_add_admin: everyone but admins -----------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_add_admin('+9647802222222', 'مشرف') $$,
  '42501', null, 'a guest cannot add an admin'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_add_admin('+9647801111111', 'مشرف') $$,
  '42501', 'not_allowed', 'a customer cannot make themselves an admin'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select public.admin_add_admin('+9647801111111', 'مشرف') $$,
  '42501', 'not_allowed', 'another customer cannot add an admin'
);
select throws_ok(
  $$ update public.profiles set role = 'admin' where id = tests.user_id('+9647802222222') $$,
  '42501', null, 'a customer cannot set their own role'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_add_admin('+9647703333333', 'مشرف') $$,
  '42501', 'not_allowed', 'a crew cannot add an admin'
);
select tests.clear_authentication();
select is((tests.profile('+9647801111111')).role, 'customer'::public.app_role, 'nothing changed for the refused callers');

-- admin_add_admin: admin ----------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ update public.profiles set role = 'admin' where id = tests.user_id('+9647802222222') $$,
  '42501', null, 'an admin cannot set a role directly'
);
select throws_ok(
  $$ select public.admin_add_admin('+9647703333333', 'مشرف') $$,
  'ZL021', 'account_is_crew', 'a crew account cannot become an admin'
);
select throws_ok(
  $$ select public.admin_add_admin('+9647709999999', 'مشرف') $$,
  'P0002', 'account_not_found', 'a phone without an account is refused'
);
select throws_ok(
  $$ select public.admin_add_admin('+9647707777777', 'مشرف') $$,
  'P0002', 'account_not_found', 'a deleted account is refused'
);
select throws_ok(
  $$ select public.admin_add_admin('07801111111', 'مشرف') $$,
  '22023', 'invalid_phone', 'the phone must be E.164'
);

select is(public.admin_add_admin('+9647801111111', 'مشرف جديد'), true, 'an existing customer becomes an admin');
select is((tests.profile('+9647801111111')).role, 'admin'::public.app_role, 'their role is admin');
select is((tests.profile('+9647801111111')).full_name, 'زبون أ', 'they keep their own name');
select is(
  (select count(*)::int from public.addresses where user_id = tests.user_id('+9647801111111')),
  1,
  'and their customer data'
);
select is(
  tests.last_diff('admin.add'),
  '{"phone": "+9647801111111", "role": {"from": "customer", "to": "admin"}}'::jsonb,
  'the promotion is logged'
);

select is(public.admin_add_admin('+9647706666666', 'مشرف جديد'), true, 'a new account becomes an admin');
select is((tests.profile('+9647706666666')).full_name, 'مشرف جديد', 'an account without a name takes the given one');
select is(
  tests.last_diff('admin.add'),
  '{"phone": "+9647706666666", "role": {"from": "customer", "to": "admin"}, "full_name": {"from": null, "to": "مشرف جديد"}}'::jsonb,
  'the name is logged too'
);

select is(public.admin_add_admin('+9647505555555', 'مشرف'), false, 'an admin already is one');
select is(tests.audit_count('admin.add'), 2, 'and nothing is logged');

-- admin_remove_admin -----------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_remove_admin(tests.user_id('+9647505555555')) $$,
  '42501', null, 'a guest cannot remove an admin'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select public.admin_remove_admin(tests.user_id('+9647505555555')) $$,
  '42501', 'not_allowed', 'a customer cannot remove an admin'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_remove_admin(tests.user_id('+9647505555555')) $$,
  '42501', 'not_allowed', 'a crew cannot remove an admin'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.admin_remove_admin(tests.user_id('+9647504444444')) $$,
  'ZL022', 'cannot_remove_self', 'an admin cannot remove themselves'
);
select throws_ok(
  $$ select public.admin_remove_admin(tests.user_id('+9647802222222')) $$,
  'P0002', 'admin_not_found', 'a customer is not an admin to remove'
);
select lives_ok(
  $$ select public.admin_remove_admin(tests.user_id('+9647801111111')) $$,
  'an admin removes another admin'
);
select is((tests.profile('+9647801111111')).role, 'customer'::public.app_role, 'who is a customer again');
select is(
  tests.last_diff('admin.remove'),
  '{"phone": "+9647801111111", "role": {"from": "admin", "to": "customer"}}'::jsonb,
  'the removal is logged'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_remove_admin(tests.user_id('+9647505555555')) $$,
  '42501', 'not_allowed', 'a removed admin can no longer remove admins'
);

select * from finish();
rollback;
