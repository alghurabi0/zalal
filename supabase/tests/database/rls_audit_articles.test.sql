-- RLS audit of migration articles (spec §5.6, N9, §7, §8.2 A11).
--
-- Paths the other article tests don't cover:
-- - an admin who lost the role (now a customer) or whose account was
--   deleted (deleted_at set, role still admin) reads no drafts, calls none
--   of the A11 RPCs and touches no covers;
-- - admin_save_article attaches a cover only from public-content (not a file
--   of the same name in another bucket), never another article's cover on
--   update, and only the calling admin's own finished upload, as the
--   migration's header promises and every other attach RPC enforces
--   (create_order, send_chat_message, attach_job_media, create_ticket);
-- - nobody replaces a cover through an upsert (no UPDATE policy on
--   public-content).
--
-- The races between attaching a cover and deleting it (or attaching it twice)
-- can't run in one transaction; the audit ran them in two sessions by hand.
begin;
\ir _helpers.psql

select plan(23);

select tests.create_user('+9647501110001', 'admin');   -- the acting admin
select tests.create_user('+9647501110002', 'admin');   -- a second admin
select tests.create_user('+9647501110003', 'admin');   -- removed later
select tests.create_user('+9647501110004', 'admin');   -- deleted later

create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647501110001') $$;

insert into public.article_categories (name, icon, sort) values ('فئة التدقيق', 'shield', 900);
create function tests.cat() returns bigint language sql stable security definer
as $$ select id from public.article_categories where name = 'فئة التدقيق' $$;
create function tests.cover(p_slug text) returns text language sql stable security definer
as $$ select cover_path from public.articles where slug = p_slug $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Covers as Storage leaves them, plus files that must never become covers.
select tests.create_object('public-content', 'articles/a1.webp', tests.admin(), 'image/webp');
select tests.create_object('public-content', 'articles/a2.webp', tests.admin(), 'image/webp');
select tests.create_object('public-content', 'articles/spare.webp', tests.admin(), 'image/webp');
select tests.create_object('public-content', 'articles/other-admin.webp', tests.user_id('+9647501110002'), 'image/webp');
-- A row Storage made without the upload's metadata (not finished).
insert into storage.objects (bucket_id, name, owner, owner_id)
values ('public-content', 'articles/unfinished.webp', tests.admin(), tests.admin()::text);
-- Same name as a cover, other bucket.
select tests.create_object('order-media', 'articles/wrong-bucket.webp', tests.admin(), 'image/webp');

select tests.authenticate_as(tests.admin());
insert into tests.ids
select 'one', article_id from public.admin_save_article(
  null, 'audit-one', 'مقال التدقيق الأول', tests.cat(), 'articles/a1.webp', 'نص', false, 'draft'
);
insert into tests.ids
select 'two', article_id from public.admin_save_article(
  null, 'audit-two', 'مقال التدقيق الثاني', tests.cat(), 'articles/a2.webp', 'نص', false, 'draft'
);

-- Covers: which files can be attached ----------------------------------------------------

select throws_ok(
  $$ select * from public.admin_save_article(null, 'audit-bucket', 'عنوان صالح هنا', tests.cat(),
       'articles/wrong-bucket.webp', 'نص', false, 'draft') $$,
  'ZL009', 'upload_not_found', 'a file of the same name in another bucket is not a cover'
);
select throws_ok(
  $$ select * from public.admin_save_article(tests.id('two'), 'audit-two', 'مقال التدقيق الثاني', tests.cat(),
       'articles/a1.webp', 'نص', false, 'draft') $$,
  'ZL009', 'upload_not_found', 'an update cannot take another article''s cover'
);
select is(tests.cover('audit-one'), 'articles/a1.webp', 'which stays with its article');
select is(tests.cover('audit-two'), 'articles/a2.webp', 'and the other article keeps its own');

-- FINDING: the attach checks bucket, folder, age and use, but not owner_id or
-- the upload's metadata.
select throws_ok(
  $$ select * from public.admin_save_article(null, 'audit-foreign', 'عنوان صالح هنا', tests.cat(),
       'articles/other-admin.webp', 'نص', false, 'draft') $$,
  'ZL009', 'upload_not_found', 'an admin cannot attach another account''s upload'
);
select throws_ok(
  $$ select * from public.admin_save_article(null, 'audit-unfinished', 'عنوان صالح هنا', tests.cat(),
       'articles/unfinished.webp', 'نص', false, 'draft') $$,
  'ZL009', 'upload_not_found', 'nor a file without its upload metadata (not finished)'
);

