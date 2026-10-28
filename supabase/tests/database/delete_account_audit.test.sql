-- Account deletion and the audit log (spec §7 "Account deletion", §13
-- "Personal data left after a deletion"; Phase 6, task 4; settled Oct 28,
-- 2026). delete_account() also blanks the free text staff wrote about the
-- account in admin_audit_log: the `note` and `reason` values of rows about
-- its orders, tickets and subscriptions become null. The action, time,
-- admin and every other value stay, and rows about other accounts or other
-- entities are untouched.
begin;
\ir _helpers.psql

select plan(7);

select tests.create_user('+9647801111111');            -- customer A (deleted)
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;
grant execute on all functions in schema tests to anon, authenticated;

insert into tests.ids values ('a_order', tests.create_order(tests.a(), 'completed', now() - interval '20 days'));
insert into tests.ids values ('b_order', tests.create_order(tests.b(), 'completed', now() - interval '20 days'));
insert into tests.ids values ('a_sub', tests.create_subscription(tests.a(), 'active'));
insert into public.tickets (user_id, order_id, category, description, source)
values (tests.a(), tests.id('a_order'), 'leak', 'Water is leaking again', 'app');
insert into tests.ids select 'a_ticket', id from public.tickets where user_id = tests.a();

insert into public.admin_audit_log (admin_id, action, entity, entity_id, diff)
values
  (tests.user_id('+9647504444444'), 'order.transition', 'orders', tests.id('a_order')::text,
   '{"from": "confirmed", "to": "cancelled", "override": true, "reason": "Ahmed at 0780 asked by phone"}'),
  (tests.user_id('+9647504444444'), 'ticket.note', 'tickets', tests.id('a_ticket')::text,
   '{"note": "Lives next to the mosque"}'),
  (tests.user_id('+9647504444444'), 'subscription.adjust', 'subscriptions', tests.id('a_sub')::text,
   '{"visits_left": {"from": 2, "to": 1}, "reason": "Paid cash to Ali"}'),
  (tests.user_id('+9647504444444'), 'order.transition', 'orders', tests.id('b_order')::text,
   '{"from": "confirmed", "to": "cancelled", "override": true, "reason": "B asked"}'),
  (tests.user_id('+9647504444444'), 'slot.update', 'slots', '1',
   '{"reason": "not about a customer"}');

select tests.authenticate_as(tests.a());
select lives_ok($$ select public.delete_account() $$, 'A deletes the account');
select tests.clear_authentication();

select is(
  (select diff from public.admin_audit_log where entity = 'orders' and entity_id = tests.id('a_order')::text),
  '{"from": "confirmed", "to": "cancelled", "override": true, "reason": null}'::jsonb,
  'an order transition keeps its statuses and loses its reason'
);
select is(
  (select diff from public.admin_audit_log where entity = 'tickets' and entity_id = tests.id('a_ticket')::text),
  '{"note": null}'::jsonb,
  'a ticket note row loses its note (the ticket itself is gone)'
);
select is(
  (select diff from public.admin_audit_log where entity = 'subscriptions' and entity_id = tests.id('a_sub')::text),
  '{"visits_left": {"from": 2, "to": 1}, "reason": null}'::jsonb,
  'a subscription adjustment keeps the numbers and loses its reason'
);
select is(
  (select diff ->> 'reason' from public.admin_audit_log where entity = 'orders' and entity_id = tests.id('b_order')::text),
  'B asked',
  'another customer''s rows are untouched'
);
select is(
  (select diff ->> 'reason' from public.admin_audit_log where entity = 'slots'),
  'not about a customer',
  'rows about other entities are untouched'
);
select is(
  (select count(*)::integer from public.admin_audit_log where entity_id in (tests.id('a_order')::text, tests.id('a_ticket')::text, tests.id('a_sub')::text)),
  3,
  'the rows themselves stay'
);

select * from finish();
rollback;
