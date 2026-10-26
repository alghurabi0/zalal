-- The chat folder of the media cleanup (spec §7 Storage). unattached_media('chat')
-- lists chat-media files more than 72 hours old that no message has
-- attached (send_chat_message takes uploads up to 48 hours old), oldest
-- first. The cron job media-cleanup-chat asks the Edge Function to delete
-- them nightly at 00:37 UTC (03:37 Baghdad).
begin;
\ir _helpers.psql

select plan(7);

select tests.create_user('+9647801111111');
create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;

update public.settings as s
set working_days = '{0,1,2,3,4,5,6}', working_hours_start = '00:00', working_hours_end = '24:00'
where s.id;

delete from public.chat_messages;
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'chat-media';
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

select tests.upload('chat-media', tests.a() || '/sent.jpg', '1 hour');
select tests.authenticate_as(tests.a());
select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/sent.jpg');
select tests.clear_authentication();
update storage.objects set created_at = now() - interval '10 days'
where bucket_id = 'chat-media' and name = tests.a() || '/sent.jpg';

select tests.upload('chat-media', tests.a() || '/new.jpg', '71 hours');
select tests.upload('chat-media', tests.a() || '/old.jpg', '73 hours');
select tests.upload('chat-media', tests.a() || '/older.jpg', '9 days');
select tests.upload('order-media', 'customer/' || tests.a() || '/elsewhere.jpg', '9 days');

select tests.authenticate_as_service_role();
select results_eq(
  $$ select name from public.unattached_media('chat') $$,
  $$ values (tests.a() || '/older.jpg'), (tests.a() || '/old.jpg') $$,
  'unsent chat uploads over 72 h old, oldest first; not sent ones, newer ones or other buckets'
);
select results_eq(
  $$ select name from public.unattached_media('chat', 1) $$,
  $$ values (tests.a() || '/older.jpg') $$,
  'the limit applies'
);
select results_eq(
  $$ select name from public.unattached_media('chat', 10, now() - interval '9 days', tests.a() || '/older.jpg') $$,
  $$ values (tests.a() || '/old.jpg') $$,
  'the cursor applies'
);
select tests.clear_authentication();

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select * from public.unattached_media('chat') $$,
  '42501', null, 'users may not list them'
);
select tests.clear_authentication();

select is(
  (select schedule from cron.job where jobname = 'media-cleanup-chat'),
  '37 0 * * *',
  'chat folder: daily at 00:37 UTC (03:37 Baghdad)'
);
select is(
  (select command from cron.job where jobname = 'media-cleanup-chat'),
  'select private.invoke_media_cleanup(''chat'')',
  'chat folder: calls the Edge Function for the chat folder'
);
delete from vault.secrets where name in ('project_url', 'media_cleanup_secret');
select is(private.invoke_media_cleanup('chat'), null, 'the chat folder is a folder the job accepts');

select * from finish();
rollback;
