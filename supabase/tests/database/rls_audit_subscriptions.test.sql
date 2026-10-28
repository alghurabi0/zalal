-- RLS audit of migrations subscription_notification_types and subscriptions
-- (Phase 6, task 2).
--
-- Finding (fixed in the same migration): an admin override back into a
-- visit-holding status skipped every coverage check. transition_order
-- checked coverage only on the normal pending_confirmation -> confirmed
-- move; an override (cancelled or no_show -> confirmed, on_the_way,
-- arrived, in_progress or completed) brought a covered order back with its
-- subscription_id and no check of the visits left, the period or the
-- subscription's status. A subscription whose visits were all used or held
-- could then hold or use one more, and the crew completed that order
-- without collecting cash. transition_order now runs
-- private.usable_subscription when an override enters an open or completed
-- status from cancelled or no_show (ZL034). The first two tests check the
-- invariant (used + held <= total).
--
-- The rest are attacks that held (passing): Realtime events of another
-- customer's subscription, the view's security_invoker, guest EXECUTE on the
-- new functions, customers and crews on the A7 RPCs they had no test for,
-- crews on the overview, an admin turned customer, a deleted account asking
-- for a subscription, and the decline notice carrying the admin's reason.
begin;
\ir _helpers.psql

select plan(19);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B (attacker)
select tests.create_user('+9647805555555');            -- customer C
select tests.create_user('+9647806666666');            -- customer D
select tests.create_user('+9647504444444', 'admin');
select tests.create_user('+9647504444445', 'admin');   -- admin turned customer
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;
create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;

-- Runs p_sql as the current role; true if it succeeded, false if it raised.
create function tests.try(p_sql text) returns boolean language plpgsql
as $$
begin
  execute p_sql;
  return true;
exception when others then
  return false;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- Finding: override revives a covered order past its visits -------------------------------------

-- C: 1 visit, already used by a completed order; a cancelled covered order.
insert into tests.ids values ('sub_c', tests.create_subscription(tests.user_id('+9647805555555'), 'active', p_visits => 1));
insert into tests.ids values
  ('c_done', tests.create_order(tests.user_id('+9647805555555'), 'completed', now() - interval '3 days')),
  ('c_cancelled', tests.create_order(tests.user_id('+9647805555555'), 'cancelled'));
update public.orders set subscription_id = tests.id('sub_c')
where id in (tests.id('c_done'), tests.id('c_cancelled'));

-- D: 1 visit, already used; a no-show covered order.
insert into tests.ids values ('sub_d', tests.create_subscription(tests.user_id('+9647806666666'), 'active', p_visits => 1));
insert into tests.ids values
  ('d_done', tests.create_order(tests.user_id('+9647806666666'), 'completed', now() - interval '3 days')),
  ('d_no_show', tests.create_order(tests.user_id('+9647806666666'), 'no_show', now() - interval '1 day', tests.id('crew')));
update public.orders set subscription_id = tests.id('sub_d')
where id in (tests.id('d_done'), tests.id('d_no_show'));

select tests.authenticate_as(tests.admin());
select tests.try($$
  select public.transition_order(tests.id('c_cancelled'), 'confirmed', '{"override": true, "reason": "رجعناه"}')
$$);
select tests.try($$
  select public.transition_order(tests.id('d_no_show'), 'completed', '{"override": true, "reason": "صار التنظيف"}')
$$);

select tests.clear_authentication();
select ok(
  (select visits_used + visits_held <= visits_total
   from public.subscription_overview where id = tests.id('sub_c')),
  'an override out of cancelled cannot make a used-up subscription hold another visit'
);
select ok(
  (select visits_used + visits_held <= visits_total
   from public.subscription_overview where id = tests.id('sub_d')),
  'an override out of no_show into completed cannot use more visits than the subscription has'
);

-- Fixtures for the checks that held ---------------------------------------------------------------

