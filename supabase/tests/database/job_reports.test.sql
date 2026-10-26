-- job_reports and the C4 finish form (spec §6, §7, §8.1 C4).
-- When the crew completes a job, transition_order() takes the C4 fields from
-- its payload: sterilant (required, 2–120 characters, ZL011
-- sterilant_required when blank), residual_chlorine_mg_l (optional, a number
-- from 0 to 10 with at most one decimal) and note (optional, internal: it
-- goes to order_event_notes on the completion event, which the customer never
-- reads). Sterilant and chlorine are saved in job_reports, one row per order,
-- which Phase 4 copies onto the certificate. An admin override to completed
-- needs none of them and writes no report. job_reports is read with its
-- order (the customer, the assigned crew, admins); nobody writes it directly.
begin;
\ir _helpers.psql

select plan(32);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;

insert into tests.ids values
  ('job', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('plain', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('adm', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1')));

create function tests.finish(p_order text, p_payload jsonb) returns void language sql
as $$ select public.transition_order(tests.id(p_order), 'completed', '{"cash_collected": true}' || p_payload) $$;

grant execute on all functions in schema tests to anon, authenticated;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.job_reports'::regclass),
  'RLS is on for job_reports'
);

-- The crew's completion ----------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));

select throws_ok(
  $$ select tests.finish('job', '{}') $$,
  'ZL011', 'sterilant_required', 'the crew names the sterilant'
);
select throws_ok(
  $$ select tests.finish('job', '{"sterilant": "   "}') $$,
  'ZL011', 'sterilant_required', 'a blank sterilant is missing'
);
select throws_ok(
  $$ select tests.finish('job', jsonb_build_object('sterilant', repeat('ك', 121))) $$,
  '22023', 'invalid_sterilant', 'the sterilant is at most 120 characters'
);
select throws_ok(
  $$ select tests.finish('job', '{"sterilant": "ك"}') $$,
  '22023', 'invalid_sterilant', 'and at least 2'
);
select throws_ok(
  $$ select tests.finish('job', '{"sterilant": "كلور", "residual_chlorine_mg_l": "0.5"}') $$,
  '22023', 'invalid_chlorine', 'the chlorine reading is a number'
);
select throws_ok(
  $$ select tests.finish('job', '{"sterilant": "كلور", "residual_chlorine_mg_l": 10.5}') $$,
  '22023', 'invalid_chlorine', 'at most 10 mg/L'
);
select throws_ok(
  $$ select tests.finish('job', '{"sterilant": "كلور", "residual_chlorine_mg_l": -1}') $$,
  '22023', 'invalid_chlorine', 'not negative'
);
select throws_ok(
  $$ select tests.finish('job', '{"sterilant": "كلور", "residual_chlorine_mg_l": 0.55}') $$,
  '22023', 'invalid_chlorine', 'one decimal at most'
);
select throws_ok(
  $$ select tests.finish('job', '{"sterilant": "كلور"}' || jsonb_build_object('note', repeat('ن', 501))) $$,
  '23514', null, 'the note is at most 500 characters'
);
select is(
  (select status::text from public.orders where id = tests.id('job')),
  'in_progress',
  'a refused finish changes nothing'
);
select lives_ok(
  $$ select tests.finish('job', '{"sterilant": " كلور الصوديوم 10% ", "residual_chlorine_mg_l": 0.5, "note": " الخزان قديم "}') $$,
  'the crew completes with the full form'
);
select results_eq(
  $$ select order_id, crew_id, sterilant, residual_chlorine_mg_l from public.job_reports $$,
  $$ values (tests.id('job'), tests.id('crew1'), 'كلور الصوديوم 10%', 0.5::numeric) $$,
  'the report keeps the trimmed sterilant and the reading'
);
select results_eq(
  $$ select n.note from public.order_event_notes as n
     join public.order_events as e on e.id = n.event_id
     where e.order_id = tests.id('job') and e.to_status = 'completed' $$,
  $$ values ('الخزان قديم') $$,
  'the note is an internal note on the completion event'
);
select lives_ok(
  $$ select tests.finish('plain', '{"sterilant": "كلور", "residual_chlorine_mg_l": null, "note": ""}') $$,
  'chlorine and note are optional'
);
select results_eq(
  $$ select residual_chlorine_mg_l from public.job_reports where order_id = tests.id('plain') $$,
  $$ values (null::numeric) $$,
  'no reading is saved as none'
);
select is_empty(
  $$ select 1 from public.order_event_notes where order_id = tests.id('plain') $$,
  'and an empty note adds no note'
);

-- Admin override, then the crew again ------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select public.transition_order(tests.id('adm'), 'completed', '{"override": true, "reason": "سكرناه من المكتب"}') $$,
  'an admin override completes without the form'
);
select is_empty(
  $$ select 1 from public.job_reports where order_id = tests.id('adm') $$,
  'and writes no report'
);
select lives_ok(
  $$ select public.transition_order(tests.id('job'), 'in_progress', '{"override": true, "reason": "رجعناه"}') $$,
  'an admin reopens a completed job'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select lives_ok(
  $$ select tests.finish('job', '{"sterilant": "كلور ثاني", "residual_chlorine_mg_l": 1}') $$,
  'the crew completes it again'
);
select results_eq(
  $$ select sterilant, residual_chlorine_mg_l from public.job_reports where order_id = tests.id('job') $$,
  $$ values ('كلور ثاني', 1::numeric) $$,
  'the report is replaced, still one row'
);

-- Reads and writes ---------------------------------------------------------------

select tests.authenticate_as(tests.a());
select results_eq(
  $$ select order_id from public.job_reports order by order_id $$,
  $$ select unnest(array[tests.id('job'), tests.id('plain')]) order by 1 $$,
  'the customer reads the reports of their orders'
);
select is_empty(
  $$ select 1 from public.order_event_notes where order_id = tests.id('job') $$,
  'but never the crew note'
);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select 1 from public.job_reports $$, 'another customer reads none');

select tests.authenticate_as(tests.user_id('+9647703333334'));
select is_empty($$ select 1 from public.job_reports $$, 'another crew reads none');

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is(
  (select count(*)::int from public.job_reports), 2, 'the assigned crew reads its reports'
);
select throws_ok(
  $$ insert into public.job_reports (order_id, crew_id, sterilant)
     values (tests.id('adm'), tests.id('crew1'), 'كلور') $$,
  '42501', null, 'the crew cannot write a report directly'
);

select tests.authenticate_as_anon();
select throws_ok($$ select 1 from public.job_reports $$, '42501', null, 'a guest reads nothing');

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.job_reports), 2, 'an admin reads every report');
select throws_ok(
  $$ update public.job_reports set sterilant = 'غير' where order_id = tests.id('job') $$,
  '42501', null, 'not even an admin writes reports directly'
);

select tests.clear_authentication();
update public.crews set active = false where id = tests.id('crew1');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select 1 from public.job_reports $$, 'a switched-off crew reads none');

select * from finish();
rollback;
