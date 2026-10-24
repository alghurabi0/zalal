-- addresses (spec §5.4, N2, §7): a customer's saved pins. The pin must be
-- inside an active service area, each label is used once, one address is the
-- default, and deletion is a soft delete through delete_address().
begin;
\ir _helpers.psql

select plan(42);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647703333333', 'crew');
select tests.create_user('+9647504444444', 'admin');

delete from public.service_areas;
insert into public.service_areas (name, area)
values ('Test Karbala', 'SRID=4326;MULTIPOLYGON(((43.9 32.5, 44.1 32.5, 44.1 32.7, 43.9 32.7, 43.9 32.5)))');

-- Address ids by name, readable from any role.
create table tests.addresses (name text primary key, id uuid not null);
grant select on tests.addresses to anon, authenticated;
create function tests.address_id(p_name text) returns uuid language sql stable
as $$ select id from tests.addresses where name = p_name $$;

-- Shape ------------------------------------------------------------------

select has_table('public', 'addresses', 'addresses exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.addresses'::regclass),
  'addresses has RLS enabled'
);

-- Customer A: create -----------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select lives_ok(
  $$ insert into public.addresses (label, district, landmark, lat, lng)
     values ('home', 'حي الحسين', 'قرب جامع الحسين', 32.616, 44.024) $$,
  'a customer can save an address inside the area'
);

select results_eq(
  $$ select user_id, is_default, extensions.st_astext(location::extensions.geometry)
     from public.addresses where label = 'home' $$,
  $$ values (tests.user_id('+9647801111111'), true, 'POINT(44.024 32.616)'::text) $$,
  'the address belongs to the caller, is the default as the first one, and its point comes from lat/lng'
);

select lives_ok(
  $$ insert into public.addresses (label, district, landmark, lat, lng)
     values ('work', 'حي العباس', 'مقابل المدرسة', 32.62, 44.03) $$,
  'a customer can save a second address'
);

select is(
  (select is_default from public.addresses where label = 'work'),
  false,
  'a later address is not the default'
);

select throws_ok(
  $$ insert into public.addresses (label, district, landmark, lat, lng)
     values ('home', 'حي ثاني', 'قرب السوق', 32.61, 44.02) $$,
  '23505',
  null,
  'a label can be used only once'
);

select throws_ok(
  $$ insert into public.addresses (label, district, landmark, lat, lng)
     values ('family', 'المنصور', 'قرب المول', 33.31, 44.36) $$,
  'ZL001',
  'outside_service_area',
  'a pin outside the service area is refused'
);

select throws_ok(
  $$ insert into public.addresses (label, district, landmark, lat, lng)
     values ('family', 'ح', 'قرب السوق', 32.61, 44.02) $$,
  '23514', null, 'a one-character district is refused'
);

select throws_ok(
  $$ insert into public.addresses (label, district, landmark, lat, lng)
     values ('family', 'حي الحسين', repeat('ق', 121), 32.61, 44.02) $$,
  '23514', null, 'a landmark over 120 characters is refused'
);

select throws_ok(
  $$ insert into public.addresses (label, district, landmark, lat, lng)
     values ('family', ' حي الحسين', 'قرب السوق', 32.61, 44.02) $$,
  '23514', null, 'a district with surrounding spaces is refused'
);

select throws_ok(
  $$ insert into public.addresses (user_id, label, district, landmark, lat, lng)
     values (tests.user_id('+9647802222222'), 'family', 'حي الحسين', 'قرب السوق', 32.61, 44.02) $$,
  '42501', null, 'a customer cannot save an address for someone else'
);

select throws_ok(
  $$ insert into public.addresses (label, district, landmark, lat, lng, deleted_at)
     values ('family', 'حي الحسين', 'قرب السوق', 32.61, 44.02, now()) $$,
  '42501', null, 'a customer cannot set deleted_at'
);

select tests.clear_authentication();
insert into tests.addresses
select label::text, id from public.addresses
where user_id = tests.user_id('+9647801111111');

-- Customer A: edit -------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select lives_ok(
  $$ update public.addresses set district = 'حي الأسرة', landmark = 'قرب الفرن'
     where id = tests.address_id('home') $$,
  'a customer can edit their address'
);

select throws_ok(
  $$ update public.addresses set lat = 33.31, lng = 44.36
     where id = tests.address_id('home') $$,
  'ZL001',
  'outside_service_area',
  'moving the pin outside the area is refused'
);

select lives_ok(
  $$ update public.addresses set is_default = true where id = tests.address_id('work') $$,
  'a customer can mark another address as default'
);

select results_eq(
  $$ select label::text from public.addresses where is_default $$,
  $$ values ('work'::text) $$,
  'only the new default is the default'
);