delete from public.service_areas;
insert into public.service_areas (name, area)
values ('Test Karbala', 'SRID=4326;MULTIPOLYGON(((43.9 32.5, 44.1 32.5, 44.1 32.7, 43.9 32.7, 43.9 32.5)))');
insert into tests.ids values
  ('home_a', tests.create_address(tests.a(), 'home')),
  ('home_b', tests.create_address(tests.b(), 'home'));
insert into tests.ids values
  ('sub_a', tests.create_subscription(tests.a(), 'active', p_address_id => tests.id('home_a'))),
  ('request_b', tests.create_subscription(tests.b(), 'requested', p_address_id => tests.id('home_b')));
insert into tests.ids values ('order_a', tests.create_order(tests.a(), 'pending_confirmation'));
update public.orders set subscription_id = tests.id('sub_a') where id = tests.id('order_a');

-- Realtime ---------------------------------------------------------------------------------------

-- A wal2json (v2) record, as Realtime feeds it to apply_rls (see
-- rls_audit_live_job.test.sql).
create function tests.wal(p_action text, p_table regclass, p_row jsonb)
returns jsonb language sql stable
as $$
  with cols as (
    select a.attname as name, format_type(a.atttypid, null) as type, a.atttypid::int as typeoid,
      exists (
        select 1 from pg_index i
        where i.indrelid = p_table and i.indisprimary and a.attnum = any(i.indkey)
      ) as is_pk
    from pg_attribute a
    where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped
  )
  select jsonb_build_object(
    'action', p_action,
    'schema', (select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = p_table),
    'table', (select c.relname from pg_class c where c.oid = p_table),
    'timestamp', now(),
    'pk', (select jsonb_agg(jsonb_build_object('name', name, 'type', type, 'typeoid', typeoid)) from cols where is_pk),
    'identity', (select jsonb_agg(jsonb_build_object('name', name, 'type', type, 'typeoid', typeoid, 'value', p_row -> name)) from cols where is_pk),
    'columns', case when p_action = 'D' then '[]'::jsonb else
      (select jsonb_agg(jsonb_build_object('name', name, 'type', type, 'typeoid', typeoid, 'value', p_row -> name)) from cols) end
  );
$$;

create function tests.delivered(p_sub uuid, p_wal jsonb)
returns setof jsonb language sql volatile
as $$
  select r.wal from realtime.apply_rls(p_wal) as r
  where p_sub = any(r.subscription_ids) and cardinality(r.errors) = 0;
$$;

create function tests.sub_a_row() returns jsonb language sql stable
as $$ select to_jsonb(s) from public.subscriptions as s where s.id = tests.id('sub_a') $$;

insert into realtime.subscription (subscription_id, entity, claims)
values
  ('00000000-0000-4000-8000-00000000000a', 'public.subscriptions',
   jsonb_build_object('role', 'authenticated', 'sub', tests.a())),
  ('00000000-0000-4000-8000-00000000000b', 'public.subscriptions',
   jsonb_build_object('role', 'authenticated', 'sub', tests.b())),
  ('00000000-0000-4000-8000-00000000000c', 'public.subscriptions',
   jsonb_build_object('role', 'authenticated', 'sub', tests.user_id('+9647703333333')));

select is(
  (select count(*)::int from tests.delivered(
     '00000000-0000-4000-8000-00000000000a', tests.wal('U', 'public.subscriptions', tests.sub_a_row()))),
  1,
  'Realtime sends a customer the update of their own subscription'
);
select is(
  (select count(*)::int from tests.delivered(
     '00000000-0000-4000-8000-00000000000b', tests.wal('U', 'public.subscriptions', tests.sub_a_row()))),
  0,
  'but not another customer'
);
select is(
  (select count(*)::int from tests.delivered(
     '00000000-0000-4000-8000-00000000000c', tests.wal('U', 'public.subscriptions', tests.sub_a_row()))),
  0,
  'nor a crew'
);
select is(
  (select array_agg(a.attname::text)
   from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
   where i.indrelid = 'public.subscriptions'::regclass and i.indisprimary),
  array['id'],
  'a DELETE event carries only the subscription''s own uuid, no user or address id'
);

