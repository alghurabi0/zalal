-- RLS audit of migration live_job (crew_live_location, share_crew_location,
-- Realtime for crew_live_location and order_media).
--
-- Finding (fixed in the migration before merge): Realtime sends every
-- DELETE event of a table with RLS to every authenticated subscriber of that
-- table, without applying RLS, and fills old_record with the primary key.
-- With order_id as the key, the nightly purge (or an order's cascade) would
-- hand any subscriber other customers' order ids. crew_live_location now has
-- its own id key and a unique order_id. The tests run the event through
-- realtime.apply_rls() (the SQL the Realtime server calls) for an unrelated
-- customer's subscription: its DELETE payload must carry no order id.
--
-- The rest are attacks that held (passing): RLS on UPDATE events, the
-- reassigned-away crew, a deleted crew account, a crew account turned
-- customer, non-finite input, and the media DELETE payload.
begin;
\ir _helpers.psql

select plan(12);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B (attacker)
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));
select tests.create_user('+9647504444444', 'admin');

insert into tests.ids values
  ('way', tests.create_order(tests.user_id('+9647801111111'), 'on_the_way', p_crew_id => tests.id('crew1'))),
  ('moved', tests.create_order(tests.user_id('+9647801111111'), 'on_the_way', p_crew_id => tests.id('crew2')));

grant execute on all functions in schema tests to anon, authenticated;

-- A wal2json (v2) record for one row of a table, as Realtime feeds it to
-- apply_rls: `pk` and `identity` hold the table's real primary key columns
-- (replica identity default), `columns` the whole row for INSERT/UPDATE.
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

-- What a subscriber gets for one event: the payload if apply_rls sends it to
-- that subscription, nothing otherwise.
create function tests.delivered(p_sub uuid, p_wal jsonb)
returns setof jsonb language sql volatile
as $$
  select r.wal from realtime.apply_rls(p_wal) as r
  where p_sub = any(r.subscription_ids) and cardinality(r.errors) = 0;
$$;

-- Subscriptions as the Realtime server stores them (postgres_changes, `*`).
insert into realtime.subscription (subscription_id, entity, claims)
values
  ('00000000-0000-4000-8000-00000000000b', 'public.crew_live_location',
   jsonb_build_object('role', 'authenticated', 'sub', tests.user_id('+9647802222222'))),
  ('00000000-0000-4000-8000-00000000000a', 'public.crew_live_location',
   jsonb_build_object('role', 'authenticated', 'sub', tests.user_id('+9647801111111'))),
  ('00000000-0000-4000-8000-0000000000bb', 'public.order_media',
   jsonb_build_object('role', 'authenticated', 'sub', tests.user_id('+9647802222222')));

select tests.authenticate_as(tests.user_id('+9647703333333'));
select public.share_crew_location(tests.id('way'), 32.6, 44.02, 12);
select tests.authenticate_as(tests.user_id('+9647703333334'));
select public.share_crew_location(tests.id('moved'), 32.6, 44.02, 12);
select tests.clear_authentication();

create table tests.row_way as
select to_jsonb(l) as r from public.crew_live_location as l where l.order_id = tests.id('way');

-- Finding: DELETE events leak order ids ----------------------------------------

select is(
  (select count(*)::int from tests.delivered(
     '00000000-0000-4000-8000-00000000000b',
     tests.wal('D', 'public.crew_live_location', (select r from tests.row_way))
   ) as d
   where d -> 'old_record' ? 'order_id'),
  0,
  'a purged position''s DELETE event does not give another customer the order id'
);
select is(
  (select count(*)::int from tests.delivered(
     '00000000-0000-4000-8000-00000000000b',
     tests.wal('D', 'public.crew_live_location', (select r from tests.row_way))
   ) as d
   where (d -> 'old_record')::text like '%' || tests.id('way')::text || '%'),
  0,
  'no field of that DELETE event carries the order id'
);

-- Held: RLS on INSERT/UPDATE events ---------------------------------------------

select is_empty(
  $$ select * from tests.delivered(
       '00000000-0000-4000-8000-00000000000b',
       tests.wal('U', 'public.crew_live_location', (select r from tests.row_way))) $$,
  'another customer gets no UPDATE event for a position'
);
select is(
  (select count(*)::int from tests.delivered(
     '00000000-0000-4000-8000-00000000000a',
     tests.wal('U', 'public.crew_live_location', (select r from tests.row_way)))),
  1,
  'the order''s customer gets it while on the way'
);

-- Held: order_media DELETE events carry only the media's own id ------------------

select is(
  (select count(*)::int from tests.delivered(
     '00000000-0000-4000-8000-0000000000bb',
     tests.wal('D', 'public.order_media',
       jsonb_build_object('id', gen_random_uuid(), 'order_id', tests.id('way'),
                          'path', 'crew/x/' || tests.id('way') || '/a.jpg'))) as d
   where (d -> 'old_record')::text like '%' || tests.id('way')::text || '%'),
  0,
  'an order_media DELETE event shows no order id or path'
);

-- Held: reassignment, deleted and demoted crews, input ---------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.assign_crew(tests.id('moved'), tests.id('crew1'));

select tests.authenticate_as(tests.user_id('+9647703333334'));
select throws_ok(
  $$ select public.share_crew_location(tests.id('moved'), 33, 44, 12) $$,
  'P0002', 'order_not_found',
  'the crew a job was taken from cannot overwrite its position'
);
select is_empty(
  $$ select 1 from public.crew_live_location $$,
  'and reads none of its old position'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.share_crew_location(tests.id('way'), 'NaN', 44, 12) $$,
  '22023', 'invalid_location', 'NaN latitude is refused'
);
select throws_ok(
  $$ select public.share_crew_location(tests.id('way'), 32.6, 44, 'Infinity') $$,
  '22023', 'invalid_location', 'infinite accuracy is refused'
);

select tests.clear_authentication();
update public.profiles set deleted_at = now() where id = tests.user_id('+9647703333333');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.share_crew_location(tests.id('way'), 32.6, 44.02, 12) $$,
  '42501', 'not_allowed', 'a deleted crew account cannot share'
);
select is_empty($$ select 1 from public.crew_live_location $$, 'nor read positions');

select tests.clear_authentication();
update public.profiles set deleted_at = null, role = 'customer' where id = tests.user_id('+9647703333333');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty(
  $$ select 1 from public.crew_live_location $$,
  'a crew account turned customer reads no positions though its crews row is active'
);

select * from finish();
rollback;
