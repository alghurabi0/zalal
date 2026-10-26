-- The certificates bucket (spec §7 Storage, §10.1).
--
-- The server (service role) uploads each PDF to <certificate id>/<version>.pdf
-- and records it in certificates.pdf_path. A file is read by whoever reads
-- its certificate through the current pdf_path: the customer while the order
-- is completed, and admins. An older version in the same folder, crews,
-- other customers and guests read nothing. Nobody but the server uploads or
-- deletes.
begin;
\ir _helpers.psql

select plan(12);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));

insert into tests.ids values
  ('o', tests.create_order(tests.user_id('+9647801111111'), 'completed', p_crew_id => tests.id('crew1')));
insert into public.certificates (order_id, public_code, next_due_on)
values (tests.id('o'), 'ABCDEFGH', current_date + 180);
insert into tests.ids select 'cert', id from public.certificates;

create function tests.path(p_version int) returns text language sql stable
as $$ select tests.id('cert')::text || '/' || p_version || '.pdf' $$;
grant execute on all functions in schema tests to anon, authenticated;

select tests.create_object('certificates', tests.path(1), null, 'application/pdf');
select tests.create_object('certificates', tests.path(2), null, 'application/pdf');
update public.certificates set pdf_path = tests.path(2) where id = tests.id('cert');

-- Reads --------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));
select results_eq(
  $$ select name from storage.objects where bucket_id = 'certificates' $$,
  $$ values (tests.path(2)) $$,
  'the customer reads the current PDF only'
);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'certificates' $$,
  'another customer reads none'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'certificates' $$,
  'the crew reads none'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select results_eq(
  $$ select name from storage.objects where bucket_id = 'certificates' $$,
  $$ values (tests.path(2)) $$,
  'admins read the current PDF'
);

select tests.authenticate_as_anon();
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'certificates' $$,
  'guests read none'
);

select tests.clear_authentication();
update public.orders set status = 'in_progress' where id = tests.id('o');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'certificates' $$,
  'the customer loses it once the order is no longer completed'
);
select tests.clear_authentication();
update public.orders set status = 'completed' where id = tests.id('o');

-- Writes -------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select tests.create_object('certificates', tests.path(3), tests.user_id('+9647801111111'), 'application/pdf') $$,
  '42501', null, 'the customer cannot upload'
);
set local storage.allow_delete_query = 'true';
select is_empty(
  $$ delete from storage.objects where bucket_id = 'certificates' returning 1 $$,
  'or delete'
);
select is_empty(
  $$ update storage.objects set name = name || 'x' where bucket_id = 'certificates' returning 1 $$,
  'or rename'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select tests.create_object('certificates', tests.path(3), tests.user_id('+9647504444444'), 'application/pdf') $$,
  '42501', null, 'admins cannot upload either'
);
select is_empty(
  $$ delete from storage.objects where bucket_id = 'certificates' returning 1 $$,
  'or delete'
);

select tests.authenticate_as_service_role();
select lives_ok(
  $$ select tests.create_object('certificates', tests.path(3), null, 'application/pdf') $$,
  'the server uploads'
);

select * from finish();
rollback;
