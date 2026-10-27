-- The ticket folder of the media cleanup (spec §7 Storage).
-- unattached_media('ticket') lists ticket-media files more than 72 hours old
-- that no ticket has attached (create_ticket takes uploads up to 48 hours
-- old), oldest first. The cron job media-cleanup-ticket asks the Edge
-- Function to delete them nightly at 00:57 UTC (03:57 Baghdad).
begin;
\ir _helpers.psql

select plan(6);

select tests.create_user('+9647801111111');
create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;

delete from public.ticket_media;
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'ticket-media';
reset storage.allow_delete_query;

create function tests.upload(p_bucket text, p_name text, p_age interval) returns void
language plpgsql
as $$
begin
  perform tests.create_object(p_bucket, p_name, tests.a());
  update storage.objects
  set created_at = now() - p_age, updated_at = now() - p_age
  where bucket_id = p_bucket and name = p_name;
end;
$$;

select tests.upload('ticket-media', tests.a() || '/sent.jpg', '1 hour');
select tests.authenticate_as(tests.a());
select public.create_ticket(
  gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
  jsonb_build_array(jsonb_build_object('path', tests.a() || '/sent.jpg'))
);
select tests.clear_authentication();
update storage.objects set created_at = now() - interval '10 days'
where bucket_id = 'ticket-media' and name = tests.a() || '/sent.jpg';

select tests.upload('ticket-media', tests.a() || '/new.jpg', '71 hours');
select tests.upload('ticket-media', tests.a() || '/old.jpg', '73 hours');
select tests.upload('ticket-media', tests.a() || '/older.jpg', '9 days');
select tests.upload('chat-media', tests.a() || '/elsewhere.jpg', '9 days');

select tests.authenticate_as_service_role();
select results_eq(
  $$ select name from public.unattached_media('ticket') $$,
  $$ values (tests.a() || '/older.jpg'), (tests.a() || '/old.jpg') $$,
  'unattached ticket uploads over 72 h old, oldest first; not attached ones, newer ones or other buckets'
);
select results_eq(
  $$ select name from public.unattached_media('ticket', 10, now() - interval '9 days', tests.a() || '/older.jpg') $$,
  $$ values (tests.a() || '/old.jpg') $$,
  'and pages after a cursor'
);
select tests.clear_authentication();

select is(
  (select schedule from cron.job where jobname = 'media-cleanup-ticket'),
  '57 0 * * *',
  'ticket folder: daily at 00:57 UTC (03:57 Baghdad)'
);
select is(
  (select command from cron.job where jobname = 'media-cleanup-ticket'),
  'select private.invoke_media_cleanup(''ticket'')',
  'ticket folder: calls the Edge Function for the ticket folder'
);

delete from vault.secrets where name in ('project_url', 'media_cleanup_secret');
select vault.create_secret('http://127.0.0.1:54321', 'project_url');
select vault.create_secret('test-cleanup-secret', 'media_cleanup_secret');
select isnt(private.invoke_media_cleanup('ticket'), null, 'the ticket folder is sent');
select is(
  (select convert_from(body, 'utf8')::jsonb from net.http_request_queue order by id desc limit 1),
  '{"folder": "ticket"}'::jsonb,
  'with its name'
);

select * from finish();
rollback;
