-- crew_live_location and share_crew_location() (spec §5.13, §6, §7, §8.1, §8.2 A3).
-- While a job is on_the_way, the assigned crew's phone sends its position
-- through share_crew_location(order_id, lat, lng, accuracy_m), which keeps
-- one row per order. Only the assigned, active crew may share (others get
-- P0002 order_not_found, other roles 42501 not_allowed), only while the
-- order is on the way (ZL024 location_not_allowed), and a call less than
-- 10 s after the last saved position writes nothing and returns false.
-- Reads: the customer while the order is on the way and the position is
-- from the crew now assigned; the assigned crew; admins. Nobody writes the
-- table directly. A nightly job deletes positions of orders that are no
-- longer on the way, 24 h after the last update.
begin;
\ir _helpers.psql

select plan(45);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;

insert into tests.ids values
  ('way', tests.create_order(tests.a(), 'on_the_way', p_crew_id => tests.id('crew1'))),
  ('conf', tests.create_order(tests.a(), 'confirmed', p_crew_id => tests.id('crew1'))),
  ('there', tests.create_order(tests.a(), 'arrived', p_crew_id => tests.id('crew1'))),
  ('other', tests.create_order(tests.a(), 'on_the_way', p_crew_id => tests.id('crew2')));

create function tests.share(p_order text, p_lat float8 default 32.6, p_lng float8 default 44.02)
returns boolean language sql
as $$ select public.share_crew_location(tests.id(p_order), p_lat, p_lng, 12) $$;

grant execute on all functions in schema tests to anon, authenticated;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.crew_live_location'::regclass),
  'RLS is on for crew_live_location'
);
select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crew_live_location'
  ),
  'crew_live_location is in the Realtime publication'
);
select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_media'
  ),
  'order_media is in the Realtime publication'
);

-- Sharing ------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));

select is(tests.share('way'), true, 'the assigned crew shares its position on the way');
select results_eq(
  $$ select crew_id, lat, lng, accuracy_m,
       round(extensions.st_y(location::extensions.geometry)::numeric, 2),
       round(extensions.st_x(location::extensions.geometry)::numeric, 2)
     from public.crew_live_location where order_id = tests.id('way') $$,
  $$ values (tests.id('crew1'), 32.6::float8, 44.02::float8, 12, 32.60, 44.02) $$,
  'one row with the crew, the point and the accuracy'
);
select is(tests.share('way', 32.7, 44.1), false, 'a second position within 10 s is skipped');
select is(
  (select lat from public.crew_live_location where order_id = tests.id('way')),
  32.6::float8,
  'and changes nothing'
);

select tests.clear_authentication();
alter table public.crew_live_location disable trigger crew_live_location_set_updated_at;
update public.crew_live_location set updated_at = now() - interval '11 seconds'
where order_id = tests.id('way');
alter table public.crew_live_location enable trigger crew_live_location_set_updated_at;
select tests.authenticate_as(tests.user_id('+9647703333333'));

select is(tests.share('way', 32.7, 44.1), true, 'after 10 s the next position is saved');
select results_eq(
  $$ select count(*)::int, max(lat), bool_and(updated_at = now())
     from public.crew_live_location where order_id = tests.id('way') $$,
  $$ values (1, 32.7::float8, true) $$,
  'still one row, moved, with a fresh time'
);

select throws_ok(
  $$ select tests.share('conf') $$,
  'ZL024', 'location_not_allowed', 'not before the crew sets off'
);
select throws_ok(
  $$ select tests.share('there') $$,
  'ZL024', 'location_not_allowed', 'not after it arrived'
);
select throws_ok(
  $$ select tests.share('other') $$,
  'P0002', 'order_not_found', 'not for another crew''s job'
);
select throws_ok(
  $$ select public.share_crew_location(gen_random_uuid(), 32.6, 44.02, 12) $$,
  'P0002', 'order_not_found', 'not for a missing order'
);
select throws_ok(
  $$ select tests.share('way', 91, 44.02) $$,
  '22023', 'invalid_location', 'latitude is checked'
);
select throws_ok(
  $$ select tests.share('way', 32.6, 181) $$,
  '22023', 'invalid_location', 'longitude is checked'
);
select throws_ok(
  $$ select public.share_crew_location(tests.id('way'), 32.6, 44.02, -1) $$,
  '22023', 'invalid_location', 'accuracy is not negative'
);
select throws_ok(
  $$ select public.share_crew_location(tests.id('way'), null, 44.02, 12) $$,
  '22023', 'invalid_location', 'a position is required'
);
select throws_ok(
  $$ insert into public.crew_live_location (order_id, crew_id, lat, lng, accuracy_m)
     values (tests.id('conf'), tests.id('crew1'), 32.6, 44.02, 5) $$,
  '42501', null, 'the crew cannot write the table directly'
);
select throws_ok(
  $$ update public.crew_live_location set lat = 30 where order_id = tests.id('way') $$,
  '42501', null, 'or move a position by hand'
);

