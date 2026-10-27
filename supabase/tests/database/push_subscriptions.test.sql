-- Web Push subscriptions (spec §9.2, §7 push_subscriptions): one row per
-- browser that allowed push, keyed by its endpoint.
-- - Nobody reads or writes the table through the API; the Edge Function
--   send-push reads it with the service key.
-- - save_push_subscription(endpoint, p256dh, auth, user_agent): any logged-in
--   role (customers, crews, admins); guests and deleted accounts 42501. The
--   endpoint must be https on a known push service (Google, Mozilla, Apple,
--   Microsoft; 22023 invalid_endpoint), so send-push never calls anything
--   else. Keys are base64url (22023 invalid_keys). Saving an endpoint that
--   is already stored moves it to the caller: the browser now belongs to
--   whoever is logged in (a shared crew phone, a new login). At most 10 per
--   user: the least recently saved go.
-- - delete_push_subscription(endpoint): the caller's own row only (logout);
--   someone else's or an unknown endpoint is a no-op.
begin;
\ir _helpers.psql

select plan(30);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;

-- Valid keys: p256dh is a 65-byte P-256 point, auth 16 bytes, both base64url.
create function tests.p256dh() returns text language sql immutable
as $$ select 'B' || repeat('a', 86) $$;
create function tests.auth_key() returns text language sql immutable
as $$ select repeat('b', 22) $$;
create function tests.save(p_endpoint text, p_p256dh text default null, p_auth text default null)
returns void language sql
as $$
  select public.save_push_subscription(
    p_endpoint, coalesce(p_p256dh, tests.p256dh()), coalesce(p_auth, tests.auth_key()), 'Test UA'
  )
$$;
-- Rows read as the test runner (the API roles can't read the table).
create function tests.owner_of(p_endpoint text) returns uuid language sql stable security definer
as $$ select user_id from public.push_subscriptions where endpoint = p_endpoint $$;
create function tests.count_for(p_user uuid) returns integer language sql stable security definer
as $$ select count(*)::int from public.push_subscriptions where user_id = p_user $$;
grant execute on all functions in schema tests to anon, authenticated;

-- The table --------------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass),
  'RLS is on'
);

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select 1 from public.push_subscriptions $$,
  '42501', null, 'a customer can''t read the table'
);
select throws_ok(
  $$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
     values (auth.uid(), 'https://fcm.googleapis.com/fcm/send/x', tests.p256dh(), tests.auth_key()) $$,
  '42501', null, 'nor write it directly'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select 1 from public.push_subscriptions $$,
  '42501', null, 'admins can''t read it either'
);
select tests.authenticate_as_anon();
select throws_ok(
  $$ select 1 from public.push_subscriptions $$,
  '42501', null, 'nor guests'
);

-- Saving ---------------------------------------------------------------------------------

select throws_ok(
  $$ select tests.save('https://fcm.googleapis.com/fcm/send/guest') $$,
  '42501', null, 'guests can''t save a subscription'
);

select tests.authenticate_as(tests.a());
select lives_ok(
  $$ select tests.save('https://fcm.googleapis.com/fcm/send/a-phone') $$,
  'a customer saves a Chrome subscription'
);
select is(tests.owner_of('https://fcm.googleapis.com/fcm/send/a-phone'), tests.a(), 'it is theirs');
select lives_ok(
  $$ select tests.save('https://updates.push.services.mozilla.com/wpush/v2/a-laptop') $$,
  'and a Firefox one'
);
select lives_ok(
  $$ select tests.save('https://web.push.apple.com/QGa-iphone') $$,
  'and an iPhone one'
);
select lives_ok(
  $$ select tests.save('https://wns2-par02p.notify.windows.com/w/?token=a-edge') $$,
  'and an Edge one'
);

