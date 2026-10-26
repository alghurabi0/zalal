-- RLS audit of migration crew_jobs: crew_job_contact() must not hand out the
-- name and phone of a deleted account. Account deletion (N13) soft-deletes
-- and anonymizes personal data, and everywhere else a profile with
-- deleted_at set counts as gone (private.current_user_role(),
-- check_crew_account, the admin staff RPCs). crew_job_contact() joins
-- profiles without `p.deleted_at is null`, so an open job of a deleted
-- customer still gives the crew the customer's phone. The safe behavior is
-- P0002 order_not_found, as for any job the crew may not call about.
begin;
\ir _helpers.psql

select plan(2);

select tests.create_user('+9647801111111');            -- customer, later deleted
select tests.create_user('+9647802222222');            -- customer, live
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values
  ('deleted', tests.create_order(tests.user_id('+9647801111111'), 'confirmed', p_crew_id => tests.id('crew1'))),
  ('live', tests.create_order(tests.user_id('+9647802222222'), 'confirmed', p_crew_id => tests.id('crew1')));

-- N13 is not built yet, so mark the account deleted the way the server will.
update public.profiles set deleted_at = now() where id = tests.user_id('+9647801111111');

grant execute on all functions in schema tests to authenticated;

select tests.authenticate_as(tests.user_id('+9647703333333'));

select results_eq(
  $$ select phone from public.crew_job_contact(tests.id('live')) $$,
  $$ values ('+9647802222222'::text) $$,
  'the assigned crew still reads a live customer''s phone'
);
select throws_ok(
  $$ select * from public.crew_job_contact(tests.id('deleted')) $$,
  'P0002', 'order_not_found',
  'the assigned crew cannot read the phone of a deleted customer'
);

select * from finish();
rollback;
