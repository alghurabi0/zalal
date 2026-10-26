-- admin_create_slot(start, end, capacity, weekdays) and
-- admin_update_slot(id, capacity, weekdays, active) (spec §8.2 A9, §7).
-- Admins only (42501 for everyone else; guests can't call them). A new slot
-- is active; its times are fixed once made (orders copy them), so an update
-- changes only capacity, weekdays and active. Two slots can't share the same
-- times (ZL015 slot_exists, also against a switched-off slot, which the admin
-- switches back on instead). Table checks still apply: capacity 1-20,
-- weekdays 0-6 and not empty, start before end (23514). An unknown slot is
-- P0002 slot_not_found. Slots are never deleted. Each change is logged
-- ('slot.create' with the new slot, 'slot.update' with only the changed
-- fields); an update that changes nothing logs nothing. Lowering a capacity
-- or switching a slot off never touches the orders that hold places in it.
begin;
\ir _helpers.psql

select plan(27);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

insert into public.slots (start_time, end_time, capacity, weekdays, active)
values ('13:00', '14:00', 2, '{0,1,2,3,4,5,6}', false);
create function tests.s_off() returns bigint language sql stable security definer
as $$ select id from public.slots where start_time = '13:00' and end_time = '14:00' $$;

select tests.create_slot('14:00', '15:00', 3);
create function tests.s() returns bigint language sql stable security definer
as $$ select id from public.slots where start_time = '14:00' and end_time = '15:00' $$;
insert into tests.ids values
  ('o1', tests.create_order(tests.user_id('+9647801111111'), 'confirmed', now() + interval '3 days', p_slot_id => tests.s())),
  ('o2', tests.create_order(tests.user_id('+9647802222222'), 'pending_confirmation', now() + interval '3 days', p_slot_id => tests.s()));

create function tests.slot_row(p_id bigint) returns table (capacity smallint, weekdays smallint[], active boolean)
language sql stable security definer
as $$ select capacity, weekdays, active from public.slots where id = p_id $$;

create function tests.audit(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;

grant execute on all functions in schema tests to anon, authenticated;

-- Everyone but admins --------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_create_slot('20:00', '21:00', 2, '{0}') $$,
  '42501', null, 'a guest cannot add a slot'
);
select throws_ok(
  $$ select public.admin_update_slot(tests.s(), 1, '{0}', true) $$,
  '42501', null, 'a guest cannot change a slot'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_create_slot('20:00', '21:00', 2, '{0}') $$,
  '42501', 'not_allowed', 'a customer cannot add a slot'
);
select throws_ok(
  $$ select public.admin_update_slot(tests.s(), 1, '{0}', true) $$,
  '42501', 'not_allowed', 'a customer cannot change a slot'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select public.admin_update_slot(tests.s(), 20, '{0,1,2,3,4,5,6}', true) $$,
  '42501', 'not_allowed', 'another customer cannot change a slot'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_create_slot('20:00', '21:00', 2, '{0}') $$,
  '42501', 'not_allowed', 'a crew cannot add a slot'
);
select throws_ok(
  $$ select public.admin_update_slot(tests.s(), 1, '{0}', false) $$,
  '42501', 'not_allowed', 'a crew cannot change a slot'
);

select tests.clear_authentication();
select results_eq(
  $$ select * from tests.slot_row(tests.s()) $$,
  $$ values (3::smallint, '{0,1,2,3,4,5,6}'::smallint[], true) $$,
  'nothing changed for the refused callers'
);
select is(
  (select count(*)::int from public.slots where start_time = '20:00'),
  0,
  'and no slot was added'
);

-- Admin: create --------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select throws_ok(
  $$ insert into public.slots (start_time, end_time, capacity, weekdays) values ('20:00', '21:00', 2, '{0}') $$,
  '42501', null, 'an admin cannot insert into the table directly'
);
select throws_ok(
  $$ delete from public.slots where id = tests.s() $$,
  '42501', null, 'nobody deletes a slot'
);

select lives_ok(
  $$ select public.admin_create_slot('20:00', '21:30', 4, '{6,0}') $$,
  'an admin adds a slot'
);
select results_eq(
  $$ select capacity, weekdays, active from public.slots where start_time = '20:00' and end_time = '21:30' $$,
  $$ values (4::smallint, '{0,6}'::smallint[], true) $$,
  'the new slot is active, with its weekdays in order'
);
select results_eq(
  $$ select entity, entity_id, diff from public.admin_audit_log where action = 'slot.create' $$,
  $$ select 'slots', id::text,
       jsonb_build_object('start_time', '20:00:00', 'end_time', '21:30:00', 'capacity', 4, 'weekdays', '[0, 6]'::jsonb)
     from public.slots where start_time = '20:00' and end_time = '21:30' $$,
  'the new slot is in the audit log'
);
select throws_ok(
  $$ select public.admin_create_slot('14:00', '15:00', 2, '{0}') $$,
  'ZL015', 'slot_exists', 'a slot with the same times is refused'
);
select throws_ok(
  $$ select public.admin_create_slot('13:00', '14:00', 2, '{0}') $$,
  'ZL015', 'slot_exists', 'also when the other slot is switched off'
);
select throws_ok(
  $$ select public.admin_create_slot('15:00', '14:00', 2, '{0}') $$,
  '23514', null, 'a slot that ends before it starts is refused'
);
select throws_ok(
  $$ select public.admin_create_slot('22:00', '23:00', 21, '{0}') $$,
  '23514', null, 'more than 20 places is refused'
);
select throws_ok(
  $$ select public.admin_create_slot('22:00', '23:00', 2, '{}') $$,
  '23514', null, 'a slot with no weekday is refused'
);

-- Admin: update --------------------------------------------------------------------

select lives_ok(
  $$ select public.admin_update_slot(tests.s(), 1, '{1,0}', true) $$,
  'an admin lowers a capacity below the places taken and drops weekdays'
);
select results_eq(
  $$ select * from tests.slot_row(tests.s()) $$,
  $$ values (1::smallint, '{0,1}'::smallint[], true) $$,
  'the slot has 1 place on Sunday and Monday'
);
select results_eq(
  $$ select diff from public.admin_audit_log where action = 'slot.update' $$,
  $$ values ('{"capacity": {"from": 3, "to": 1}, "weekdays": {"from": [0, 1, 2, 3, 4, 5, 6], "to": [0, 1]}}'::jsonb) $$,
  'only the changed fields are logged'
);
select lives_ok(
  $$ select public.admin_update_slot(tests.s(), 1, '{0,1}', false) $$,
  'an admin switches the slot off'
);
select is(
  (select count(*)::int from public.slot_bookings where slot_id = tests.s()),
  2,
  'both orders still hold their places'
);
select lives_ok(
  $$ select public.admin_update_slot(tests.s(), 1, '{0,1}', false) $$,
  'saving the same values again works'
);
select is(tests.audit('slot.update'), 2, 'and logs nothing');
select throws_ok(
  $$ select public.admin_update_slot(999999, 1, '{0}', true) $$,
  'P0002', 'slot_not_found', 'an unknown slot is refused'
);

select * from finish();
rollback;
