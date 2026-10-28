-- Storage rules for article covers in the public-content bucket (spec §7,
-- §8.2 A11). The bucket is public, so anyone with a cover's URL loads it
-- without a policy. Through the API only admins touch it: they upload to
-- public-content/articles/<file>, read that folder, and delete a cover no
-- article uses. "Used" is checked without RLS
-- (private.article_cover_used), and no upload may take the name of a cover
-- an article uses. Guests, customers and crews do nothing here.
begin;
\ir _helpers.psql

select plan(20);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;

insert into public.article_categories (name, icon, sort) values ('فئة اختبار', 'sun', 100);
select tests.create_object('public-content', 'articles/used.webp', tests.admin(), 'image/webp');
select tests.create_object('public-content', 'articles/spare.webp', tests.admin(), 'image/webp');
select tests.authenticate_as(tests.admin());
select * from public.admin_save_article(
  null, 'covered-article', 'مقال بغلاف للتجربة',
  (select id from public.article_categories where name = 'فئة اختبار'),
  'articles/used.webp', 'نص', false, 'draft'
);

-- Uploads ----------------------------------------------------------------------------

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'articles/new.webp', auth.uid()::text) $$,
  'an admin uploads a cover to articles/'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'root.webp', auth.uid()::text) $$,
  '42501', null, 'not outside articles/'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'articles/deep/x.webp', auth.uid()::text) $$,
  '42501', null, 'nor into a subfolder'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'articles/c.webp', auth.uid()::text) $$,
  '42501', null, 'a customer cannot upload a cover'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'articles/c2.webp', auth.uid()::text) $$,
  '42501', null, 'nor can another customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'articles/crew.webp', auth.uid()::text) $$,
  '42501', null, 'nor a crew'
);
select tests.authenticate_as_anon();
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('public-content', 'articles/anon.webp') $$,
  '42501', null, 'nor a guest'
);

-- Reads ------------------------------------------------------------------------------

select is_empty($$ select 1 from storage.objects where bucket_id = 'public-content' $$, 'a guest lists no covers through the API');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select 1 from storage.objects where bucket_id = 'public-content' $$, 'nor does a customer');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select 1 from storage.objects where bucket_id = 'public-content' $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select 1 from storage.objects where bucket_id = 'public-content' $$, 'nor a crew');
select tests.authenticate_as(tests.admin());
select results_eq(
  $$ select name from storage.objects where bucket_id = 'public-content' order by name $$,
  $$ values ('articles/new.webp'), ('articles/spare.webp'), ('articles/used.webp') $$,
  'an admin lists the covers'
);

-- Deletes and changes ------------------------------------------------------------------

select set_config('storage.allow_delete_query', 'true', true);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty(
  $$ delete from storage.objects where bucket_id = 'public-content' returning 1 $$,
  'a customer deletes nothing'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty(
  $$ delete from storage.objects where bucket_id = 'public-content' returning 1 $$,
  'a crew deletes nothing'
);
select tests.authenticate_as_anon();
select is_empty(
  $$ delete from storage.objects where bucket_id = 'public-content' returning 1 $$,
  'a guest deletes nothing'
);

select tests.authenticate_as(tests.admin());
select is_empty(
  $$ delete from storage.objects where bucket_id = 'public-content' and name = 'articles/used.webp' returning 1 $$,
  'an admin cannot delete a cover an article uses'
);
select results_eq(
  $$ delete from storage.objects where bucket_id = 'public-content' and name = 'articles/spare.webp' returning 1 $$,
  $$ values (1) $$,
  'an admin deletes a cover nothing uses'
);
select is_empty(
  $$ update storage.objects set name = 'articles/renamed.webp' where bucket_id = 'public-content' returning 1 $$,
  'nobody renames covers'
);

-- A used cover that went missing: nothing may take its name.
select tests.clear_authentication();
delete from storage.objects where bucket_id = 'public-content' and name = 'articles/used.webp';
select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'articles/used.webp', auth.uid()::text) $$,
  '42501', null, 'no upload takes the name of a cover an article uses'
);

-- An admin who is no longer one can't touch covers.
select tests.clear_authentication();
update public.profiles set role = 'customer' where id = tests.admin();
select tests.authenticate_as(tests.admin());
select is_empty(
  $$ delete from storage.objects where bucket_id = 'public-content' and name = 'articles/new.webp' returning 1 $$,
  'a removed admin deletes nothing'
);

select * from finish();
rollback;
