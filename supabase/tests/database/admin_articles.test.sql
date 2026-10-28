-- Article writes for A11 (spec §8.2, §7). Admins only (42501 for everyone
-- else; guests can't call them).
--
-- admin_save_article(id, slug, title, category_id, cover_path, body_md,
-- featured, status): creates when id is null, otherwise updates. Returns the
-- article id and the cover it replaced or removed (the server deletes that
-- file through the Storage API). Rules:
-- - a taken slug is ZL031 slug_taken; once an article has been published its
--   slug is fixed (ZL032 slug_locked), so shared links keep working;
-- - a missing category or article is P0002;
-- - a new cover must be a finished upload in public-content/articles/, at
--   most 48 h old, that no other article uses (ZL009 upload_not_found);
-- - publishing sets published_at the first time; back to draft keeps it.
-- Logs article.create with the new values, article.update with only what
-- changed (the body as its length, not its text); a save that changes
-- nothing logs nothing.
--
-- admin_delete_article(id): returns the cover path and logs article.delete.
begin;
\ir _helpers.psql

select plan(47);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

insert into public.article_categories (name, icon, sort) values ('فئة أولى', 'droplet', 100), ('فئة ثانية', 'sun', 101);
create function tests.cat(p_name text) returns bigint language sql stable security definer
as $$ select id from public.article_categories where name = p_name $$;
create function tests.article(p_slug text) returns public.articles language sql stable security definer
as $$ select * from public.articles where slug = p_slug $$;
create function tests.audit_count(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;

-- Covers uploaded by the admin, as Storage leaves them.
select tests.create_object('public-content', 'articles/one.webp', tests.admin(), 'image/webp');
select tests.create_object('public-content', 'articles/two.webp', tests.admin(), 'image/webp');
select tests.create_object('public-content', 'articles/old.webp', tests.admin(), 'image/webp');
update storage.objects set created_at = now() - interval '49 hours'
where bucket_id = 'public-content' and name = 'articles/old.webp';
select tests.create_object('public-content', 'elsewhere/x.webp', tests.admin(), 'image/webp');

-- Everyone but admins ----------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.admin_save_article(null, 'anon-article', 'عنوان صالح', tests.cat('فئة أولى'), null, 'نص', false, 'draft') $$,
  '42501', null, 'a guest cannot save an article'
);
select throws_ok(
  $$ select public.admin_delete_article(gen_random_uuid()) $$,
  '42501', null, 'nor delete one'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select * from public.admin_save_article(null, 'cust-article', 'عنوان صالح', tests.cat('فئة أولى'), null, 'نص', false, 'draft') $$,
  '42501', 'not_allowed', 'a customer cannot save an article'
);
select throws_ok(
  $$ select public.admin_delete_article(gen_random_uuid()) $$,
  '42501', 'not_allowed', 'nor delete one'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select * from public.admin_save_article(null, 'cust-article', 'عنوان صالح', tests.cat('فئة أولى'), null, 'نص', false, 'draft') $$,
  '42501', 'not_allowed', 'another customer cannot save an article'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select * from public.admin_save_article(null, 'crew-article', 'عنوان صالح', tests.cat('فئة أولى'), null, 'نص', false, 'draft') $$,
  '42501', 'not_allowed', 'a crew cannot save an article'
);
select throws_ok(
  $$ select public.admin_delete_article(gen_random_uuid()) $$,
  '42501', 'not_allowed', 'nor delete one'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.articles where slug like '%-article'),
  0, 'nothing was written for the refused callers'
);

-- Create -----------------------------------------------------------------------------------

select tests.authenticate_as(tests.admin());

select lives_ok(
  $$ insert into tests.ids
     select 'draft', article_id from public.admin_save_article(
       null, 'first-article', 'مقال أول للتجربة', tests.cat('فئة أولى'), 'articles/one.webp',
       'نص المقال الأول', false, 'draft'
     ) $$,
  'an admin creates a draft with a cover'
);
select is((tests.article('first-article')).id, tests.id('draft'), 'and gets its id back');
select is((tests.article('first-article')).status, 'draft'::public.article_status, 'as a draft');
select is((tests.article('first-article')).published_at, null, 'not published');
select is((tests.article('first-article')).cover_path, 'articles/one.webp', 'with the cover');
select is(tests.audit_count('article.create'), 1, 'logged as article.create');
select is(
  tests.last_diff('article.create'),
  jsonb_build_object(
    'slug', 'first-article', 'title', 'مقال أول للتجربة', 'category_id', tests.cat('فئة أولى'),
    'cover', 'articles/one.webp', 'body_length', 15, 'featured', false, 'status', 'draft'
  ),
  'with its values and the body''s length, not its text'
);

