-- Sending Web Push for new notifications (spec §9.2) and keeping the table
-- small:
-- - After each insert statement on notifications, the ids of the new rows
--   whose user has at least one push subscription go to the Edge Function
--   send-push, at most 100 per request: private.invoke_send_push(ids) posts
--   {"ids": [...]} through pg_net with the x-send-push-secret header, reading
--   project_url and send_push_secret from Vault. Without either secret it
--   sends nothing, so local runs and CI never call out. work_started rows are
--   in-app only and never pushed.
-- - private.prune_notifications() deletes notifications older than 90 days
--   (read or not) and reminder records whose window has long passed; pg_cron
--   runs it nightly at 01:07 UTC (04:07 Baghdad).
begin;
\ir _helpers.psql

select plan(20);

select tests.create_user('+9647801111111');            -- A, with a subscription
select tests.create_user('+9647802222222');            -- B, without
create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values (tests.a(), 'https://fcm.googleapis.com/fcm/send/a', 'B' || repeat('a', 86), repeat('b', 22));

create function tests.requests() returns integer language sql stable
as $$ select count(*)::int from net.http_request_queue where url like '%/functions/v1/send-push' $$;
create function tests.last_ids() returns jsonb language sql stable
as $$
  select convert_from(body, 'utf8')::jsonb -> 'ids'
  from net.http_request_queue where url like '%/functions/v1/send-push'
  order by id desc limit 1
$$;

-- Without the Vault secrets ----------------------------------------------------------------

delete from vault.secrets where name in ('project_url', 'send_push_secret');
select is(private.invoke_send_push(array[gen_random_uuid()]), null, 'no Vault secrets: nothing is sent');
insert into public.notifications (user_id, type) values (tests.a(), 'support_message');
select is(tests.requests(), 0, 'a new notification sends nothing without the secrets');

select vault.create_secret('http://127.0.0.1:54321', 'project_url');
select is(private.invoke_send_push(array[gen_random_uuid()]), null, 'only the project URL: nothing is sent');
select vault.create_secret('test-push-secret', 'send_push_secret');

-- With them --------------------------------------------------------------------------------

select isnt(
  private.invoke_send_push(array['00000000-0000-4000-8000-000000000001'::uuid]), null,
  'both secrets: a request is queued'
);
select is(
  (select url from net.http_request_queue order by id desc limit 1),
  'http://127.0.0.1:54321/functions/v1/send-push',
  'to the send-push Edge Function'
);
select is(
  (select headers ->> 'x-send-push-secret' from net.http_request_queue order by id desc limit 1),
  'test-push-secret', 'with the secret from Vault'
);
select is(tests.last_ids(), '["00000000-0000-4000-8000-000000000001"]'::jsonb, 'and the ids');

delete from net.http_request_queue;

insert into public.notifications (id, user_id, type)
values ('00000000-0000-4000-8000-0000000000a1', tests.a(), 'order_confirmed');
select is(tests.requests(), 1, 'a notification for a user with a subscription is pushed');
select is(tests.last_ids(), '["00000000-0000-4000-8000-0000000000a1"]'::jsonb, 'by its id');

insert into public.notifications (user_id, type) values (tests.b(), 'order_confirmed');
select is(tests.requests(), 1, 'a user with no subscription: no request');

insert into public.notifications (user_id, type) values (tests.a(), 'work_started');
select is(tests.requests(), 1, 'work_started is never pushed');

insert into public.notifications (user_id, type)
values (tests.a(), 'crew_on_the_way'), (tests.b(), 'crew_on_the_way'), (tests.a(), 'crew_arrived');
select is(tests.requests(), 2, 'one insert statement makes one request');
select is(jsonb_array_length(tests.last_ids()), 2, 'with only the rows that can be pushed');

insert into public.notifications (user_id, type)
select tests.a(), 'support_message' from generate_series(1, 450);
select is(tests.requests(), 7, 'more than 100 rows go in requests of at most 100');

select ok(
  not has_function_privilege('authenticated', 'private.invoke_send_push(uuid[])', 'execute')
    and not has_function_privilege('service_role', 'private.invoke_send_push(uuid[])', 'execute'),
  'no API role may call invoke_send_push'
);

-- Retention -------------------------------------------------------------------------------

delete from public.notifications;
insert into public.notifications (user_id, type, created_at, read_at) values
  (tests.a(), 'order_confirmed', now() - interval '91 days', now() - interval '91 days'),
  (tests.a(), 'order_confirmed', now() - interval '91 days', null),
  (tests.a(), 'order_confirmed', now() - interval '89 days', null);
select is(private.prune_notifications(), 2, 'notifications older than 90 days go, read or not');
select is((select count(*)::int from public.notifications), 1, 'newer ones stay');

select ok(
  not has_function_privilege('authenticated', 'private.prune_notifications()', 'execute')
    and not has_function_privilege('service_role', 'private.prune_notifications()', 'execute'),
  'only pg_cron prunes'
);
select is(
  (select schedule from cron.job where jobname = 'notifications-prune'),
  '7 1 * * *', 'pruning runs nightly at 01:07 UTC (04:07 Baghdad)'
);
select is(
  (select command from cron.job where jobname = 'notifications-prune'),
  'select private.prune_notifications()', 'and calls prune_notifications'
);

select * from finish();
rollback;
