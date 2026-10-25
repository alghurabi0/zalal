-- crews and admin_audit_log (spec §2, §7, §8). A crew is one shared
-- crew-role account per team. Admins read every crew; a crew reads only its
-- own row; customers and guests read none. private.current_crew_id() names
-- the caller's crew while the crew is active and the account is still a
-- crew. The audit log is read by admins only and written only by database
-- functions (transition_order now, the Phase 3 admin RPCs later). Crew
-- writes come with A10 (Phase 3).
begin;
\ir _helpers.psql

select plan(24);

select tests.create_user('+9647801111111');            -- customer
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));
insert into public.admin_audit_log (admin_id, action, entity, entity_id)
values (tests.user_id('+9647504444444'), 'order.transition', 'orders', 'x');

-- Shape ------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.crews'::regclass),
  'crews has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass),
  'admin_audit_log has RLS enabled'
);
select throws_ok(
  $$ insert into public.crews (name, user_id) values ('فريق 9', tests.user_id('+9647801111111')) $$,
  '23514', null, 'a crew needs a crew-role account'
);
select throws_ok(
  $$ insert into public.crews (name, user_id) values ('فريق 9', tests.user_id('+9647703333333')) $$,
  '23505', null, 'one crew per account'
);
select throws_ok(
  $$ insert into public.crews (name, user_id)
     values ('فريق 3333', tests.create_user('+9647703333335', 'crew')) $$,
  '23505', null, 'crew names are unique'
);
select throws_ok(
  $$ insert into public.crews (name, user_id)
     values (' فريق', tests.create_user('+9647703333336', 'crew')) $$,
  '23514', null, 'a crew name is trimmed'
);

-- Guest ------------------------------------------------------------------------

select tests.authenticate_as_anon();

select throws_ok($$ select * from public.crews $$, '42501', null, 'a guest cannot read crews');
select throws_ok(
  $$ select * from public.admin_audit_log $$,
  '42501', null, 'a guest cannot read the audit log'
);

-- Customer ---------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select is_empty($$ select * from public.crews $$, 'a customer reads no crews');
select is_empty($$ select * from public.admin_audit_log $$, 'a customer reads no audit log');
select is(private.current_crew_id(), null, 'a customer has no crew');
select throws_ok(
  $$ insert into public.crews (name, user_id) values ('x', tests.user_id('+9647801111111')) $$,
  '42501', null, 'a customer cannot add crews'
);
select throws_ok(
  $$ insert into public.admin_audit_log (admin_id, action, entity, entity_id)
     values (tests.user_id('+9647801111111'), 'x', 'x', 'x') $$,
  '42501', null, 'a customer cannot write the audit log'
);

-- Crew -------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));

select results_eq(
  $$ select id from public.crews $$,
  $$ values (tests.id('crew1')) $$,
  'a crew reads only its own crew'
);
select is(private.current_crew_id(), tests.id('crew1'), 'current_crew_id names the caller''s crew');
select is_empty($$ select * from public.admin_audit_log $$, 'a crew reads no audit log');
select throws_ok(
  $$ update public.crews set active = false $$,
  '42501', null, 'a crew cannot change crews'
);

select tests.clear_authentication();
update public.crews set active = false where id = tests.id('crew1');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is(private.current_crew_id(), null, 'an inactive crew has no current crew');

select tests.clear_authentication();
update public.crews set active = true where id = tests.id('crew1');
update public.profiles set role = 'customer' where id = tests.user_id('+9647703333333');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is(private.current_crew_id(), null, 'an account no longer in the crew role has no crew');

-- Admin ------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select is((select count(*)::int from public.crews), 2, 'an admin reads every crew');
select is((select count(*)::int from public.admin_audit_log), 1, 'an admin reads the audit log');
select throws_ok(
  $$ insert into public.admin_audit_log (admin_id, action, entity, entity_id)
     values (tests.user_id('+9647504444444'), 'x', 'x', 'x') $$,
  '42501', null, 'an admin cannot write the audit log directly'
);
select throws_ok(
  $$ delete from public.admin_audit_log $$,
  '42501', null, 'an admin cannot erase the audit log'
);
select throws_ok(
  $$ update public.crews set active = false $$,
  '42501', null, 'an admin cannot change crews directly (A10 comes in Phase 3)'
);

select * from finish();
rollback;
