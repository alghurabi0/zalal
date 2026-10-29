-- admin_customers(search, sort, limit) (spec §8.2 A6): the Customers list.
-- Admins only (42501 for everyone else; guests can't call it). One row per
-- live customer account (role customer, not deleted), whether or not they
-- ever booked or entered a name; crew and admin accounts are left out. Each
-- row has the name, phone, sign-up time, the number of orders they ever made
-- (every status, cancelled and no-show included), the latest order's booking
-- time, the district of their default (else oldest) live address, and the
-- number of rows that match the search. Search by name or by phone digits
-- (07…, 7…, +9647… all match; at least 3 digits). Sort 'newest' (sign-up,
-- newest first) or 'most_orders' (most orders first, then newest). The limit
-- is 1–1000; a bad sort or limit is 22023.
begin;
\ir _helpers.psql

select plan(19);

select tests.create_user('+9647801111111');            -- customer, 3 orders
select tests.create_user('+9647802222222');            -- another customer, 1 order
select tests.create_user('+9647803333333');            -- customer, never booked, no name
select tests.create_user('+9647804444444');            -- deleted account
select tests.create_user('+9647505555555', 'admin');
select tests.create_crew('+9647706666666');

-- Accounts other tests left in the database count as deleted (which the list
-- skips), so only this test's customers are live. Then set sign-up times.
update public.profiles set deleted_at = now(), phone = null
where role = 'customer' and deleted_at is null
  and phone <> all (array['+9647801111111', '+9647802222222', '+9647803333333']);
update public.profiles set full_name = 'زينب علي', created_at = now() - interval '3 days'
where phone = '+9647801111111';
update public.profiles set full_name = 'حسن كاظم', created_at = now() - interval '2 days'
where phone = '+9647802222222';
update public.profiles set created_at = now() - interval '1 day' where phone = '+9647803333333';

select tests.create_order(tests.user_id('+9647801111111'), 'completed', now() - interval '20 days');
select tests.create_order(tests.user_id('+9647801111111'), 'cancelled');
select tests.create_order(tests.user_id('+9647801111111'), 'confirmed');
-- Booked at different times: the confirmed one last.
update public.orders
set created_at = now() - case status
  when 'completed' then interval '21 days'
  when 'cancelled' then interval '10 days'
  else interval '5 hours'
end
where customer_id = tests.user_id('+9647801111111');
select tests.create_order(tests.user_id('+9647802222222'), 'no_show', now() - interval '2 days');
-- An admin's own orders don't make them a customer here.
select tests.create_order(tests.user_id('+9647505555555'));

-- A second address, not the default, doesn't name the district.
update public.addresses set district = 'حي العباس'
where user_id = tests.user_id('+9647801111111');
insert into public.addresses (user_id, label, district, landmark, lat, lng)
values (tests.user_id('+9647801111111'), 'work', 'حي النقيب', 'قرب السوق', 32.616, 44.024);

update public.profiles set deleted_at = now(), phone = null, full_name = null
where id = tests.user_id('+9647804444444');

grant execute on all functions in schema tests to anon, authenticated;

-- Guest, customers, crew --------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select * from public.admin_customers() $$,
  '42501', null, 'a guest cannot list customers'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select * from public.admin_customers() $$,
  '42501', 'not_allowed', 'a customer cannot list customers'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select * from public.admin_customers() $$,
  '42501', 'not_allowed', 'another customer cannot list customers'
);
select tests.authenticate_as(tests.user_id('+9647706666666'));
select throws_ok(
  $$ select * from public.admin_customers() $$,
  '42501', 'not_allowed', 'a crew cannot list customers'
);

-- Admin --------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647505555555'));

select results_eq(
  $$ select phone from public.admin_customers() $$,
  $$ values ('+9647803333333'::text), ('+9647802222222'), ('+9647801111111') $$,
  'live customers only, newest sign-up first, booked or not'
);
select results_eq(
  $$ select phone, orders_count from public.admin_customers(p_sort => 'most_orders') $$,
  $$ values ('+9647801111111'::text, 3), ('+9647802222222', 1), ('+9647803333333', 0) $$,
  'most orders first; every status counts'
);
select results_eq(
  $$
    select full_name, district, last_order_at = now() - interval '5 hours', total
    from public.admin_customers() where phone = '+9647801111111'
  $$,
  $$ values ('زينب علي'::text, 'حي العباس'::text, true, 3) $$,
  'name, the default address''s district, the latest booking and the total'
);
select results_eq(
  $$
    select full_name, orders_count, last_order_at, district
    from public.admin_customers() where phone = '+9647803333333'
  $$,
  $$ values (null::text, 0, null::timestamptz, null::text) $$,
  'a customer who never booked or named themselves is listed'
);
select is(
  (select count(*)::integer from public.admin_customers(p_limit => 2)),
  2,
  'the limit caps the rows'
);
select is(
  (select max(total) from public.admin_customers(p_limit => 1)),
  3,
  'the total counts every match, not just the page'
);

-- Search: name, then phone digits in any form.
select results_eq(
  $$ select phone from public.admin_customers('زينب') $$,
  $$ values ('+9647801111111'::text) $$,
  'search by name'
);
select results_eq(
  $$ select phone from public.admin_customers('0780 222') $$,
  $$ values ('+9647802222222'::text) $$,
  'search by local phone digits'
);
select results_eq(
  $$ select phone from public.admin_customers('+96478033') $$,
  $$ values ('+9647803333333'::text) $$,
  'search by international phone digits'
);
select is_empty(
  $$ select 1 from public.admin_customers('%') $$,
  'a % in the search is literal'
);
select is_empty(
  $$ select 1 from public.admin_customers('+96475055') $$,
  'an admin''s phone finds nothing'
);
select is(
  (select max(total) from public.admin_customers('حسن')),
  1,
  'the total counts the matches of the search'
);

select throws_ok(
  $$ select * from public.admin_customers(p_sort => 'name') $$,
  '22023', 'invalid_sort', 'an unknown sort is refused'
);
select throws_ok(
  $$ select * from public.admin_customers(p_limit => 0) $$,
  '22023', 'invalid_limit', 'a limit below 1 is refused'
);
select throws_ok(
  $$ select * from public.admin_customers(p_limit => 1001) $$,
  '22023', 'invalid_limit', 'a limit above 1000 is refused'
);

select * from finish();
rollback;