-- Covers: no replacing through an upsert ------------------------------------------------

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('public-content', 'articles/a1.webp', auth.uid()::text, '{"mimetype": "image/webp", "size": 1}')
     on conflict (bucket_id, name) where not is_versioned do update set metadata = excluded.metadata $$,
  '42501', null, 'an admin cannot overwrite a used cover with an upsert'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('public-content', 'articles/spare.webp', auth.uid()::text, '{"mimetype": "image/webp", "size": 1}')
     on conflict (bucket_id, name) where not is_versioned do update set metadata = excluded.metadata $$,
  '42501', null, 'nor an unused one'
);

-- A removed admin (now a customer) ------------------------------------------------------

select tests.clear_authentication();
update public.profiles set role = 'customer' where id = tests.user_id('+9647501110003');
select tests.authenticate_as(tests.user_id('+9647501110003'));

select is_empty(
  $$ select 1 from public.articles where slug like 'audit-%' $$,
  'a removed admin reads no drafts'
);
select throws_ok(
  $$ select * from public.admin_save_article(tests.id('one'), 'audit-one', 'مقال التدقيق الأول', tests.cat(),
       'articles/a1.webp', 'نص', false, 'published') $$,
  '42501', 'not_allowed', 'nor publishes one'
);
select throws_ok(
  $$ select public.admin_delete_article(tests.id('one')) $$,
  '42501', 'not_allowed', 'nor deletes one'
);
select throws_ok(
  $$ select public.admin_save_category(tests.cat(), 'اسم جديد', 'sun') $$,
  '42501', 'not_allowed', 'nor renames a category'
);
select throws_ok(
  $$ select public.admin_delete_category(tests.cat()) $$,
  '42501', 'not_allowed', 'nor deletes one'
);
select throws_ok(
  $$ select public.admin_reorder_categories(array(select id from public.article_categories order by id desc)) $$,
  '42501', 'not_allowed', 'nor reorders them'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'articles/removed.webp', auth.uid()::text) $$,
  '42501', null, 'nor uploads a cover'
);

-- A deleted admin account (role still admin) ---------------------------------------------

select tests.clear_authentication();
update public.profiles set deleted_at = now() where id = tests.user_id('+9647501110004');
select tests.authenticate_as(tests.user_id('+9647501110004'));

select is_empty(
  $$ select 1 from public.articles where slug like 'audit-%' $$,
  'a deleted admin account reads no drafts'
);
select throws_ok(
  $$ select * from public.admin_save_article(null, 'audit-deleted', 'عنوان صالح هنا', tests.cat(),
       'articles/spare.webp', 'نص', false, 'draft') $$,
  '42501', 'not_allowed', 'nor saves an article'
);
select throws_ok(
  $$ select public.admin_save_category(null, 'فئة محذوف', 'sun') $$,
  '42501', 'not_allowed', 'nor adds a category'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'articles/deleted.webp', auth.uid()::text) $$,
  '42501', null, 'nor uploads a cover'
);
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'public-content' $$,
  'nor lists the covers'
);
select set_config('storage.allow_delete_query', 'true', true);
select is_empty(
  $$ delete from storage.objects where bucket_id = 'public-content' and name = 'articles/spare.webp' returning 1 $$,
  'nor deletes an unused cover'
);

-- Nothing the refused callers tried got through.
select tests.clear_authentication();
select results_eq(
  $$ select slug, status::text, cover_path from public.articles
     where slug in ('audit-one', 'audit-two', 'audit-bucket', 'audit-deleted') order by slug $$,
  $$ values ('audit-one', 'draft', 'articles/a1.webp'), ('audit-two', 'draft', 'articles/a2.webp') $$,
  'the refused saves wrote nothing and left the drafts as they were'
);
select is(
  (select name from public.article_categories where id = tests.cat()),
  'فئة التدقيق', 'and the category kept its name'
);

select * from finish();
rollback;