-- The view and EXECUTE ----------------------------------------------------------------------------

select ok(
  (select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.subscription_overview'::regclass),
  'subscription_overview runs under the caller''s RLS'
);
select is(
  (select count(*)::int from pg_proc as p
   where p.oid in (
     'public.request_subscription(uuid)'::regprocedure,
     'public.admin_activate_subscription(uuid, date, integer, integer, integer, boolean, text)'::regprocedure,
     'public.admin_set_subscription_paid(uuid, boolean)'::regprocedure,
     'public.admin_adjust_subscription_visits(uuid, integer, text)'::regprocedure,
     'public.admin_end_subscription(uuid, text)'::regprocedure,
     'public.admin_add_subscription_note(uuid, text)'::regprocedure,
     'public.admin_set_order_subscription(uuid, boolean)'::regprocedure,
     'public.create_order(uuid, uuid, date, bigint, jsonb, text, jsonb, integer, boolean)'::regprocedure
   ) and has_function_privilege('anon', p.oid, 'execute')),
  0,
  'guests cannot execute any of the new public functions'
);
select is(
  (select count(*)::int from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order'),
  1,
  'the old create_order signature is gone'
);

-- A7 RPCs as a customer and a crew ------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.admin_set_order_subscription(tests.id('order_a'), false) $$,
  '42501', 'not_allowed', 'a customer cannot drop or add coverage on an order'
);
select throws_ok(
  $$ select public.admin_adjust_subscription_visits(tests.id('sub_a'), -1, 'هدية') $$,
  '42501', 'not_allowed', 'nor give themselves visits'
);
select throws_ok(
  $$ select public.admin_set_subscription_paid(tests.id('sub_a'), true) $$,
  '42501', 'not_allowed', 'nor tick their subscription paid'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_set_order_subscription(tests.id('order_a'), false) $$,
  '42501', 'not_allowed', 'a crew cannot change an order''s coverage'
);
select is(
  (select count(*)::int from public.subscription_overview),
  0,
  'and reads nothing from the overview'
);

-- Stale roles ------------------------------------------------------------------------------------

select tests.clear_authentication();
update public.profiles set role = 'customer' where id = tests.user_id('+9647504444445');
select tests.authenticate_as(tests.user_id('+9647504444445'));
select is(
  (select count(*)::int from public.subscription_overview),
  0,
  'an admin turned customer reads no one''s subscriptions'
);

select tests.clear_authentication();
update public.settings as s set subscription_price_iqd = 60000 where s.id;
update public.profiles set deleted_at = now() where id = tests.b();
select tests.authenticate_as(tests.b());
select throws_ok(
  $$ select public.request_subscription(tests.id('home_b')) $$,
  '42501', 'not_allowed', 'a deleted account cannot ask for a subscription'
);
select tests.clear_authentication();
update public.profiles set deleted_at = null where id = tests.b();

-- Notification data ----------------------------------------------------------------------------

select tests.authenticate_as(tests.admin());
select public.admin_end_subscription(tests.id('request_b'), 'رقم غلط سري');
select tests.clear_authentication();
select is(
  (select count(*)::int from public.notifications
   where user_id = tests.b() and type = 'subscription_declined'
     and audience = 'customer' and data::text not like '%رقم غلط سري%'),
  1,
  'the decline notice reaches the customer without the admin''s internal reason'
);
select tests.authenticate_as(tests.b());
insert into tests.ids select 'request_b2', public.request_subscription(tests.id('home_b'));
select is(
  (select count(*)::int from public.notifications where type = 'subscription_requested'),
  0,
  'the customer who asked cannot read the request notice meant for admins'
);
select tests.authenticate_as(tests.admin());
select is(
  (select count(*)::int from public.notifications
   where type = 'subscription_requested' and data ->> 'subscription_id' = tests.id('request_b2')::text),
  1,
  'which the admin reads'
);

select * from finish();
rollback;
