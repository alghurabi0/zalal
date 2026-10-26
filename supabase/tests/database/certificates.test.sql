-- certificates and public_certificate() (spec §5.15, N15, §6, §7, §10.1).
--
-- transition_order() issues the certificate in the same transaction as any
-- move to completed: one row per order with a public code of 8 characters
-- (no 0, 1, I or O), the sterilant and residual chlorine copied from the
-- crew's job report, and next_due_on = the Baghdad completion date + the
-- cleaning interval. An admin override with no report takes the sterilant
-- from settings (none when that is empty too). Completing again after an
-- override keeps the id and code (a printed QR stays valid), refreshes the
-- data and clears pdf_path so the PDF is made again.
--
-- Reads: the customer while the order is completed; admins always. Crews
-- never (the PDF carries the customer's name). Guests have no table access;
-- they look a certificate up by code with public_certificate(), which
-- returns only the number, issue date, district and tanks, and nothing once
-- the order is no longer completed. Nobody but the server (service role)
-- writes the table, and it only sets pdf_path.
begin;
\ir _helpers.psql

select plan(46);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;

insert into tests.ids values
  ('job', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('open', tests.create_order(tests.a(), 'confirmed', p_crew_id => tests.id('crew1'))),
  ('adm', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('adm2', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('b', tests.create_order(tests.user_id('+9647802222222'), 'in_progress', p_crew_id => tests.id('crew1')));

update public.settings as s set sterilant_text = 'كلور الصوديوم', cleaning_interval_months = 6 where s.id;

create function tests.finish(p_order text, p_payload jsonb) returns void language sql
as $$ select public.transition_order(tests.id(p_order), 'completed', '{"cash_collected": true}' || p_payload) $$;

create function tests.cert(p_order text) returns public.certificates language sql stable
as $$ select * from public.certificates where order_id = tests.id(p_order) $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.certificates'::regclass),
  'RLS is on for certificates'
);
select is_empty(
  $$ select 1 from public.certificates $$,
  'no certificate before completion'
);

-- Issued on completion --------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));
select lives_ok(
  $$ select tests.finish('job', '{"sterilant": "كلور 50 ملغ/لتر", "residual_chlorine_mg_l": 0.4}') $$,
  'the crew completes the job'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select lives_ok(
  $$ select tests.finish('b', '{"sterilant": "كلور"}') $$,
  'and another customer''s job'
);
select tests.clear_authentication();

select results_eq(
  $$ select sterilant, residual_chlorine_mg_l, pdf_path from public.certificates where order_id = tests.id('job') $$,
  $$ values ('كلور 50 ملغ/لتر', 0.4::numeric, null::text) $$,
  'the certificate copies the job report and has no PDF yet'
);
select is(
  (tests.cert('job')).next_due_on,
  ((now() at time zone 'Asia/Baghdad')::date + interval '6 months')::date,
  'next cleaning: the Baghdad completion date + the interval'
);
select is((tests.cert('job')).issued_at, now(), 'issued at completion');
select matches(
  (tests.cert('job')).public_code,
  '^[A-HJ-NP-Z2-9]{8}$',
  'the public code is 8 characters without 0, 1, I or O'
);
select isnt(
  (tests.cert('job')).public_code,
  (tests.cert('b')).public_code,
  'each certificate has its own code'
);
select throws_ok(
  $$ update public.certificates set public_code = 'ABCD0123' where order_id = tests.id('job') $$,
  '23514', null, 'a code with 0 or 1 is refused'
);

-- Admin override ----------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select public.transition_order(tests.id('adm'), 'completed', '{"override": true, "reason": "سكرناه من المكتب"}') $$,
  'an admin override completes a job with no report'
);
select tests.clear_authentication();
select results_eq(
  $$ select sterilant, residual_chlorine_mg_l from public.certificates where order_id = tests.id('adm') $$,
  $$ values ('كلور الصوديوم', null::numeric) $$,
  'its certificate takes the sterilant from settings'
);
update public.settings as s set sterilant_text = '' where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select public.transition_order(tests.id('adm2'), 'completed', '{"override": true, "reason": "سكرناه"}') $$,
  'with no sterilant in settings either'
);
select tests.clear_authentication();
select results_eq(
  $$ select sterilant from public.certificates where order_id = tests.id('adm2') $$,
  $$ values (null::text) $$,
  'the certificate has no sterilant row'
);

-- Completing again --------------------------------------------------------------------

select tests.authenticate_as_service_role();
select lives_ok(
  $$ update public.certificates set pdf_path = id || '/1.pdf' where order_id = tests.id('job') $$,
  'the server records the PDF'
);
select tests.clear_authentication();
create table tests.first as
  select c.*, o.number from public.certificates as c join public.orders as o on o.id = c.order_id
  where c.order_id = tests.id('job');
grant select on tests.first to anon, authenticated;

select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select public.transition_order(tests.id('job'), 'in_progress', '{"override": true, "reason": "رجعناه"}') $$,
  'an admin reopens the job'
);
select is_empty(
  $$ select 1 from public.certificates where order_id = tests.id('job') and pdf_path is null $$,
  'reopening leaves the certificate as it was'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select lives_ok(
  $$ select tests.finish('job', '{"sterilant": "كلور ثاني"}') $$,
  'the crew completes it again'
);
select tests.clear_authentication();
select results_eq(
  $$ select id, public_code, sterilant, residual_chlorine_mg_l, pdf_path
     from public.certificates where order_id = tests.id('job') $$,
  $$ select id, public_code, 'كلور ثاني', null::numeric, null::text from tests.first $$,
  'same certificate and code, new data, PDF to be made again'
);
select is(
  (select count(*)::int from public.certificates where order_id = tests.id('job')),
  1,
  'still one certificate for the order'
);

-- Moved out of completed (for the read tests).
select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select public.transition_order(tests.id('adm2'), 'in_progress', '{"override": true, "reason": "غلط"}') $$,
  'an admin moves an order out of completed'
);

