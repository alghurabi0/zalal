-- orders, order_items, order_events, order_event_notes, order_media and
-- slot_bookings (spec §6, §7). Reads: a customer sees their own orders and everything
-- under them; a crew sees the orders assigned to it while it is active; an
-- admin sees all; guests see nothing. slot_bookings (which order holds which
-- place) is admin-only. Staff notes (order_event_notes) are internal: the
-- assigned crew and admins read them, the customer never does. Writes: nobody, through the API. Orders change only
-- through create_order() and transition_order(), so no role can update
-- orders.status directly.
begin;
\ir _helpers.psql

select plan(51);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));

insert into tests.ids values (
  'order_a', tests.create_order(tests.user_id('+9647801111111'), 'confirmed', p_crew_id => tests.id('crew1'))
);
insert into tests.ids values ('order_b', tests.create_order(tests.user_id('+9647802222222')));

insert into public.order_events (order_id, to_status, actor_id, actor_role)
values (tests.id('order_a'), 'pending_confirmation', tests.user_id('+9647801111111'), 'customer'),
       (tests.id('order_b'), 'pending_confirmation', tests.user_id('+9647802222222'), 'customer');
insert into public.order_event_notes (event_id, order_id, note)
select id, order_id, 'ملاحظة داخلية' from public.order_events;
insert into public.order_media (order_id, kind, media_type, path, bytes, uploaded_by)
values (tests.id('order_a'), 'customer', 'photo', 'customer/a/1.jpg', 1000, tests.user_id('+9647801111111')),
       (tests.id('order_b'), 'customer', 'photo', 'customer/b/1.jpg', 1000, tests.user_id('+9647802222222'));

-- Shape --------------------------------------------------------------------

select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.orders'::regclass, 'public.order_items'::regclass,
                 'public.order_events'::regclass, 'public.order_event_notes'::regclass,
                 'public.order_media'::regclass,
                 'public.slot_bookings'::regclass)),
  'every order table has RLS enabled'
);
select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'),
  'orders is published to Realtime, so status changes reach open screens'
);
select ok(
  (select min(number) from public.orders) >= 1001,
  'order numbers start at 1001'
);
select throws_ok(
  $$ update public.orders set customer_note = repeat('x', 501) where id = tests.id('order_a') $$,
  '23514', null, 'a note is at most 500 characters'
);
select throws_ok(
  $$ update public.orders set address_id = (
       select id from public.addresses where user_id = tests.user_id('+9647802222222')
     ) where id = tests.id('order_a') $$,
  '23503', null, 'an order cannot point at someone else''s address'
);
select throws_ok(
  $$ update public.order_items set qty = 0 where order_id = tests.id('order_a') $$,
  '23514', null, 'a line has at least one tank'
);
select throws_ok(
  $$ insert into public.order_media (order_id, kind, media_type, path, bytes)
     values (tests.id('order_a'), 'customer', 'video', 'customer/a/2.mp4', 1000) $$,
  '23514', null, 'a video has a duration'
);
select throws_ok(
  $$ insert into public.order_media (order_id, kind, media_type, path, bytes, duration_s)
     values (tests.id('order_a'), 'customer', 'video', 'customer/a/2.mp4', 1000, 61) $$,
  '23514', null, 'a video is at most 60 seconds'
);
select throws_ok(
  $$ insert into public.order_media (order_id, kind, media_type, path, bytes)
     values (tests.id('order_a'), 'customer', 'photo', 'customer/a/1.jpg', 1000) $$,
  '23505', null, 'a file belongs to one order'
);
select throws_ok(
  $$ insert into public.slot_bookings (service_date, slot_id, seat, order_id)
     select service_date, slot_id, 99, id from public.orders where id = tests.id('order_a') $$,
  '23505', null, 'an order holds at most one place'
);
select throws_ok(
  $$ insert into public.slot_bookings (service_date, slot_id, seat, order_id)
     select b.service_date, b.slot_id, b.seat, tests.id('order_a')
     from public.slot_bookings as b where b.order_id = tests.id('order_b') $$,
  '23505', null, 'a place is held by one order'
);

-- Guest ----------------------------------------------------------------------

select tests.authenticate_as_anon();

select throws_ok($$ select * from public.orders $$, '42501', null, 'a guest cannot read orders');
select throws_ok($$ select * from public.order_items $$, '42501', null, 'a guest cannot read order lines');
select throws_ok($$ select * from public.order_events $$, '42501', null, 'a guest cannot read order events');
select throws_ok($$ select * from public.order_media $$, '42501', null, 'a guest cannot read order media');
select throws_ok($$ select * from public.slot_bookings $$, '42501', null, 'a guest cannot read slot bookings');
select throws_ok($$ select * from public.order_event_notes $$, '42501', null, 'a guest cannot read staff notes');