-- Saving again refreshes the keys and keeps one row.
select tests.save('https://fcm.googleapis.com/fcm/send/a-phone', 'B' || repeat('c', 86), repeat('d', 22));
select tests.clear_authentication();
select is(
  (select p256dh || ' ' || auth from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/a-phone'),
  'B' || repeat('c', 86) || ' ' || repeat('d', 22),
  'saving the same endpoint again updates its keys'
);
select is(tests.count_for(tests.a()), 4, 'one row per endpoint');

-- Endpoints and keys.
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select tests.save('http://fcm.googleapis.com/fcm/send/plain') $$,
  '22023', 'invalid_endpoint', 'plain http is refused'
);
select throws_ok(
  $$ select tests.save('https://example.com/push') $$,
  '22023', 'invalid_endpoint', 'an unknown host is refused'
);
select throws_ok(
  $$ select tests.save('https://fcm.googleapis.com.evil.example/push') $$,
  '22023', 'invalid_endpoint', 'a look-alike host is refused'
);
select throws_ok(
  $$ select tests.save('https://user@fcm.googleapis.com/push') $$,
  '22023', 'invalid_endpoint', 'credentials in the URL are refused'
);
select throws_ok(
  $$ select tests.save('https://127.0.0.1:54321/functions/v1/send-push') $$,
  '22023', 'invalid_endpoint', 'an address is refused'
);
select throws_ok(
  $$ select tests.save('https://fcm.googleapis.com/fcm/send/x', 'not a key') $$,
  '22023', 'invalid_keys', 'a malformed p256dh is refused'
);
select throws_ok(
  $$ select tests.save('https://fcm.googleapis.com/fcm/send/x', null, 'short') $$,
  '22023', 'invalid_keys', 'a malformed auth secret is refused'
);

-- A crew and an admin save theirs.
select tests.authenticate_as(tests.user_id('+9647703333333'));
select lives_ok(
  $$ select tests.save('https://fcm.googleapis.com/fcm/send/crew-phone') $$,
  'a crew saves a subscription'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select tests.save('https://fcm.googleapis.com/fcm/send/admin-desk') $$,
  'an admin saves one'
);

-- The same browser, now logged in as B: the endpoint moves to B.
select tests.authenticate_as(tests.b());
select tests.save('https://fcm.googleapis.com/fcm/send/a-phone');
select is(
  tests.owner_of('https://fcm.googleapis.com/fcm/send/a-phone'), tests.b(),
  'a browser saved by another account now belongs to that account'
);

-- At most 10 per user: the least recently saved go.
select tests.save('https://fcm.googleapis.com/fcm/send/b-' || n) from generate_series(1, 11) as n;
select is(tests.count_for(tests.b()), 10, 'a user keeps at most 10 subscriptions');
select is(
  tests.owner_of('https://fcm.googleapis.com/fcm/send/a-phone'), null,
  'the least recently saved one was dropped'
);

-- Deleting ---------------------------------------------------------------------------------

select tests.authenticate_as(tests.b());
select public.delete_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/a-laptop');
select is(
  tests.owner_of('https://updates.push.services.mozilla.com/wpush/v2/a-laptop'), tests.a(),
  'another customer can''t delete A''s subscription'
);
select tests.authenticate_as(tests.a());
select public.delete_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/a-laptop');
select is(
  tests.owner_of('https://updates.push.services.mozilla.com/wpush/v2/a-laptop'), null,
  'a customer deletes their own (logout)'
);
select lives_ok(
  $$ select public.delete_push_subscription('https://fcm.googleapis.com/fcm/send/unknown') $$,
  'an unknown endpoint is a no-op'
);

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.delete_push_subscription('https://web.push.apple.com/QGa-iphone') $$,
  '42501', null, 'guests can''t delete'
);

-- A deleted account can't save.
select tests.clear_authentication();
update public.profiles set deleted_at = now() where id = tests.a();
select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select tests.save('https://fcm.googleapis.com/fcm/send/a-again') $$,
  '42501', null, 'a deleted account can''t save a subscription'
);

select * from finish();
rollback;