select throws_ok(
  $$ update public.addresses set user_id = tests.user_id('+9647802222222')
     where id = tests.address_id('home') $$,
  '42501', null, 'a customer cannot move an address to someone else'
);

select throws_ok(
  $$ update public.addresses set deleted_at = now() where id = tests.address_id('home') $$,
  '42501', null, 'a customer cannot soft-delete by setting deleted_at'
);

select throws_ok(
  $$ delete from public.addresses where id = tests.address_id('home') $$,
  '42501', null, 'a customer cannot hard-delete an address'
);

-- Customer B against A ---------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647802222222'));

select is_empty(
  $$ select 1 from public.addresses $$,
  'a customer cannot read another customer''s addresses'
);

select is_empty(
  $$ update public.addresses set landmark = 'مخترق'
     where id = tests.address_id('home') returning 1 $$,
  'a customer cannot edit another customer''s address'
);

select throws_ok(
  $$ select public.delete_address(tests.address_id('home')) $$,
  'P0002', 'address_not_found',
  'a customer cannot delete another customer''s address'
);

-- Customer A: delete -----------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));

select lives_ok(
  $$ select public.delete_address(tests.address_id('work')) $$,
  'a customer can delete their address'
);

select results_eq(
  $$ select label::text, is_default from public.addresses $$,
  $$ values ('home'::text, true) $$,
  'the deleted address is hidden and the remaining one becomes the default'
);

select throws_ok(
  $$ select public.delete_address(tests.address_id('work')) $$,
  'P0002', 'address_not_found',
  'deleting an already deleted address is an error'
);

select is_empty(
  $$ update public.addresses set landmark = 'رجعته'
     where id = tests.address_id('work') returning 1 $$,
  'a deleted address cannot be edited'
);

select lives_ok(
  $$ insert into public.addresses (label, district, landmark, lat, lng)
     values ('work', 'حي العباس', 'مقابل المدرسة', 32.62, 44.03) $$,
  'a deleted address frees its label'
);

select lives_ok(
  $$ select public.delete_address(tests.address_id('home')) $$,
  'a customer can delete their default address'
);

select results_eq(
  $$ select label::text, is_default from public.addresses $$,
  $$ values ('work'::text, true) $$,
  'deleting the default promotes the remaining address'
);

-- Crew -------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));

select is_empty(
  $$ select 1 from public.addresses $$,
  'a crew reads no customer addresses (Phase 2/3 adds assigned orders)'
);

select throws_ok(
  $$ insert into public.addresses (label, district, landmark, lat, lng)
     values ('home', 'حي الحسين', 'قرب جامع الحسين', 32.616, 44.024) $$,
  '42501', null, 'a crew cannot save addresses'
);

-- Admin ------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));

select is(
  (select count(*)::int from public.addresses
   where user_id = tests.user_id('+9647801111111')),
  3,
  'an admin reads every address, deleted ones included'
);

select throws_ok(
  $$ insert into public.addresses (label, district, landmark, lat, lng)
     values ('home', 'حي الحسين', 'قرب جامع الحسين', 32.616, 44.024) $$,
  '42501', null, 'an admin cannot save addresses'
);

select is_empty(
  $$ update public.addresses set landmark = 'مدير' returning 1 $$,
  'an admin cannot edit addresses directly'
);

select throws_ok(
  $$ select public.delete_address(
       (select id from public.addresses
        where user_id = tests.user_id('+9647801111111') and deleted_at is null)) $$,
  'P0002', 'address_not_found',
  'an admin cannot delete a customer''s address'
);

-- Anon -------------------------------------------------------------------

select tests.authenticate_as_anon();

select throws_ok(
  $$ select * from public.addresses $$,
  '42501', null, 'anon cannot read addresses'
);

select throws_ok(
  $$ select public.delete_address(tests.address_id('work')) $$,
  '42501', null, 'anon cannot call delete_address'
);

-- Service area changes ---------------------------------------------------

select tests.clear_authentication();
update public.service_areas set active = false;
select tests.authenticate_as(tests.user_id('+9647801111111'));

select lives_ok(
  $$ update public.addresses set landmark = 'قرب الفرن الجديد'
     where id = (select id from public.addresses where label = 'work') $$,
  'an address can still be edited after the area changes, if the pin stays put'
);

select throws_ok(
  $$ insert into public.addresses (label, district, landmark, lat, lng)
     values ('family', 'حي الحسين', 'قرب السوق', 32.61, 44.02) $$,
  'ZL001', 'outside_service_area',
  'no new address is accepted while there is no active area'
);

select tests.clear_authentication();

select is(
  (select count(*)::int from public.addresses
   where user_id = tests.user_id('+9647801111111') and is_default and deleted_at is null),
  1,
  'exactly one default address remains'
);

select has_index('public', 'addresses', 'addresses_user_id_idx', 'user_id is indexed');

select * from finish();
rollback;
