-- crew_job_contact() (spec §8.1 C3 "اتصل بالزبون"): the customer's name and
-- phone for the crew assigned to the order, so it can call to find the house.
-- Crews can't read profiles, so this is the only way they see a phone, and
-- only while the job is open: confirmed, on the way, arrived or in progress
-- (settled Oct 26, 2026). Any other order, status or crew reads as
-- P0002 order_not_found (a switched-off crew has no crew). Other roles get
-- 42501 not_allowed (admins read profiles directly); guests can't call it.
begin;
\ir _helpers.psql

select plan(19);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));
insert into tests.ids values ('crew_off', tests.create_crew('+9647703333335'));
insert into tests.ids values ('crew_demoted', tests.create_crew('+9647703333336'));
update public.profiles set full_name = 'زبون ألف' where id = tests.user_id('+9647801111111');

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;

insert into tests.ids values
  ('confirmed', tests.create_order(tests.a(), 'confirmed', p_crew_id => tests.id('crew1'))),
  ('otw', tests.create_order(tests.a(), 'on_the_way', p_crew_id => tests.id('crew1'))),
  ('arrived', tests.create_order(tests.a(), 'arrived', p_crew_id => tests.id('crew1'))),
  ('in_progress', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('pending', tests.create_order(tests.a(), 'pending_confirmation', p_crew_id => tests.id('crew1'))),
  ('completed', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('no_show', tests.create_order(tests.a(), 'no_show', p_crew_id => tests.id('crew1'))),
  ('cancelled', tests.create_order(tests.a(), 'cancelled', p_crew_id => tests.id('crew1'))),
  ('b_nameless', tests.create_order(tests.user_id('+9647802222222'), 'confirmed', p_crew_id => tests.id('crew1'))),
  ('off', tests.create_order(tests.a(), 'confirmed', p_crew_id => tests.id('crew_off'))),
  ('demoted', tests.create_order(tests.a(), 'confirmed', p_crew_id => tests.id('crew_demoted')));

update public.crews set active = false where id = tests.id('crew_off');
update public.profiles set role = 'customer' where id = tests.user_id('+9647703333336');

grant execute on all functions in schema tests to anon, authenticated;

-- The assigned crew, while the job is open --------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));

select results_eq(
  $$ select full_name, phone from public.crew_job_contact(tests.id('confirmed')) $$,
  $$ values ('زبون ألف'::text, '+9647801111111'::text) $$,
  'the crew reads the contact of a confirmed job'
);
select results_eq(
  $$ select phone from public.crew_job_contact(tests.id('otw')) $$,
  $$ values ('+9647801111111'::text) $$,
  'on the way'
);
select results_eq(
  $$ select phone from public.crew_job_contact(tests.id('arrived')) $$,
  $$ values ('+9647801111111'::text) $$,
  'arrived'
);
select results_eq(
  $$ select phone from public.crew_job_contact(tests.id('in_progress')) $$,
  $$ values ('+9647801111111'::text) $$,
  'in progress'
);
select results_eq(
  $$ select full_name, phone from public.crew_job_contact(tests.id('b_nameless')) $$,
  $$ values (null::text, '+9647802222222'::text) $$,
  'a customer without a name still has a phone'
);

-- Closed or not yet confirmed --------------------------------------------------

select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('pending')) $$,
  'P0002', 'order_not_found', 'not before the admin confirms'
);
select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('completed')) $$,
  'P0002', 'order_not_found', 'not after completion'
);
select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('no_show')) $$,
  'P0002', 'order_not_found', 'not after a no-show'
);
select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('cancelled')) $$,
  'P0002', 'order_not_found', 'not after a cancel'
);
select throws_ok(
  $$ select * from public.crew_job_contact(gen_random_uuid()) $$,
  'P0002', 'order_not_found', 'an unknown order'
);

-- Other crews ------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333334'));
select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('confirmed')) $$,
  'P0002', 'order_not_found', 'another crew cannot read the contact'
);

select tests.authenticate_as(tests.user_id('+9647703333335'));
select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('off')) $$,
  'P0002', 'order_not_found', 'a switched-off crew cannot read its own job''s contact'
);

select tests.authenticate_as(tests.user_id('+9647703333336'));
select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('demoted')) $$,
  '42501', 'not_allowed', 'an account that is no longer a crew cannot'
);

-- Other roles ------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('confirmed')) $$,
  '42501', 'not_allowed', 'the customer cannot call it'
);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('confirmed')) $$,
  '42501', 'not_allowed', 'another customer cannot'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('confirmed')) $$,
  '42501', 'not_allowed', 'admins read profiles directly, not through this'
);

select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('confirmed')) $$,
  '42501', null, 'guests cannot call it'
);

select tests.clear_authentication();

select function_privs_are(
  'public', 'crew_job_contact', array['uuid'], 'anon', array[]::text[],
  'anon has no EXECUTE'
);
select function_privs_are(
  'public', 'crew_job_contact', array['uuid'], 'authenticated', array['EXECUTE'],
  'logged-in users have EXECUTE; the function checks the role'
);

select * from finish();
rollback;
