-- Log out on all devices (N13, spec §9.2): delete_my_push_subscriptions()
-- deletes every push subscription of the caller (any logged-in role), and
-- nobody else's. Guests 42501.
begin;
\ir _helpers.psql

select plan(7);

select tests.create_user('+9647801111111');
select tests.create_user('+9647802222222');
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select tests.user_id(p), 'https://fcm.googleapis.com/fcm/send/' || p || n, 'B' || repeat('a', 86), repeat('b', 22)
from unnest(array['+9647801111111', '+9647802222222', '+9647504444444', '+9647703333333']) as p,
  generate_series(1, 2) as n;

create function tests.count_for(p_phone text) returns integer language sql stable security definer
as $$ select count(*)::int from public.push_subscriptions where user_id = tests.user_id(p_phone) $$;
grant execute on all functions in schema tests to anon, authenticated;

select tests.authenticate_as_anon();
select throws_ok($$ select public.delete_my_push_subscriptions() $$, '42501', null, 'a guest can''t call it');

select tests.authenticate_as(tests.user_id('+9647801111111'));
select lives_ok($$ select public.delete_my_push_subscriptions() $$, 'a customer clears theirs');
select is(tests.count_for('+9647801111111'), 0, 'the customer has none left');
select is(tests.count_for('+9647802222222'), 2, 'another customer keeps theirs');

select tests.authenticate_as(tests.user_id('+9647703333333'));
select public.delete_my_push_subscriptions();
select is(tests.count_for('+9647703333333'), 0, 'a crew clears its own');

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.delete_my_push_subscriptions();
select is(tests.count_for('+9647504444444'), 0, 'an admin clears their own');
select is(tests.count_for('+9647802222222'), 2, 'and nobody else''s');

select * from finish();
rollback;
