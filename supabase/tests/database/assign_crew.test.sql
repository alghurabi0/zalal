-- assign_crew() (spec §6, §8.2 A2): admins assign, change or remove an
-- order's crew. Admins only (42501 for everyone else; guests can't call it).
-- The crew must exist (P0002 crew_not_found) and be active with a crew-role
-- account (ZL013 crew_inactive). A crew can be set while the order is
-- pending, confirmed or on the way (a broken-down crew is swapped); it can be
-- removed only while pending or confirmed, because an order on the way needs
-- a crew to move on. Anything later is ZL014 crew_change_not_allowed (an
-- override moves the status, not the crew). Each change writes
-- admin_audit_log ('order.assign_crew', from and to); setting the same crew
-- again changes nothing and logs nothing. The new crew reads the order at
-- once and the old one stops.
begin;
\ir _helpers.psql

select plan(29);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));
insert into tests.ids values ('crew_off', tests.create_crew('+9647703333335'));
insert into tests.ids values ('crew_demoted', tests.create_crew('+9647703333336'));
update public.crews set active = false where id = tests.id('crew_off');
update public.profiles set role = 'customer' where id = tests.user_id('+9647703333336');

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;

insert into tests.ids values
  ('pending', tests.create_order(tests.a(), 'pending_confirmation')),
  ('confirmed', tests.create_order(tests.a(), 'confirmed', p_crew_id => tests.id('crew1'))),
  ('otw', tests.create_order(tests.a(), 'on_the_way', p_crew_id => tests.id('crew1'))),
  ('arrived', tests.create_order(tests.a(), 'arrived', p_crew_id => tests.id('crew1'))),
  ('in_progress', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('completed', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('cancelled', tests.create_order(tests.a(), 'cancelled')),
  ('no_show', tests.create_order(tests.a(), 'no_show', p_crew_id => tests.id('crew1'))),
  ('b', tests.create_order(tests.user_id('+9647802222222'), 'pending_confirmation'));

create function tests.assign(p_order text, p_crew text)
returns void
language sql
as $$ select public.assign_crew(tests.id(p_order), tests.id(p_crew)) $$;

create function tests.crew_of(p_order text) returns uuid language sql stable security definer
as $$ select crew_id from public.orders where id = tests.id(p_order) $$;

create function tests.audit_rows() returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = 'order.assign_crew' $$;

grant execute on all functions in schema tests to anon, authenticated;

-- Guest --------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select tests.assign('pending', 'crew1') $$,
  '42501', null, 'a guest cannot assign a crew'
);

-- Customer -----------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select tests.assign('pending', 'crew1') $$,
  '42501', 'not_allowed', 'a customer cannot assign a crew to their own order'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select tests.assign('pending', 'crew1') $$,
  '42501', 'not_allowed', 'another customer cannot assign a crew'
);

-- Crew ---------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333334'));
select throws_ok(
  $$ select tests.assign('confirmed', 'crew2') $$,
  '42501', 'not_allowed', 'a crew cannot take an order for itself'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.assign_crew(tests.id('confirmed'), null) $$,
  '42501', 'not_allowed', 'a crew cannot drop its own order'
);

select tests.clear_authentication();
select is(tests.crew_of('pending'), null, 'nothing changed for the refused callers');
select is(tests.crew_of('confirmed'), tests.id('crew1'), 'the assigned crew stayed');

-- Admin --------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select lives_ok($$ select tests.assign('pending', 'crew1') $$, 'an admin assigns a pending order');
select is(tests.crew_of('pending'), tests.id('crew1'), 'the pending order has crew 1');
select results_eq(
  $$ select admin_id, entity, entity_id, diff from public.admin_audit_log
     where action = 'order.assign_crew' $$,
  $$ values (
       tests.user_id('+9647504444444'), 'orders', tests.id('pending')::text,
       jsonb_build_object('from', null, 'to', tests.id('crew1'))
     ) $$,
  'the assignment is in the audit log'
);

select lives_ok($$ select tests.assign('confirmed', 'crew2') $$, 'an admin changes a confirmed order''s crew');
select is(tests.crew_of('confirmed'), tests.id('crew2'), 'the confirmed order has crew 2');

select lives_ok($$ select tests.assign('otw', 'crew2') $$, 'an admin swaps the crew of an order on the way');
select is(tests.crew_of('otw'), tests.id('crew2'), 'the order on the way has crew 2');

select lives_ok(
  $$ select public.assign_crew(tests.id('confirmed'), null) $$,
  'an admin removes a confirmed order''s crew'
);
select is(tests.crew_of('confirmed'), null, 'the confirmed order has no crew');

select throws_ok(
  $$ select public.assign_crew(tests.id('otw'), null) $$,
  'ZL014', 'crew_change_not_allowed', 'an order on the way keeps a crew'
);
select throws_ok(
  $$ select tests.assign('arrived', 'crew2') $$,
  'ZL014', 'crew_change_not_allowed', 'not once the crew has arrived'
);
select throws_ok(
  $$ select tests.assign('in_progress', 'crew2') $$,
  'ZL014', 'crew_change_not_allowed', 'not while the work is in progress'
);
select throws_ok(
  $$ select tests.assign('completed', 'crew2') $$,
  'ZL014', 'crew_change_not_allowed', 'not after completion'
);
select throws_ok(
  $$ select tests.assign('cancelled', 'crew2') $$,
  'ZL014', 'crew_change_not_allowed', 'not for a cancelled order'
);
select throws_ok(
  $$ select tests.assign('no_show', 'crew2') $$,
  'ZL014', 'crew_change_not_allowed', 'not after a no-show'
);
select throws_ok(
  $$ select tests.assign('b', 'crew_off') $$,
  'ZL013', 'crew_inactive', 'an inactive crew cannot be assigned'
);
select throws_ok(
  $$ select tests.assign('b', 'crew_demoted') $$,
  'ZL013', 'crew_inactive', 'a crew whose account is no longer a crew cannot be assigned'
);
select throws_ok(
  $$ select public.assign_crew(tests.id('b'), gen_random_uuid()) $$,
  'P0002', 'crew_not_found', 'an unknown crew'
);
select throws_ok(
  $$ select public.assign_crew(gen_random_uuid(), tests.id('crew1')) $$,
  'P0002', 'order_not_found', 'an unknown order'
);

select tests.assign('pending', 'crew1');
select is(tests.audit_rows(), 4, 'setting the same crew again logs nothing (4 changes so far)');

-- The crews see the change ----------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333334'));
select results_eq(
  $$ select id from public.orders where id in (tests.id('otw'), tests.id('pending')) $$,
  $$ values (tests.id('otw')) $$,
  'the new crew reads the order it was given'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty(
  $$ select id from public.orders where id in (tests.id('otw'), tests.id('confirmed')) $$,
  'the old crew no longer reads the orders taken from it'
);

select * from finish();
rollback;
