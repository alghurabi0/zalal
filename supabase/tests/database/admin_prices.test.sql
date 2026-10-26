-- admin_update_prices(prices) (spec §8.2 A8, §7): the A8 grid saves all six
-- cells at once. Admins only (42501 for everyone else; guests can't call it).
-- p_prices is a list of {tank_type, size, price_iqd}; a malformed list, an
-- unknown cell or a cell given twice is 22023 invalid_prices, and a price
-- outside 1-10,000,000 breaks the table check (23514). Nothing is written
-- unless the whole list is good. Only cells whose price changed are written,
-- each logged as 'price.update' with the old and new price; the result is
-- how many changed. Orders keep the prices they were booked at.
begin;
\ir _helpers.psql

select plan(19);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

update public.price_list set price_iqd = 35000 where tank_type = 'roof' and size = 'm';
update public.price_list set price_iqd = 120000 where tank_type = 'ground' and size = 'l';
insert into tests.ids values ('order', tests.create_order(tests.user_id('+9647801111111')));

create function tests.price(p_type text, p_size text) returns int language sql stable
security definer
as $$
  select price_iqd from public.price_list
  where tank_type = p_type::public.tank_type and size = p_size::public.tank_size
$$;

create function tests.audit_rows() returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = 'price.update' $$;

grant execute on all functions in schema tests to anon, authenticated;

-- Everyone but admins --------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_update_prices('[{"tank_type":"roof","size":"m","price_iqd":1}]') $$,
  '42501', null, 'a guest cannot change prices'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_update_prices('[{"tank_type":"roof","size":"m","price_iqd":1}]') $$,
  '42501', 'not_allowed', 'a customer cannot change prices'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select public.admin_update_prices('[{"tank_type":"roof","size":"m","price_iqd":1}]') $$,
  '42501', 'not_allowed', 'another customer cannot change prices'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_update_prices('[{"tank_type":"roof","size":"m","price_iqd":1}]') $$,
  '42501', 'not_allowed', 'a crew cannot change prices'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ update public.price_list set price_iqd = 1 $$,
  '42501', null, 'a customer still cannot update the table directly'
);

select tests.clear_authentication();
select is(tests.price('roof', 'm'), 35000, 'nothing changed for the refused callers');

-- Admin ----------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select throws_ok(
  $$ update public.price_list set price_iqd = 1 $$,
  '42501', null, 'an admin cannot update the table directly either'
);

select is(
  public.admin_update_prices(
    '[{"tank_type":"roof","size":"m","price_iqd":40000},
      {"tank_type":"ground","size":"l","price_iqd":120000}]'
  ),
  1,
  'an admin saves the grid; one cell changed'
);
select is(tests.price('roof', 'm'), 40000, 'roof/m is 40,000');
select is(tests.price('ground', 'l'), 120000, 'ground/l is unchanged');
select results_eq(
  $$ select admin_id, entity, entity_id, diff from public.admin_audit_log
     where action = 'price.update' $$,
  $$ values (
       tests.user_id('+9647504444444'), 'price_list', 'roof/m',
       '{"from": 35000, "to": 40000}'::jsonb
     ) $$,
  'only the changed cell is in the audit log'
);
select is(
  (select unit_price_iqd from public.order_items where order_id = tests.id('order')),
  35000,
  'a booked order keeps its price'
);

select throws_ok(
  $$ select public.admin_update_prices(
       '[{"tank_type":"roof","size":"s","price_iqd":30000},
         {"tank_type":"roof","size":"m","price_iqd":0}]') $$,
  '23514', null, 'a zero price is refused'
);
select is(tests.price('roof', 's'), 25000, 'and the good cell in that list was not written');
select throws_ok(
  $$ select public.admin_update_prices(
       '[{"tank_type":"roof","size":"m","price_iqd":1},
         {"tank_type":"roof","size":"m","price_iqd":2}]') $$,
  '22023', 'invalid_prices', 'a cell given twice is refused'
);
select throws_ok(
  $$ select public.admin_update_prices('[{"tank_type":"sky","size":"m","price_iqd":1}]') $$,
  '22023', 'invalid_prices', 'an unknown tank type is refused'
);
select throws_ok(
  $$ select public.admin_update_prices('[{"tank_type":"roof","size":"m","price_iqd":"1.5"}]') $$,
  '22023', 'invalid_prices', 'a price that is not a whole number is refused'
);
select throws_ok(
  $$ select public.admin_update_prices('{"tank_type":"roof"}') $$,
  '22023', 'invalid_prices', 'something other than a list is refused'
);
select is(tests.audit_rows(), 1, 'refused saves log nothing');

select * from finish();
rollback;