select tests.authenticate_as(tests.user_id('+9647703333334'));
select is(tests.share('other'), true, 'the other crew shares its own job');

-- Other roles cannot share ------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select tests.share('way') $$,
  '42501', 'not_allowed', 'the customer cannot share a position'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select tests.share('way') $$,
  '42501', 'not_allowed', 'nor can an admin'
);
select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.share_crew_location(tests.id('way'), 32.6, 44.02, 12) $$,
  '42501', null, 'nor a guest'
);

-- Reads --------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select results_eq(
  $$ select order_id from public.crew_live_location order by order_id $$,
  $$ select unnest(array[tests.id('way'), tests.id('other')]) order by 1 $$,
  'the customer reads the positions of their orders on the way'
);
select throws_ok(
  $$ delete from public.crew_live_location $$,
  '42501', null, 'and cannot delete them'
);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select 1 from public.crew_live_location $$, 'another customer reads none');

select tests.authenticate_as(tests.user_id('+9647703333333'));
select results_eq(
  $$ select order_id from public.crew_live_location $$,
  $$ values (tests.id('way')) $$,
  'a crew reads only its own jobs'' positions'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.crew_live_location), 2, 'an admin reads every position');
select throws_ok(
  $$ delete from public.crew_live_location $$,
  '42501', null, 'not even an admin writes positions directly'
);

select tests.authenticate_as_anon();
select throws_ok($$ select 1 from public.crew_live_location $$, '42501', null, 'a guest reads nothing');

-- Reassigned on the way: the old crew's position is hidden from the customer.
select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select public.assign_crew(tests.id('other'), tests.id('crew1')) $$,
  'an admin gives the job on the way to another crew'
);
select tests.authenticate_as(tests.a());
select is_empty(
  $$ select 1 from public.crew_live_location where order_id = tests.id('other') $$,
  'the customer no longer sees the old crew''s position'
);
select tests.authenticate_as(tests.user_id('+9647703333334'));
select is_empty(
  $$ select 1 from public.crew_live_location where order_id = tests.id('other') $$,
  'nor does the old crew'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is(tests.share('other'), true, 'the new crew shares at once, without waiting 10 s');
select tests.authenticate_as(tests.a());
select results_eq(
  $$ select crew_id from public.crew_live_location where order_id = tests.id('other') $$,
  $$ values (tests.id('crew1')) $$,
  'and the customer sees the new crew'
);

-- Arrival hides the position from the customer (the row stays for now).
select tests.authenticate_as(tests.user_id('+9647703333333'));
select lives_ok(
  $$ select public.transition_order(tests.id('way'), 'arrived') $$,
  'the crew arrives'
);
select throws_ok(
  $$ select tests.share('way') $$,
  'ZL024', 'location_not_allowed', 'and stops sharing'
);
select is(
  (select count(*)::int from public.crew_live_location where order_id = tests.id('way')),
  1,
  'the crew still reads the last position'
);
select tests.authenticate_as(tests.a());
select is_empty(
  $$ select 1 from public.crew_live_location where order_id = tests.id('way') $$,
  'the customer no longer reads it'
);

-- A switched-off crew reads and shares nothing.
select tests.clear_authentication();
update public.crews set active = false where id = tests.id('crew1');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select 1 from public.crew_live_location $$, 'a switched-off crew reads none');
select throws_ok(
  $$ select tests.share('other') $$,
  'P0002', 'order_not_found', 'and shares nothing'
);
select tests.clear_authentication();
update public.crews set active = true where id = tests.id('crew1');

-- The nightly purge -------------------------------------------------------------

select is(
  (select schedule from cron.job where jobname = 'purge-live-locations'),
  '27 0 * * *',
  'the purge runs daily at 00:27 UTC (03:27 Baghdad)'
);

alter table public.crew_live_location disable trigger crew_live_location_set_updated_at;
update public.crew_live_location set updated_at = now() - interval '25 hours';
alter table public.crew_live_location enable trigger crew_live_location_set_updated_at;
select is(private.purge_live_locations(), 1, 'it deletes positions of jobs no longer on the way after 24 h');
select results_eq(
  $$ select order_id from public.crew_live_location $$,
  $$ values (tests.id('other')) $$,
  'a job still on the way keeps its position'
);
select ok(
  not has_function_privilege('authenticated', 'private.purge_live_locations()', 'execute'),
  'users cannot run the purge'
);

select * from finish();
rollback;
