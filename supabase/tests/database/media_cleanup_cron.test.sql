-- The two media-cleanup cron jobs (spec §7 Storage). Each night pg_cron calls
-- private.invoke_media_cleanup(folder), which reads the project URL and the
-- job's secret from Vault and posts {"folder": …} to the Edge Function
-- media-cleanup through pg_net, with the secret in x-media-cleanup-secret.
-- Without both Vault secrets (a project the owner hasn't set up yet) it
-- sends nothing and returns null. Only postgres (pg_cron) may call it.
begin;
\ir _helpers.psql

select plan(13);

select is(
  (select schedule from cron.job where jobname = 'media-cleanup-customer'),
  '17 0 * * *',
  'customer folder: daily at 00:17 UTC (03:17 Baghdad)'
);
select is(
  (select command from cron.job where jobname = 'media-cleanup-customer'),
  'select private.invoke_media_cleanup(''customer'')',
  'customer folder: calls the Edge Function for customer/'
);
select is(
  (select schedule from cron.job where jobname = 'media-cleanup-crew'),
  '47 0 * * *',
  'crew folder: daily at 00:47 UTC (03:47 Baghdad)'
);
select is(
  (select command from cron.job where jobname = 'media-cleanup-crew'),
  'select private.invoke_media_cleanup(''crew'')',
  'crew folder: calls the Edge Function for crew/'
);

-- Without the Vault secrets nothing is sent.
delete from vault.secrets where name in ('project_url', 'media_cleanup_secret');
select is(private.invoke_media_cleanup('customer'), null, 'no Vault secrets: nothing is sent');
select vault.create_secret('http://127.0.0.1:54321', 'project_url');
select is(private.invoke_media_cleanup('customer'), null, 'only the project URL: nothing is sent');

-- With both, one request to the function with the secret and the folder.
select vault.create_secret('test-cleanup-secret', 'media_cleanup_secret');
select isnt(private.invoke_media_cleanup('crew'), null, 'both secrets: a request is queued');
select is(
  (select url from net.http_request_queue order by id desc limit 1),
  'http://127.0.0.1:54321/functions/v1/media-cleanup',
  'to the media-cleanup Edge Function'
);
select is(
  (select headers ->> 'x-media-cleanup-secret' from net.http_request_queue order by id desc limit 1),
  'test-cleanup-secret',
  'with the secret from Vault'
);
select is(
  (select convert_from(body, 'utf8')::jsonb from net.http_request_queue order by id desc limit 1),
  '{"folder": "crew"}'::jsonb,
  'and the folder'
);
select throws_ok(
  $$ select private.invoke_media_cleanup('elsewhere') $$,
  '22023', 'invalid_folder', 'another folder is refused'
);

-- No API role may call it.
select ok(
  not has_function_privilege('authenticated', 'private.invoke_media_cleanup(text)', 'execute')
    and not has_function_privilege('anon', 'private.invoke_media_cleanup(text)', 'execute'),
  'anon and authenticated may not call it'
);
select ok(
  not has_function_privilege('service_role', 'private.invoke_media_cleanup(text)', 'execute'),
  'nor may the service role'
);

select * from finish();
rollback;