select throws_ok(
  $$ select * from public.admin_save_article(null, 'first-article', 'عنوان صالح آخر', tests.cat('فئة أولى'), null, 'نص', false, 'draft') $$,
  'ZL031', 'slug_taken', 'a taken slug is refused'
);
select throws_ok(
  $$ select * from public.admin_save_article(null, 'no-category', 'عنوان صالح', 999999, null, 'نص', false, 'draft') $$,
  'P0002', 'category_not_found', 'a missing category is refused'
);
select throws_ok(
  $$ select * from public.admin_save_article(null, 'reused-cover', 'عنوان صالح', tests.cat('فئة أولى'), 'articles/one.webp', 'نص', false, 'draft') $$,
  'ZL009', 'upload_not_found', 'a cover another article uses is refused'
);
select throws_ok(
  $$ select * from public.admin_save_article(null, 'missing-cover', 'عنوان صالح', tests.cat('فئة أولى'), 'articles/none.webp', 'نص', false, 'draft') $$,
  'ZL009', 'upload_not_found', 'a cover that was never uploaded is refused'
);
select throws_ok(
  $$ select * from public.admin_save_article(null, 'old-cover', 'عنوان صالح', tests.cat('فئة أولى'), 'articles/old.webp', 'نص', false, 'draft') $$,
  'ZL009', 'upload_not_found', 'a cover uploaded more than 48 h ago is refused'
);
select throws_ok(
  $$ select * from public.admin_save_article(null, 'other-folder', 'عنوان صالح', tests.cat('فئة أولى'), 'elsewhere/x.webp', 'نص', false, 'draft') $$,
  'ZL009', 'upload_not_found', 'a cover outside articles/ is refused'
);
select throws_ok(
  $$ select * from public.admin_save_article(null, 'Bad Slug', 'عنوان صالح', tests.cat('فئة أولى'), null, 'نص', false, 'draft') $$,
  '23514', null, 'a malformed slug is refused by the table'
);
select throws_ok(
  $$ select * from public.admin_save_article(null, 'empty-body', 'عنوان صالح', tests.cat('فئة أولى'), null, '', false, 'published') $$,
  '23514', null, 'an empty article cannot be published'
);

-- Update -----------------------------------------------------------------------------------

select lives_ok(
  $$ select * from public.admin_save_article(
       tests.id('draft'), 'first-article-renamed', 'مقال أول للتجربة', tests.cat('فئة أولى'), 'articles/one.webp',
       'نص المقال الأول', false, 'draft'
     ) $$,
  'a draft''s slug can change'
);
select is(tests.audit_count('article.update'), 1, 'logged as article.update');
select is(
  tests.last_diff('article.update'),
  jsonb_build_object('slug', jsonb_build_object('from', 'first-article', 'to', 'first-article-renamed')),
  'with only the slug'
);

select lives_ok(
  $$ select * from public.admin_save_article(
       tests.id('draft'), 'first-article-renamed', 'مقال أول للتجربة', tests.cat('فئة أولى'), 'articles/one.webp',
       'نص المقال الأول', false, 'draft'
     ) $$,
  'saving without changes works'
);
select is(tests.audit_count('article.update'), 1, 'and logs nothing');

select results_eq(
  $$ select article_id, replaced_cover from public.admin_save_article(
       tests.id('draft'), 'first-article-renamed', 'مقال أول للتجربة', tests.cat('فئة ثانية'), 'articles/two.webp',
       'نص المقال الأول بعد التعديل', true, 'published'
     ) $$,
  $$ values (tests.id('draft'), 'articles/one.webp') $$,
  'publishing with a new cover returns the cover it replaced'
);
select is((tests.article('first-article-renamed')).status, 'published'::public.article_status, 'the article is published');
select is((tests.article('first-article-renamed')).published_at, now(), 'published_at is set');
select is(
  tests.last_diff('article.update'),
  jsonb_build_object(
    'category_id', jsonb_build_object('from', tests.cat('فئة أولى'), 'to', tests.cat('فئة ثانية')),
    'cover', jsonb_build_object('from', 'articles/one.webp', 'to', 'articles/two.webp'),
    'body_length', jsonb_build_object('from', 15, 'to', 27),
    'featured', jsonb_build_object('from', false, 'to', true),
    'status', jsonb_build_object('from', 'draft', 'to', 'published')
  ),
  'the log has each changed field with old and new values'
);

