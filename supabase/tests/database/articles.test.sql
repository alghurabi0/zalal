-- Tips articles and their categories (spec §5.6, N9, §7, §10.2).
--
-- article_categories: read by everyone, guests included. articles: guests,
-- customers and crews read published articles only; admins read drafts too.
-- Nobody writes either table directly: admins go through the audited RPCs
-- (admin_articles.test.sql, admin_article_categories.test.sql).
--
-- Rules on the rows: a Latin slug (a-z, 0-9 and single hyphens, 3–80), a
-- trimmed title of 5–120 characters, a body of at most 20,000 characters, a
-- cover only in public-content/articles/, a published article has a
-- published_at and a body. read_minutes is computed from the body: words ÷
-- 150, rounded, at least 1. The migration seeds the 4 categories and the 6
-- articles of §10.2 as drafts (seed.sql publishes them locally).
begin;
\ir _helpers.psql

select plan(43);

-- Shape ---------------------------------------------------------------------------------

select has_table('public', 'article_categories', 'article_categories exists');
select has_table('public', 'articles', 'articles exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.article_categories'::regclass),
  'article_categories has RLS on'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.articles'::regclass),
  'articles has RLS on'
);
select enum_has_labels('public', 'article_status', array['draft', 'published'], 'article_status values');
select enum_has_labels(
  'public', 'category_icon', array['droplet', 'sun', 'lid', 'lightbulb', 'help', 'shield'],
  'category_icon values'
);

select results_eq(
  $$ select name, icon::text from public.article_categories
     where name in ('صحة', 'نصائح', 'الصيف', 'أسئلة شائعة') order by sort $$,
  $$ values ('صحة', 'droplet'), ('نصائح', 'lid'), ('الصيف', 'sun'), ('أسئلة شائعة', 'help') $$,
  'the migration seeds the four categories of §10.2, in order, with their icons'
);
select results_eq(
  $$ select a.slug, c.name, a.featured from public.articles as a
     join public.article_categories as c on c.id = a.category_id
     where a.slug in (
       'tank-cleaning-signs', 'clean-every-six-months', 'summer-heat-bacteria',
       'tank-lid', 'cleaning-visit', 'chlorine-smell'
     )
     order by a.slug $$,
  $$ values
       ('chlorine-smell', 'صحة', false),
       ('clean-every-six-months', 'صحة', true),
       ('cleaning-visit', 'أسئلة شائعة', false),
       ('summer-heat-bacteria', 'الصيف', false),
       ('tank-cleaning-signs', 'نصائح', true),
       ('tank-lid', 'نصائح', false) $$,
  'the migration seeds the six articles of §10.2 with their categories and featured flags'
);
select ok(
  (select bool_and(read_minutes between 2 and 4) from public.articles
   where slug in ('tank-cleaning-signs', 'clean-every-six-months', 'summer-heat-bacteria',
                  'tank-lid', 'cleaning-visit', 'chlorine-smell')),
  'each seeded article reads in 2–4 minutes (300–500 words)'
);

-- Our own rows, so the tests don't depend on the seed.
insert into public.article_categories (name, icon, sort) values ('فئة اختبار', 'shield', 100);
create function tests.cat() returns bigint language sql stable security definer
as $$ select id from public.article_categories where name = 'فئة اختبار' $$;
insert into public.articles (slug, title, category_id, body_md, status, published_at)
values
  ('test-published', 'مقال منشور للاختبار', tests.cat(), 'نص المقال', 'published', now()),
  ('test-draft', 'مسودة للاختبار هنا', tests.cat(), 'نص المسودة', 'draft', null);

grant execute on all functions in schema tests to anon, authenticated;

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

