-- The certificate folder of the media cleanup (spec §7 Storage, §13
-- "Personal data left after a deletion"; Phase 6, task 4).
-- unattached_media('certificate') lists PDFs in the certificates bucket that
-- no certificates.pdf_path names and that are more than 24 hours old (the
-- server uploads a PDF and records it within seconds; an upsert moves
-- updated_at, which must be as old), oldest first: a PDF
-- whose delete failed after delete_account(), or one left by a failed
-- record. Only the service role reads it. The cron job
-- media-cleanup-certificate asks the Edge Function to delete them nightly at
-- 02:07 UTC (05:07 Baghdad).
begin;
\ir _helpers.psql

select plan(11);

select tests.create_user('+9647801111111');
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));
insert into tests.ids values ('o', tests.create_order(tests.user_id('+9647801111111'), 'completed', now() - interval '3 days'));
insert into public.certificates (order_id, public_code, next_due_on)
values (tests.id('o'), 'ABCDEFGH', current_date + 180);
insert into tests.ids select 'cert', id from public.certificates where order_id = tests.id('o');
grant execute on all functions in schema tests to anon, authenticated;

set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'certificates';
reset storage.allow_delete_query;

create function tests.pdf(p_name text, p_age interval) returns void
language plpgsql
as $$
begin
  insert into storage.objects (bucket_id, name, metadata, created_at, updated_at)
  values ('certificates', p_name, '{"mimetype": "application/pdf", "size": 1000}', now() - p_age, now() - p_age);
end;
$$;

select tests.pdf(tests.id('cert') || '/1.pdf', '30 days');      -- recorded
update public.certificates set pdf_path = tests.id('cert') || '/1.pdf' where id = tests.id('cert');
select tests.pdf(tests.id('cert') || '/0.pdf', '40 days');      -- stale, not recorded
select tests.pdf(gen_random_uuid() || '/9.pdf', '2 days');      -- left after a deletion
select tests.pdf(gen_random_uuid() || '/8.pdf', '23 hours');    -- too new
select tests.pdf(gen_random_uuid() || '/7.pdf', '3 days');      -- upserted again just now
update storage.objects set updated_at = now() where bucket_id = 'certificates' and name like '%/7.pdf';

select tests.authenticate_as_service_role();
select results_eq(
  $$ select name from public.unattached_media('certificate') $$,
  $$ select name from storage.objects
     where bucket_id = 'certificates' and updated_at < now() - interval '24 hours'
       and name <> tests.id('cert') || '/1.pdf'
     order by created_at, name $$,
  'unrecorded PDFs over 24 h old, oldest first; not the recorded one or newer ones'
);
select is(
  (select count(*)::integer from public.unattached_media('certificate')),
  2,
  'two of them'
);
select is_empty(
  $$ select name from public.unattached_media('certificate') where name like '%/7.pdf' $$,
  'a PDF uploaded again within 24 h (upsert) is not listed'
);
select tests.clear_authentication();

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.unattached_media('certificate') $$, '42501', null, 'guests can''t list them');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok($$ select * from public.unattached_media('certificate') $$, '42501', null, 'customers can''t');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok($$ select * from public.unattached_media('certificate') $$, '42501', null, 'crews can''t');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok($$ select * from public.unattached_media('certificate') $$, '42501', null, 'admins can''t');
select tests.clear_authentication();

select is(
  (select schedule from cron.job where jobname = 'media-cleanup-certificate'),
  '7 2 * * *',
  'certificate folder: daily at 02:07 UTC (05:07 Baghdad)'
);
select is(
  (select command from cron.job where jobname = 'media-cleanup-certificate'),
  'select private.invoke_media_cleanup(''certificate'')',
  'certificate folder: calls the Edge Function for the certificate folder'
);

delete from vault.secrets where name in ('project_url', 'media_cleanup_secret');
select vault.create_secret('http://127.0.0.1:54321', 'project_url');
select vault.create_secret('test-cleanup-secret', 'media_cleanup_secret');
select isnt(private.invoke_media_cleanup('certificate'), null, 'the certificate folder is sent');
select is(
  (select convert_from(body, 'utf8')::jsonb from net.http_request_queue order by id desc limit 1),
  '{"folder": "certificate"}'::jsonb,
  'with its name'
);

select * from finish();
rollback;
