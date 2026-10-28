-- The content folder of the media cleanup (spec §7 Storage).
-- unattached_media('content') lists public-content covers in articles/ more
-- than 72 hours old that no article uses (admin_save_article takes uploads
-- up to 48 hours old), oldest first. The cron job media-cleanup-content asks
-- the Edge Function to delete them nightly at 01:17 UTC (04:17 Baghdad).
begin;
\ir _helpers.psql

select plan(6);

select tests.create_user('+9647504444444', 'admin');
create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;

update public.articles set cover_path = null where cover_path is not null;
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'public-content';
reset storage.allow_delete_query;

create function tests.upload(p_bucket text, p_name text, p_age interval) returns void
language plpgsql
as $$
begin
  perform tests.create_object(p_bucket, p_name, tests.admin(), 'image/webp');
  update storage.objects
  set created_at = now() - p_age, updated_at = now() - p_age
  where bucket_id = p_bucket and name = p_name;
end;
$$;

insert into public.article_categories (name, icon, sort) values ('فئة اختبار', 'sun', 100);
select tests.upload('public-content', 'articles/used.webp', '1 hour');
select tests.authenticate_as(tests.admin());
select * from public.admin_save_article(
  null, 'covered-article', 'مقال بغلاف للتجربة',
  (select id from public.article_categories where name = 'فئة اختبار'),
  'articles/used.webp', 'نص', false, 'draft'
);
select tests.clear_authentication();
update storage.objects set created_at = now() - interval '10 days'
where bucket_id = 'public-content' and name = 'articles/used.webp';

select tests.upload('public-content', 'articles/new.webp', '71 hours');
select tests.upload('public-content', 'articles/old.webp', '73 hours');
select tests.upload('public-content', 'articles/older.webp', '9 days');
select tests.upload('public-content', 'brand/kept.webp', '9 days');

select tests.authenticate_as_service_role();
select results_eq(
  $$ select name from public.unattached_media('content') $$,
  $$ values ('articles/older.webp'), ('articles/old.webp') $$,
  'unused covers over 72 h old, oldest first; not used ones, newer ones or other folders'
);
select results_eq(
  $$ select name from public.unattached_media('content', 10, now() - interval '9 days', 'articles/older.webp') $$,
  $$ values ('articles/old.webp') $$,
  'and pages after a cursor'
);
select tests.clear_authentication();

select is(
  (select schedule from cron.job where jobname = 'media-cleanup-content'),
  '17 1 * * *',
  'content folder: daily at 01:17 UTC (04:17 Baghdad)'
);
select is(
  (select command from cron.job where jobname = 'media-cleanup-content'),
  'select private.invoke_media_cleanup(''content'')',
  'content folder: calls the Edge Function for the content folder'
);

delete from vault.secrets where name in ('project_url', 'media_cleanup_secret');
select vault.create_secret('http://127.0.0.1:54321', 'project_url');
select vault.create_secret('test-cleanup-secret', 'media_cleanup_secret');
select isnt(private.invoke_media_cleanup('content'), null, 'the content folder is sent');
select is(
  (select convert_from(body, 'utf8')::jsonb from net.http_request_queue order by id desc limit 1),
  '{"folder": "content"}'::jsonb,
  'with its name'
);

select * from finish();
rollback;
