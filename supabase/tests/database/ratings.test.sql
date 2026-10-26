-- rate_order() and ratings (spec §5.15, §6, §7; decision 49).
--
-- A customer rates their own completed order once, any time after
-- completion: 1–5 stars, any of the four company tags (repeats dropped) and
-- an optional comment (trimmed, at most 500 characters). 3 stars or fewer
-- opens a support ticket (source 'rating', status open) in the same
-- transaction; the rating keeps its ticket and rate_order returns the
-- ticket number. Errors: guests and staff 42501; someone else's or a
-- missing order P0002; an order that isn't completed ZL025
-- rating_not_allowed; a second rating ZL026 already_rated; bad input 22023.
--
-- ratings is read by the order's customer and by admins, never by crews.
-- Nobody writes it directly.
begin;
\ir _helpers.psql

select plan(30);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;

insert into tests.ids values
  ('good', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('bad', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('three', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('open', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('b', tests.create_order(tests.user_id('+9647802222222'), 'completed', p_crew_id => tests.id('crew1')));

create function tests.rate(p_order text, p_stars int, p_tags public.rating_tag[] default '{}', p_comment text default null)
returns bigint language sql
as $$ select public.rate_order(tests.id(p_order), p_stars, p_tags, p_comment) $$;

grant execute on all functions in schema tests to anon, authenticated;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.ratings'::regclass),
  'RLS is on for ratings'
);

-- Who may rate -----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select tests.rate('good', 5) $$,
  '42501', null, 'guests cannot rate'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select tests.rate('good', 5) $$,
  '42501', 'not_allowed', 'the crew cannot rate'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select tests.rate('good', 5) $$,
  '42501', 'not_allowed', 'nor can admins'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select tests.rate('good', 5) $$,
  'P0002', 'order_not_found', 'another customer cannot rate the order'
);

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.rate_order(gen_random_uuid(), 5, '{}', null) $$,
  'P0002', 'order_not_found', 'a missing order'
);
select throws_ok(
  $$ select tests.rate('open', 5) $$,
  'ZL025', 'rating_not_allowed', 'an order is rated only once it is completed'
);
select throws_ok(
  $$ select tests.rate('good', 0) $$,
  '22023', 'invalid_stars', 'at least 1 star'
);
select throws_ok(
  $$ select tests.rate('good', 6) $$,
  '22023', 'invalid_stars', 'at most 5'
);
select throws_ok(
  $$ select tests.rate('good', null) $$,
  '22023', 'invalid_stars', 'stars are required'
);
select throws_ok(
  $$ select tests.rate('good', 5, '{}', repeat('ك', 501)) $$,
  '22023', 'invalid_comment', 'the comment is at most 500 characters'
);

-- 4 or 5 stars --------------------------------------------------------------------------------

select is(
  tests.rate('good', 5, '{on_time,clean_work,on_time}', '  شغل ممتاز  '),
  null::bigint,
  '5 stars opens no ticket'
);
select results_eq(
  $$ select stars, tags, comment, ticket_id from public.ratings where order_id = tests.id('good') $$,
  $$ values (5::smallint, '{on_time,clean_work}'::public.rating_tag[], 'شغل ممتاز', null::uuid) $$,
  'the rating is saved with tags once each and the comment trimmed'
);
select throws_ok(
  $$ select tests.rate('good', 4) $$,
  'ZL026', 'already_rated', 'an order is rated once'
);
select is_empty(
  $$ select 1 from public.tickets $$,
  'no ticket so far'
);

-- 3 stars or fewer ----------------------------------------------------------------------------

select tests.clear_authentication();
create table tests.n (n bigint);
grant insert, select on tests.n to authenticated;
select tests.authenticate_as(tests.a());
select lives_ok(
  $$ insert into tests.n select tests.rate('bad', 2, '{}', '   ') $$,
  '2 stars'
);
select results_eq(
  $$ select t.number, t.user_id, t.order_id, t.source::text, t.status::text, t.category, t.description
     from public.tickets as t $$,
  $$ select (select n from tests.n), tests.a(), tests.id('bad'), 'rating', 'open', null::public.ticket_category, null::text $$,
  'opens a ticket for the order, and returns its number'
);
select results_eq(
  $$ select r.ticket_id, r.comment from public.ratings as r where r.order_id = tests.id('bad') $$,
  $$ select t.id, null::text from public.tickets as t $$,
  'the rating keeps its ticket; a blank comment is none'
);
select isnt(
  tests.rate('three', 3, '{clear_photos}'),
  null::bigint,
  '3 stars opens a ticket too'
);
select is((select count(*)::int from public.tickets), 2, 'two tickets now');

-- Reads -------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647802222222'));
select lives_ok($$ select tests.rate('b', 1) $$, 'another customer rates their own order');
select results_eq(
  $$ select order_id from public.ratings $$,
  $$ values (tests.id('b')) $$,
  'and reads only their own rating'
);

select tests.authenticate_as(tests.a());
select is((select count(*)::int from public.ratings), 3, 'the customer reads their ratings');

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select 1 from public.ratings $$, 'the crew reads no rating');

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.ratings), 4, 'admins read every rating');

select tests.authenticate_as_anon();
select throws_ok($$ select 1 from public.ratings $$, '42501', null, 'guests have no access');

-- Writes ------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ update public.ratings set stars = 5 where order_id = tests.id('bad') $$,
  '42501', null, 'the customer cannot change a rating'
);
select throws_ok(
  $$ insert into public.ratings (order_id, stars) values (tests.id('open'), 5) $$,
  '42501', null, 'or write one past rate_order'
);
select throws_ok(
  $$ delete from public.ratings where order_id = tests.id('bad') $$,
  '42501', null, 'or delete one'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ delete from public.ratings where order_id = tests.id('bad') $$,
  '42501', null, 'admins cannot delete a rating either'
);

select * from finish();
rollback;