-- Constraints -----------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.articles (slug, title, category_id) values ('Bad Slug', 'عنوان صالح', tests.cat()) $$,
  '23514', null, 'a slug is lowercase Latin letters, digits and hyphens'
);
select throws_ok(
  $$ insert into public.articles (slug, title, category_id) values ('a--b', 'عنوان صالح', tests.cat()) $$,
  '23514', null, 'with single hyphens between words'
);
select throws_ok(
  $$ insert into public.articles (slug, title, category_id) values ('ab', 'عنوان صالح', tests.cat()) $$,
  '23514', null, 'and at least 3 characters'
);
select throws_ok(
  $$ insert into public.articles (slug, title, category_id) values ('test-draft', 'عنوان صالح', tests.cat()) $$,
  '23505', null, 'slugs are unique'
);
select throws_ok(
  $$ insert into public.articles (slug, title, category_id) values ('short-title', 'قصير', tests.cat()) $$,
  '23514', null, 'a title has at least 5 characters'
);
select throws_ok(
  $$ insert into public.articles (slug, title, category_id) values ('padded-title', ' عنوان صالح ', tests.cat()) $$,
  '23514', null, 'and is trimmed'
);
select throws_ok(
  $$ insert into public.articles (slug, title, category_id, body_md)
     values ('long-body', 'عنوان صالح', tests.cat(), repeat('a', 20001)) $$,
  '23514', null, 'a body has at most 20,000 characters'
);
select throws_ok(
  $$ insert into public.articles (slug, title, category_id, cover_path)
     values ('bad-cover', 'عنوان صالح', tests.cat(), 'elsewhere/x.webp') $$,
  '23514', null, 'a cover is in the articles/ folder'
);
select throws_ok(
  $$ insert into public.articles (slug, title, category_id, body_md, status)
     values ('no-date', 'عنوان صالح', tests.cat(), 'نص', 'published') $$,
  '23514', null, 'a published article has a published_at'
);
select throws_ok(
  $$ insert into public.articles (slug, title, category_id, body_md, status, published_at)
     values ('no-body', 'عنوان صالح', tests.cat(), E'  \n ', 'published', now()) $$,
  '23514', null, 'and a body'
);
select throws_ok(
  $$ insert into public.articles (slug, title, category_id) values ('no-category', 'عنوان صالح', 999999) $$,
  '23503', null, 'the category exists'
);
select throws_ok(
  $$ delete from public.article_categories where id = tests.cat() $$,
  '23503', null, 'a category in use cannot be deleted'
);
select throws_ok(
  $$ insert into public.article_categories (name, sort) values ('ص', 1) $$,
  '23514', null, 'a category name has at least 2 characters'
);
select throws_ok(
  $$ insert into public.article_categories (name, sort) values ('فئة اختبار', 1) $$,
  '23505', null, 'category names are unique'
);

select is(
  (select read_minutes from public.articles where slug = 'test-draft'),
  1::smallint, 'a short body reads in 1 minute'
);
update public.articles set body_md = repeat('كلمة ', 300) || E'\n\n- ' || repeat('كلمة ', 74)
where slug = 'test-draft';
select is(
  (select read_minutes from public.articles where slug = 'test-draft'),
  3::smallint, '375 words read in 3 minutes (rounded)'
);
update public.articles set body_md = repeat(E'كلمة\u00a0كلمة ', 225) where slug = 'test-draft';
select is(
  (select read_minutes from public.articles where slug = 'test-draft'),
  2::smallint, 'words are split on ASCII whitespace only (a no-break space joins them)'
);

-- Reads -----------------------------------------------------------------------------------

select tests.authenticate_as_anon();
select results_eq(
  $$ select slug from public.articles where category_id = tests.cat() $$,
  $$ values ('test-published') $$,
  'a guest reads published articles only'
);
select isnt_empty(
  $$ select 1 from public.article_categories where id = tests.cat() $$,
  'a guest reads the categories'
);
select throws_ok(
  $$ insert into public.articles (slug, title, category_id) values ('anon-article', 'عنوان صالح', tests.cat()) $$,
  '42501', null, 'a guest cannot write articles'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select results_eq(
  $$ select slug from public.articles where category_id = tests.cat() $$,
  $$ values ('test-published') $$,
  'a customer reads published articles only'
);
select isnt_empty(
  $$ select 1 from public.article_categories where id = tests.cat() $$,
  'a customer reads the categories'
);
select throws_ok(
  $$ update public.articles set title = 'عنوان آخر هنا' where slug = 'test-published' $$,
  '42501', null, 'a customer cannot update articles'
);
select throws_ok(
  $$ insert into public.article_categories (name, sort) values ('فئة زبون', 1) $$,
  '42501', null, 'a customer cannot add categories'
);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select results_eq(
  $$ select slug from public.articles where category_id = tests.cat() $$,
  $$ values ('test-published') $$,
  'another customer reads the same published articles'
);
select throws_ok(
  $$ delete from public.articles where slug = 'test-published' $$,
  '42501', null, 'and cannot delete them'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select results_eq(
  $$ select slug from public.articles where category_id = tests.cat() $$,
  $$ values ('test-published') $$,
  'a crew reads published articles only'
);
select throws_ok(
  $$ update public.article_categories set name = 'اسم آخر' where id = tests.cat() $$,
  '42501', null, 'a crew cannot change categories'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select results_eq(
  $$ select slug from public.articles where category_id = tests.cat() order by slug $$,
  $$ values ('test-draft'), ('test-published') $$,
  'an admin reads drafts too'
);
select throws_ok(
  $$ insert into public.articles (slug, title, category_id) values ('admin-article', 'عنوان صالح', tests.cat()) $$,
  '42501', null, 'an admin cannot insert articles directly'
);
select throws_ok(
  $$ update public.articles set featured = true where slug = 'test-draft' $$,
  '42501', null, 'nor update them'
);
select throws_ok(
  $$ delete from public.articles where slug = 'test-draft' $$,
  '42501', null, 'nor delete them'
);
select throws_ok(
  $$ delete from public.article_categories where id = tests.cat() $$,
  '42501', null, 'nor delete categories'
);
select throws_ok(
  $$ update public.article_categories set sort = 0 where id = tests.cat() $$,
  '42501', null, 'nor reorder them'
);

select tests.clear_authentication();

select * from finish();
rollback;
