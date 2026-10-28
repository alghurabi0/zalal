-- Moving a subscribed address (spec §13, settled Oct 28, 2026): the pin of
-- an address whose subscription is requested, or active and not yet past
-- its end, can't move (ZL041 address_subscribed). District and landmark stay
-- editable, and an address whose subscription ended moves freely.
begin;
\ir _helpers.psql

select plan(7);

select tests.create_user('+9647801111111');
select tests.create_user('+9647802222222');
insert into tests.ids values ('home', tests.create_address(tests.user_id('+9647801111111')));
insert into tests.ids values ('work', tests.create_address(tests.user_id('+9647801111111'), 'work'));
insert into tests.ids values ('other', tests.create_address(tests.user_id('+9647802222222')));
insert into tests.ids values ('sub', tests.create_subscription(tests.user_id('+9647801111111'), 'active', p_address_id => tests.id('home')));
insert into tests.ids values ('req', tests.create_subscription(tests.user_id('+9647801111111'), 'requested', p_address_id => tests.id('work')));
grant execute on all functions in schema tests to authenticated;

select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ update public.addresses set lat = 32.617 where id = tests.id('home') $$,
  'ZL041', 'address_subscribed', 'an active subscription pins the address'
);
select throws_ok(
  $$ update public.addresses set lng = 44.025 where id = tests.id('work') $$,
  'ZL041', 'address_subscribed', 'a request pins it too'
);
select lives_ok(
  $$ update public.addresses set district = 'حي العباس', landmark = 'قرب المدرسة' where id = tests.id('home') $$,
  'district and landmark stay editable'
);
select lives_ok(
  $$ update public.addresses set lat = 32.616, lng = 44.024 where id = tests.id('home') $$,
  'saving the same pin is fine'
);

select tests.clear_authentication();
update public.subscriptions
set starts_on = current_date - 400,
  ends_on = ((current_date - 400) + interval '1 year' - interval '1 day')::date
where id = tests.id('sub');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select lives_ok(
  $$ update public.addresses set lat = 32.617 where id = tests.id('home') $$,
  'an expired subscription doesn''t pin it'
);

select tests.clear_authentication();
update public.subscriptions set status = 'declined', ended_at = now() where id = tests.id('req');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select lives_ok(
  $$ update public.addresses set lat = 32.617 where id = tests.id('work') $$,
  'a declined request doesn''t pin it'
);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select lives_ok(
  $$ update public.addresses set lat = 32.617 where id = tests.id('other') $$,
  'an address without a subscription moves'
);

select * from finish();
rollback;
