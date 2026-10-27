-- tickets (spec §5.15, §5.17, §7; Phase 4 builds what ratings need).
--
-- A ticket is numbered from 1001 (shown as ZL-T-1001), belongs to a
-- customer and optionally to one of their orders (the order must be theirs:
-- foreign key on (order_id, user_id)). source 'app' (the Issue report,
-- Phase 5) needs a category and a description of 10–1000 characters;
-- source 'rating' (a rating of 3 stars or fewer, rate_order) needs an
-- order. Status open → in_progress → closed. The customer reads their own
-- tickets, admins read all, crews none. Nobody writes the table directly:
-- rate_order and create_ticket write it, and admins change the status with
-- admin_set_ticket_status (create_ticket.test.sql, admin_tickets.test.sql).
begin;
\ir _helpers.psql

select plan(17);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;

insert into tests.ids values
  ('oa', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('ob', tests.create_order(tests.b(), 'completed', p_crew_id => tests.id('crew1')));

grant execute on all functions in schema tests to anon, authenticated;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.tickets'::regclass),
  'RLS is on for tickets'
);

-- Constraints (as the test runner) ------------------------------------------------------------

insert into public.tickets (user_id, order_id, source) values (tests.a(), tests.id('oa'), 'rating');
insert into public.tickets (user_id, source, category, description)
values (tests.a(), 'app', 'smell', 'الماي بي ريحة كلش قوية');
insert into public.tickets (user_id, order_id, source) values (tests.b(), tests.id('ob'), 'rating');

select is(
  (select seqstart from pg_sequence where seqrelid = 'public.tickets_number_seq'::regclass),
  1001::bigint,
  'ticket numbers start at 1001'
);
-- Sequences don't roll back, so earlier test files may have used numbers.
select results_eq(
  $$ select number - min(number) over (), status::text from public.tickets order by number $$,
  $$ values (0::bigint, 'open'), (1, 'open'), (2, 'open') $$,
  'and run on one by one; a ticket starts open'
);


select throws_ok(
  $$ insert into public.tickets (user_id, order_id, source) values (tests.a(), tests.id('ob'), 'rating') $$,
  '23503', null, 'a ticket can''t name another customer''s order'
);
select throws_ok(
  $$ insert into public.tickets (user_id, source) values (tests.a(), 'rating') $$,
  '23514', null, 'a rating ticket needs its order'
);
select throws_ok(
  $$ insert into public.tickets (user_id, source, description) values (tests.a(), 'app', 'الماي بي ريحة كلش') $$,
  '23514', null, 'an app ticket needs a category'
);
select throws_ok(
  $$ insert into public.tickets (user_id, source, category, description) values (tests.a(), 'app', 'smell', 'قصيرة') $$,
  '23514', null, 'and a description of at least 10 characters'
);


-- Reads ---------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select is((select count(*)::int from public.tickets), 2, 'the customer reads their tickets');
select is_empty(
  $$ select 1 from public.tickets where user_id <> tests.a() $$,
  'and no one else''s'
);

select tests.authenticate_as(tests.b());
select is((select count(*)::int from public.tickets), 1, 'another customer reads only their own');

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select 1 from public.tickets $$, 'the crew reads no ticket');

select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.tickets), 3, 'admins read every ticket');

select tests.authenticate_as_anon();
select throws_ok($$ select 1 from public.tickets $$, '42501', null, 'guests have no access');

-- Writes ----------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ insert into public.tickets (user_id, source, category, description) values (tests.a(), 'app', 'other', 'وصف طويل كفاية') $$,
  '42501', null, 'the customer cannot write a ticket directly'
);
select throws_ok(
  $$ update public.tickets set status = 'closed' where user_id = tests.a() $$,
  '42501', null, 'or close one'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ update public.tickets set status = 'closed' $$,
  '42501', null, 'admins change tickets through RPCs only'
);
select throws_ok(
  $$ delete from public.tickets $$,
  '42501', null, 'and nobody deletes one'
);

select * from finish();
rollback;