select throws_ok(
  $$ select * from public.admin_save_article(
       tests.id('draft'), 'another-slug', 'مقال أول للتجربة', tests.cat('فئة ثانية'), 'articles/two.webp',
       'نص المقال الأول بعد التعديل', true, 'published'
     ) $$,
  'ZL032', 'slug_locked', 'a published article''s slug is fixed'
);

-- Back to draft: published_at stays, so the slug stays fixed.
select tests.clear_authentication();
update public.articles set published_at = now() - interval '2 days' where id = tests.id('draft');
select tests.authenticate_as(tests.admin());
select lives_ok(
  $$ select * from public.admin_save_article(
       tests.id('draft'), 'first-article-renamed', 'مقال أول للتجربة', tests.cat('فئة ثانية'), 'articles/two.webp',
       'نص المقال الأول بعد التعديل', true, 'draft'
     ) $$,
  'an admin moves an article back to draft'
);
select is((tests.article('first-article-renamed')).published_at, now() - interval '2 days', 'published_at is kept');
select throws_ok(
  $$ select * from public.admin_save_article(
       tests.id('draft'), 'another-slug', 'مقال أول للتجربة', tests.cat('فئة ثانية'), 'articles/two.webp',
       'نص', true, 'draft'
     ) $$,
  'ZL032', 'slug_locked', 'and the slug stays fixed'
);
select lives_ok(
  $$ select * from public.admin_save_article(
       tests.id('draft'), 'first-article-renamed', 'مقال أول للتجربة', tests.cat('فئة ثانية'), 'articles/two.webp',
       'نص المقال الأول بعد التعديل', true, 'published'
     ) $$,
  'publishing again'
);
select is(
  (tests.article('first-article-renamed')).published_at, now() - interval '2 days',
  'keeps the first publish date'
);

select results_eq(
  $$ select replaced_cover from public.admin_save_article(
       tests.id('draft'), 'first-article-renamed', 'مقال أول للتجربة', tests.cat('فئة ثانية'), null,
       'نص المقال الأول بعد التعديل', true, 'published'
     ) $$,
  $$ values ('articles/two.webp') $$,
  'removing the cover returns it'
);
select results_eq(
  $$ select replaced_cover from public.admin_save_article(
       tests.id('draft'), 'first-article-renamed', 'مقال أول للتجربة', tests.cat('فئة ثانية'), null,
       'نص المقال الأول بعد التعديل', true, 'published'
     ) $$,
  $$ values (null::text) $$,
  'no cover replaced, none returned'
);

select throws_ok(
  $$ select * from public.admin_save_article(
       gen_random_uuid(), 'missing-article', 'عنوان صالح', tests.cat('فئة ثانية'), null, 'نص', false, 'draft'
     ) $$,
  'P0002', 'article_not_found', 'updating a missing article is refused'
);

-- Delete -------------------------------------------------------------------------------------

select lives_ok(
  $$ insert into tests.ids
     select 'second', article_id from public.admin_save_article(
       null, 'second-article', 'مقال ثاني للتجربة', tests.cat('فئة أولى'), 'articles/one.webp', 'نص', false, 'draft'
     ) $$,
  'a freed cover can be used by another article'
);
select is(
  public.admin_delete_article(tests.id('second')), 'articles/one.webp',
  'deleting an article returns its cover'
);
select is((tests.article('second-article')).id, null, 'the article is gone');
select is(
  tests.last_diff('article.delete'),
  jsonb_build_object('slug', 'second-article', 'title', 'مقال ثاني للتجربة', 'status', 'draft'),
  'logged as article.delete'
);
select throws_ok(
  $$ select public.admin_delete_article(tests.id('second')) $$,
  'P0002', 'article_not_found', 'a missing article is refused'
);
select is(
  public.admin_delete_article(tests.id('draft')), null,
  'an article without a cover returns null'
);

select tests.clear_authentication();

select * from finish();
rollback;