-- Reads ---------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select results_eq(
  $$ select order_id from public.certificates order by order_id $$,
  $$ select unnest(array[tests.id('job'), tests.id('adm')]) order by 1 $$,
  'the customer reads the certificates of their completed orders only'
);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select results_eq(
  $$ select order_id from public.certificates $$,
  $$ values (tests.id('b')) $$,
  'another customer reads only their own'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty(
  $$ select 1 from public.certificates $$,
  'the crew reads none, not even its jobs'''
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is(
  (select count(*)::int from public.certificates),
  4,
  'admins read every certificate, also of an order no longer completed'
);

select tests.authenticate_as_anon();
select throws_ok(
  $$ select 1 from public.certificates $$,
  '42501', null, 'guests have no table access'
);

-- Writes ----------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ update public.certificates set sterilant = 'x' where order_id = tests.id('job') $$,
  '42501', null, 'the customer cannot update a certificate'
);
select throws_ok(
  $$ insert into public.certificates (order_id, public_code, next_due_on) values (tests.id('open'), 'ABCDEFGH', now()) $$,
  '42501', null, 'or issue one'
);
select throws_ok(
  $$ delete from public.certificates where order_id = tests.id('job') $$,
  '42501', null, 'or delete one'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ update public.certificates set pdf_path = 'x' where order_id = tests.id('job') $$,
  '42501', null, 'admins cannot write the table either'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ update public.certificates set pdf_path = 'x' where order_id = tests.id('job') $$,
  '42501', null, 'nor the crew'
);

-- public_certificate ----------------------------------------------------------------------

select tests.authenticate_as_anon();
select results_eq(
  $$ select number, issued_at, district, items
     from public.public_certificate((select public_code from tests.first)) $$,
  $$ select number, now(), 'حي الحسين',
       '[{"qty": 1, "size": "m", "tank_type": "roof"}]'::jsonb
     from tests.first $$,
  'a guest looks a certificate up by code: number, date, district and tanks'
);
select results_eq(
  $$ select count(*)::int from public.public_certificate(lower((select public_code from tests.first))) $$,
  $$ values (1) $$,
  'the code is read without case'
);
select is_empty(
  $$ select 1 from public.public_certificate('ZZZZZZZZ') $$,
  'an unknown code finds nothing'
);
select is_empty(
  $$ select 1 from public.public_certificate('') $$,
  'nor does an empty one'
);
select tests.clear_authentication();
create table tests.moved as select public_code from public.certificates where order_id = tests.id('adm2');
grant select on tests.moved to anon, authenticated;
select tests.authenticate_as_anon();
select is_empty(
  $$ select 1 from public.public_certificate((select public_code from tests.moved)) $$,
  'a certificate whose order is no longer completed is not shown'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select results_eq(
  $$ select count(*)::int from public.public_certificate((select public_code from tests.first)) $$,
  $$ values (1) $$,
  'a logged-in user can look one up too'
);
select tests.clear_authentication();

select is(
  (
    select array_agg(a.attname::text order by a.attnum)
    from pg_proc as p
    cross join lateral unnest(p.proargnames) with ordinality as a(attname, attnum)
    where p.oid = 'public.public_certificate(text)'::regprocedure
  ),
  array['p_code', 'number', 'issued_at', 'district', 'items'],
  'public_certificate returns no name, phone, landmark or coordinates'
);
select ok(
  has_function_privilege('anon', 'public.public_certificate(text)', 'execute'),
  'guests may call public_certificate'
);
select ok(
  not has_function_privilege('authenticated', 'private.issue_certificate(uuid)', 'execute'),
  'nobody calls issue_certificate directly'
);

-- Orders completed before the migration (backfill) -------------------------------------------

select tests.clear_authentication();
update public.settings as s set sterilant_text = 'كلور قديم' where s.id;
insert into tests.ids values
  ('old', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('old2', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1')));
insert into public.order_events (order_id, from_status, to_status, actor_role, created_at)
values (tests.id('old'), 'in_progress', 'completed', 'crew', '2026-03-31 22:00+00');
insert into public.job_reports (order_id, crew_id, sterilant, residual_chlorine_mg_l)
values (tests.id('old'), tests.id('crew1'), 'كلور التقرير', 0.3);

select is(private.backfill_certificates(), 2, 'the backfill issues a certificate for each completed order without one');
select results_eq(
  $$ select issued_at, sterilant, residual_chlorine_mg_l, next_due_on, pdf_path
     from public.certificates where order_id = tests.id('old') $$,
  $$ values ('2026-03-31 22:00+00'::timestamptz, 'كلور التقرير', 0.3::numeric, '2026-10-01'::date, null::text) $$,
  'dated at the completion (1 April in Baghdad + 6 months), with the report''s data'
);
select results_eq(
  $$ select sterilant from public.certificates where order_id = tests.id('old2') $$,
  $$ values ('كلور قديم') $$,
  'with no report, the sterilant from settings'
);
select is(private.backfill_certificates(), 0, 'and running it again issues none');

-- The settings paragraph (spec §10.1 item 4) -------------------------------------------------

select col_not_null('public', 'settings', 'certificate_text', 'certificate_text is required');
select throws_ok(
  $$ update public.settings as s set certificate_text = repeat('a', 801) where s.id $$,
  '23514', null, 'certificate_text is at most 800 characters'
);

select * from finish();
rollback;