-- Customer A -------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select results_eq(
  $$ select id from public.orders $$,
  $$ values (tests.id('order_a')) $$,
  'a customer reads only their own orders'
);
select results_eq(
  $$ select distinct order_id from public.order_items $$,
  $$ values (tests.id('order_a')) $$,
  'a customer reads only their own order lines'
);
select results_eq(
  $$ select order_id from public.order_events $$,
  $$ values (tests.id('order_a')) $$,
  'a customer reads only their own order events'
);
select results_eq(
  $$ select order_id from public.order_media $$,
  $$ values (tests.id('order_a')) $$,
  'a customer reads only their own order media'
);
select is_empty($$ select * from public.slot_bookings $$, 'a customer reads no slot bookings');
select is_empty(
  $$ select * from public.order_event_notes $$,
  'a customer reads no staff notes, even on their own order'
);
select throws_ok(
  $$ insert into public.order_event_notes (event_id, order_id, note)
     select id, order_id, 'x' from public.order_events limit 1 $$,
  '42501', null, 'a customer cannot write staff notes'
);
select throws_ok(
  $$ update public.orders set status = 'cancelled' where id = tests.id('order_a') $$,
  '42501', null, 'a customer cannot change an order''s status directly'
);
select throws_ok(
  $$ insert into public.orders (customer_id, address_id, district, landmark, lat, lng,
       service_date, slot_id, slot_start_at, slot_end_at, total_iqd, client_request_id)
     select customer_id, address_id, district, landmark, lat, lng, service_date, slot_id,
       slot_start_at, slot_end_at, 0, gen_random_uuid()
     from public.orders where id = tests.id('order_a') $$,
  '42501', null, 'a customer cannot insert orders directly'
);
select throws_ok(
  $$ delete from public.orders $$,
  '42501', null, 'a customer cannot delete orders'
);
select throws_ok(
  $$ update public.order_items set unit_price_iqd = 1 $$,
  '42501', null, 'a customer cannot change prices on an order'
);
select throws_ok(
  $$ insert into public.order_events (order_id, to_status) values (tests.id('order_a'), 'completed') $$,
  '42501', null, 'a customer cannot write order events'
);
select throws_ok(
  $$ insert into public.order_media (order_id, kind, media_type, path, bytes)
     values (tests.id('order_a'), 'after', 'photo', 'customer/a/3.jpg', 1) $$,
  '42501', null, 'a customer cannot attach media directly'
);

-- Customer B -------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647802222222'));

select results_eq(
  $$ select id from public.orders $$,
  $$ values (tests.id('order_b')) $$,
  'another customer does not see the first customer''s order'
);
select is_empty(
  $$ select * from public.order_media where order_id = tests.id('order_a') $$,
  'another customer does not see the first customer''s media'
);

-- Crews ------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));

select results_eq(
  $$ select id from public.orders $$,
  $$ values (tests.id('order_a')) $$,
  'a crew reads the orders assigned to it'
);
select results_eq(
  $$ select distinct order_id from public.order_items $$,
  $$ values (tests.id('order_a')) $$,
  'a crew reads the lines of its orders'
);
select results_eq(
  $$ select order_id from public.order_media $$,
  $$ values (tests.id('order_a')) $$,
  'a crew reads the media of its orders'
);
select is_empty($$ select * from public.slot_bookings $$, 'a crew reads no slot bookings');
select results_eq(
  $$ select order_id from public.order_event_notes $$,
  $$ values (tests.id('order_a')) $$,
  'a crew reads the staff notes of its orders only'
);
select throws_ok(
  $$ update public.order_event_notes set note = 'x' $$,
  '42501', null, 'a crew cannot change staff notes directly'
);
select throws_ok(
  $$ update public.orders set status = 'on_the_way' $$,
  '42501', null, 'a crew cannot change an order''s status directly'
);

select tests.authenticate_as(tests.user_id('+9647703333334'));

select is_empty($$ select * from public.orders $$, 'a crew does not see other crews'' orders');
select is_empty($$ select * from public.order_events $$, 'a crew does not see other crews'' order events');

select tests.clear_authentication();
update public.crews set active = false where id = tests.id('crew1');
select tests.authenticate_as(tests.user_id('+9647703333333'));

select is_empty($$ select * from public.orders $$, 'an inactive crew sees no orders');

select tests.clear_authentication();
update public.crews set active = true where id = tests.id('crew1');

-- Admin ----------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select is((select count(*)::int from public.orders), 2, 'an admin reads every order');
select is((select count(*)::int from public.order_items), 2, 'an admin reads every order line');
select is((select count(*)::int from public.order_events), 2, 'an admin reads every order event');
select is((select count(*)::int from public.order_media), 2, 'an admin reads all order media');
select is((select count(*)::int from public.slot_bookings), 2, 'an admin reads the slot bookings');
select is((select count(*)::int from public.order_event_notes), 2, 'an admin reads every staff note');
select throws_ok(
  $$ update public.orders set status = 'completed' $$,
  '42501', null, 'an admin cannot change an order''s status directly'
);
select throws_ok(
  $$ update public.orders set crew_id = null $$,
  '42501', null, 'an admin cannot assign crews directly (an audited RPC comes in Phase 3)'
);
select throws_ok(
  $$ delete from public.slot_bookings $$,
  '42501', null, 'an admin cannot free places directly'
);

select * from finish();
rollback;
