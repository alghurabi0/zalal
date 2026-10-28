-- Category writes for A11 (spec §8.2, §7). Admins only (42501 for everyone
-- else; guests can't call them).
--
-- admin_save_category(id, name, icon): creates (at the end of the order)
-- when id is null, otherwise renames or changes the icon. A taken name is
-- ZL033 category_name_taken; a missing category P0002. Logs category.create
-- or category.update with only what changed.
-- admin_delete_category(id): refused while any article (draft or published)
-- uses it (ZL030 category_in_use). Logs category.delete.
-- admin_reorder_categories(ids): category ids in the new order, each once
-- (22023 invalid_order otherwise). Categories not listed (added by another
-- admin meanwhile) keep their order after them; ids that no longer exist are
-- skipped. Logs category.reorder with the old and new order when it changed.
begin;
\ir _helpers.psql

select plan(32);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

-- Our own categories only, so the order checks don't depend on the seed.
delete from public.articles;
delete from public.article_categories;
insert into public.article_categories (name, icon, sort) values ('أولى', 'droplet', 1), ('ثانية', 'sun', 2);
create function tests.cat(p_name text) returns bigint language sql stable security definer
as $$ select id from public.article_categories where name = p_name $$;
create function tests.category(p_id bigint) returns public.article_categories language sql stable security definer
as $$ select * from public.article_categories where id = p_id $$;
create function tests.audit_count(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Everyone but admins ----------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok($$ select public.admin_save_category(null, 'جديدة', 'sun') $$, '42501', null, 'a guest cannot add a category');
select throws_ok($$ select public.admin_delete_category(tests.cat('أولى')) $$, '42501', null, 'nor delete one');
select throws_ok(
  $$ select public.admin_reorder_categories(array[tests.cat('ثانية'), tests.cat('أولى')]) $$,
  '42501', null, 'nor reorder them'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok($$ select public.admin_save_category(null, 'جديدة', 'sun') $$, '42501', 'not_allowed', 'a customer cannot add a category');
select throws_ok($$ select public.admin_delete_category(tests.cat('أولى')) $$, '42501', 'not_allowed', 'nor delete one');
select throws_ok(
  $$ select public.admin_reorder_categories(array[tests.cat('ثانية'), tests.cat('أولى')]) $$,
  '42501', 'not_allowed', 'nor reorder them'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok($$ select public.admin_save_category(tests.cat('أولى'), 'تغيير', 'sun') $$, '42501', 'not_allowed', 'another customer cannot rename one');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok($$ select public.admin_save_category(null, 'جديدة', 'sun') $$, '42501', 'not_allowed', 'a crew cannot add a category');
select throws_ok($$ select public.admin_delete_category(tests.cat('أولى')) $$, '42501', 'not_allowed', 'nor delete one');
select tests.clear_authentication();
select is((select count(*)::int from public.article_categories), 2, 'nothing changed for the refused callers');

-- Save ---------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select lives_ok(
  $$ select public.admin_save_category(null, 'ثالثة', 'shield') $$,
  'an admin adds a category'
);
select is((tests.category(tests.cat('ثالثة'))).sort, 3, 'at the end of the order');
select is((tests.category(tests.cat('ثالثة'))).icon, 'shield'::public.category_icon, 'with its icon');
select is(
  tests.last_diff('category.create'), jsonb_build_object('name', 'ثالثة', 'icon', 'shield'),
  'logged as category.create'
);
select throws_ok(
  $$ select public.admin_save_category(null, 'أولى', 'sun') $$,
  'ZL033', 'category_name_taken', 'a taken name is refused'
);
select throws_ok(
  $$ select public.admin_save_category(tests.cat('ثالثة'), 'ثانية', 'sun') $$,
  'ZL033', 'category_name_taken', 'also on rename'
);
select tests.cat('ثالثة') as third \gset
select is(
  public.admin_save_category(:third, 'الثالثة', 'shield'), :third::bigint,
  'an admin renames a category'
);
select is(
  tests.last_diff('category.update'),
  jsonb_build_object('name', jsonb_build_object('from', 'ثالثة', 'to', 'الثالثة')),
  'logged with only the name'
);
select lives_ok($$ select public.admin_save_category(tests.cat('الثالثة'), 'الثالثة', 'shield') $$, 'saving without changes works');
select is(tests.audit_count('category.update'), 1, 'and logs nothing');
select throws_ok(
  $$ select public.admin_save_category(999999, 'مفقودة', 'sun') $$,
  'P0002', 'category_not_found', 'a missing category is refused'
);

-- Reorder ------------------------------------------------------------------------------------

select throws_ok(
  $$ select public.admin_reorder_categories(array[tests.cat('ثانية'), tests.cat('أولى'), tests.cat('أولى')]) $$,
  '22023', 'invalid_order', 'each id at most once'
);
select throws_ok(
  $$ select public.admin_reorder_categories(array[]::bigint[]) $$,
  '22023', 'invalid_order', 'and at least one'
);
select lives_ok(
  $$ select public.admin_reorder_categories(array[tests.cat('الثالثة'), tests.cat('أولى'), tests.cat('ثانية')]) $$,
  'an admin reorders the categories'
);
select results_eq(
  $$ select name from public.article_categories order by sort $$,
  $$ values ('الثالثة'), ('أولى'), ('ثانية') $$,
  'in the new order'
);
select is(
  tests.last_diff('category.reorder'),
  jsonb_build_object(
    'order', jsonb_build_object(
      'from', jsonb_build_array('أولى', 'ثانية', 'الثالثة'),
      'to', jsonb_build_array('الثالثة', 'أولى', 'ثانية')
    )
  ),
  'logged with the old and new order by name'
);
select lives_ok(
  $$ select public.admin_reorder_categories(array[tests.cat('أولى'), 999999]) $$,
  'a partial order with a deleted id'
);
select results_eq(
  $$ select name from public.article_categories order by sort $$,
  $$ values ('أولى'), ('الثالثة'), ('ثانية') $$,
  'puts the listed ones first and keeps the rest in their order'
);

-- Delete -------------------------------------------------------------------------------------

select tests.clear_authentication();
insert into public.articles (slug, title, category_id) values ('uses-first', 'مسودة تستعمل الأولى', tests.cat('أولى'));
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.admin_delete_category(tests.cat('أولى')) $$,
  'ZL030', 'category_in_use', 'a category a draft uses is refused'
);
select lives_ok($$ select public.admin_delete_category(tests.cat('ثانية')) $$, 'an admin deletes an unused category');
select is(
  tests.last_diff('category.delete'), jsonb_build_object('name', 'ثانية'),
  'logged as category.delete'
);
select throws_ok(
  $$ select public.admin_delete_category(999999) $$,
  'P0002', 'category_not_found', 'a missing category is refused'
);

select tests.clear_authentication();

select * from finish();
rollback;
