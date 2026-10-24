-- tanks (spec N3, §7): saved per address and reused in booking. A tank can
-- only sit on its owner's own, live address. last_cleaned_at is set only by
-- order completion (Phase 3), never by the customer.
begin;
\ir _helpers.psql

select plan(29);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647703333333', 'crew');
select tests.create_user('+9647504444444', 'admin');

delete from public.service_areas;
insert into public.service_areas (name, area)
values ('Test Karbala', 'SRID=4326;MULTIPOLYGON(((43.9 32.5, 44.1 32.5, 44.1 32.7, 43.9 32.7, 43.9 32.5)))');

create table tests.addresses (name text primary key, id uuid not null);
grant select on tests.addresses to anon, authenticated;
create function tests.address_id(p_name text) returns uuid language sql stable
as $$ select id from tests.addresses where name = p_name $$;

with a as (
  insert into public.addresses (user_id, label, district, landmark, lat, lng)
  values
    (tests.user_id('+9647801111111'), 'home', 'حي الحسين', 'قرب الجامع', 32.616, 44.024),
    (tests.user_id('+9647801111111'), 'work', 'حي العباس', 'قرب المدرسة', 32.62, 44.03),
    (tests.user_id('+9647802222222'), 'home', 'حي النقيب', 'قرب السوق', 32.60, 44.01)
  returning user_id, label, id
)
insert into tests.addresses
select case when user_id = tests.user_id('+9647801111111') then 'a_' else 'b_' end || label, id
from a;

-- Shape ------------------------------------------------------------------

select has_table('public', 'tanks', 'tanks exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.tanks'::regclass),
  'tanks has RLS enabled'
);

select throws_ok(
  $$ insert into public.tanks (user_id, address_id, type, size)
     values (tests.user_id('+9647802222222'), tests.address_id('a_home'), 'roof', 'm') $$,
  '23503',
  null,
  'the database refuses a tank whose owner differs from the address owner'
);

-- Customer A -------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select lives_ok(
  $$ insert into public.tanks (address_id, type, size, nickname)
     values (tests.address_id('a_home'), 'roof', 'm', 'خزان السطح') $$,
  'a customer can save a tank at their address'
);

select results_eq(
  $$ select user_id, type::text, size::text, last_cleaned_at from public.tanks $$,
  $$ values (tests.user_id('+9647801111111'), 'roof'::text, 'm'::text, null::timestamptz) $$,
  'the tank belongs to the caller and has no cleaning yet'
);

select lives_ok(
  $$ insert into public.tanks (address_id, type, size)
     values (tests.address_id('a_work'), 'ground', 'l') $$,
  'a nickname is optional'
);

select throws_ok(
  $$ insert into public.tanks (address_id, type, size)
     values (tests.address_id('b_home'), 'roof', 's') $$,
  '42501', null, 'a customer cannot save a tank at someone else''s address'
);

select throws_ok(
  $$ insert into public.tanks (user_id, address_id, type, size)
     values (tests.user_id('+9647802222222'), tests.address_id('b_home'), 'roof', 's') $$,
  '42501', null, 'a customer cannot save a tank for someone else'
);

select throws_ok(
  $$ insert into public.tanks (address_id, type, size, nickname)
     values (tests.address_id('a_home'), 'roof', 's', repeat('خ', 31)) $$,
  '23514', null, 'a nickname over 30 characters is refused'
);

select throws_ok(
  $$ insert into public.tanks (address_id, type, size, last_cleaned_at)
     values (tests.address_id('a_home'), 'roof', 's', now()) $$,
  '42501', null, 'a customer cannot set last_cleaned_at on a new tank'
);

select lives_ok(
  $$ update public.tanks set type = 'ground', size = 's', nickname = null
     where address_id = tests.address_id('a_home') $$,
  'a customer can edit type, size and nickname'
);

select throws_ok(
  $$ update public.tanks set last_cleaned_at = now() $$,
  '42501', null, 'a customer cannot set last_cleaned_at'
);

select throws_ok(
  $$ update public.tanks set address_id = tests.address_id('a_work') $$,
  '42501', null, 'a customer cannot move a tank to another address'
);

select tests.clear_authentication();
insert into tests.addresses
select 'tank_home', id from public.tanks where address_id = tests.address_id('a_home');
insert into tests.addresses
select 'tank_work', id from public.tanks where address_id = tests.address_id('a_work');

-- Customer B against A ---------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647802222222'));

select is_empty($$ select 1 from public.tanks $$, 'a customer cannot read another customer''s tanks');

select is_empty(
  $$ update public.tanks set nickname = 'مخترق' returning 1 $$,
  'a customer cannot edit another customer''s tanks'
);

select is_empty(
  $$ delete from public.tanks returning 1 $$,
  'a customer cannot delete another customer''s tanks'
);

-- Crew -------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));

select is_empty($$ select 1 from public.tanks $$, 'a crew reads no tanks');

select throws_ok(
  $$ insert into public.tanks (address_id, type, size)
     values (tests.address_id('a_home'), 'roof', 's') $$,
  '42501', null, 'a crew cannot save tanks'
);

-- Admin ------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select is((select count(*)::int from public.tanks), 2, 'an admin reads every tank');

select throws_ok(
  $$ insert into public.tanks (user_id, address_id, type, size)
     values (tests.user_id('+9647801111111'), tests.address_id('a_home'), 'roof', 's') $$,
  '42501', null, 'an admin cannot save tanks'
);

select is_empty(
  $$ update public.tanks set nickname = 'مدير' returning 1 $$,
  'an admin cannot edit tanks directly'
);

select is_empty(
  $$ delete from public.tanks returning 1 $$,
  'an admin cannot delete tanks directly'
);

-- Anon -------------------------------------------------------------------

select tests.authenticate_as_anon();

select throws_ok($$ select * from public.tanks $$, '42501', null, 'anon cannot read tanks');

-- Deletes ----------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select lives_ok(
  $$ delete from public.tanks where id = tests.address_id('tank_home') $$,
  'a customer can delete their tank'
);

select results_eq(
  $$ select id from public.tanks $$,
  $$ values (tests.address_id('tank_work')) $$,
  'the deleted tank is gone'
);

select lives_ok(
  $$ select public.delete_address(tests.address_id('a_work')) $$,
  'a customer deletes an address that has a tank'
);

select is_empty($$ select 1 from public.tanks $$, 'deleting an address deletes its tanks');

select throws_ok(
  $$ insert into public.tanks (address_id, type, size)
     values (tests.address_id('a_work'), 'roof', 's') $$,
  '42501', null, 'a tank cannot be saved at a deleted address'
);

select tests.clear_authentication();

select has_index('public', 'tanks', 'tanks_user_id_idx', 'user_id is indexed');

select * from finish();
rollback;
