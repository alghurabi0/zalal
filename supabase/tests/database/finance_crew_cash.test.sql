-- The automatic payment of a crew's cash (spec §6 completion side effects,
-- §8.3 "Revenue and debts"; Phase 7, task 2).
--
-- A move to completed with "cash collected" (the crew's C4, or an admin
-- override that ticks it) records one payment of the order's total into the
-- order's crew box, dated on the completion day in Baghdad, by whoever
-- completed it. Once per order: completing again after an override records
-- none, even when the first was voided. None for a covered order or one with
-- no crew. A switched-off crew box still takes it (it never blocks a
-- completion). The payment stays when an override takes the order out of
-- completed. An admin corrects it like any payment.
--
-- The start day: an order completed before it has no automatic payment;
-- moving the start earlier records the ones now in the books (by their last
-- completion's cash tick; an order with no completion event is skipped); moving it past
-- a live payment or manual sale is refused (ZL046 records_before_start).
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(21);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.today() - 30 where s.id;

insert into tests.ids values
  ('job', tests.create_order(tests.user_id('+9647801111111'), 'in_progress', now() - interval '1 hour', tests.id('crew'))),
  ('job2', tests.create_order(tests.user_id('+9647801111111'), 'in_progress', now() - interval '1 hour', tests.id('crew'))),
  ('no_crew', tests.create_order(tests.user_id('+9647801111111'), 'confirmed')),
  ('by_admin', tests.create_order(tests.user_id('+9647801111111'), 'arrived', now() - interval '1 hour', tests.id('crew'))),
  ('covered', tests.create_order(tests.user_id('+9647802222222'), 'in_progress', now() - interval '1 hour', tests.id('crew'))),
  ('sub', tests.create_subscription(tests.user_id('+9647802222222'))),
  ('past', tests.create_order(tests.user_id('+9647801111111'), 'completed', now() - interval '40 days', tests.id('crew')));
update public.orders set subscription_id = tests.id('sub') where id = tests.id('covered');
-- Completed with cash 40 days ago, then again 35 days ago without: the last completion decides.
insert into tests.ids values
  ('recash', tests.create_order(tests.user_id('+9647801111111'), 'completed', now() - interval '40 days', tests.id('crew'))),
  -- Completed with cash but no completion event (older data): skipped, never an error.
  ('legacy', tests.create_order(tests.user_id('+9647801111111'), 'completed', now() - interval '40 days', tests.id('crew')));
update public.orders set cash_collected = true where id in (tests.id('past'), tests.id('recash'), tests.id('legacy'));
insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, details, created_at)
values
  (tests.id('recash'), 'in_progress', 'completed', tests.user_id('+9647703333333'), 'crew',
    '{"cash_collected": true}', now() - interval '40 days'),
  (tests.id('recash'), 'completed', 'in_progress', tests.user_id('+9647504444444'), 'admin',
    '{}', now() - interval '36 days'),
  (tests.id('recash'), 'in_progress', 'completed', tests.user_id('+9647504444444'), 'admin',
    '{"cash_collected": false}', now() - interval '35 days');
insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, details, created_at)
values (tests.id('past'), 'in_progress', 'completed', tests.user_id('+9647703333333'), 'crew',
  '{"cash_collected": true}', now() - interval '40 days');

create function tests.crew_box() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where crew_id = tests.id('crew') $$;
create function tests.auto(p_order uuid) returns setof public.finance_payments language sql stable security definer
as $$ select * from public.finance_payments where order_id = p_order and automatic $$;
create function tests.balance(p_account uuid) returns int language sql stable security definer
as $$ select balance_iqd::int from public.finance_account_balances where account_id = p_account $$;
grant execute on all functions in schema tests to anon, authenticated;

-- The crew completes -------------------------------------------------------------------------

select is_empty($$ select * from tests.auto(tests.id('past')) $$, 'an order completed before the start has none');

select tests.authenticate_as(tests.user_id('+9647703333333'));
select public.transition_order(tests.id('job'), 'completed', '{"cash_collected": true, "sterilant": "كلور"}');
select tests.clear_authentication();
select results_eq(
  $$ select account_id, paid_on, amount_iqd, created_by, voided_at from tests.auto(tests.id('job')) $$,
  $$ values (tests.crew_box(), tests.today(), 35000, tests.user_id('+9647703333333'), null::timestamptz) $$,
  'the crew''s cash is recorded into its box, on the day, by the crew'
);
select is(tests.balance(tests.crew_box()), 35000, 'the crew box holds it');

-- Overrides ----------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.transition_order(tests.id('job'), 'in_progress', '{"override": true, "reason": "رجعوا يكملون"}');
select is((select count(*)::int from tests.auto(tests.id('job')) where voided_at is null), 1, 'an override out of completed keeps it');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select public.transition_order(tests.id('job'), 'completed', '{"cash_collected": true, "sterilant": "كلور"}');
select is((select count(*)::int from tests.auto(tests.id('job'))), 1, 'completing again records no second one');

select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  $$ select public.admin_save_payment((select id from tests.auto(tests.id('job'))), null, null, null,
       tests.today(), tests.crew_box(), 30000, 'استلموا أقل') $$,
  'an admin corrects it when the crew took less'
);
select is((select automatic from tests.auto(tests.id('job'))), true, 'and it stays the automatic one');
select public.admin_void_payment((select id from tests.auto(tests.id('job'))), 'ما استلموا');
select public.transition_order(tests.id('job'), 'in_progress', '{"override": true, "reason": "تصحيح"}');
select public.transition_order(tests.id('job'), 'completed', '{"override": true, "reason": "تصحيح", "cash_collected": true}');
select results_eq(
  $$ select count(*)::int, count(*) filter (where voided_at is null)::int from tests.auto(tests.id('job')) $$,
  $$ values (1, 0) $$,
  'nor after the first was voided'
);

select public.transition_order(tests.id('no_crew'), 'completed', '{"override": true, "reason": "تصحيح", "cash_collected": true}');
select is_empty($$ select * from tests.auto(tests.id('no_crew')) $$, 'an order with no crew has none');
select public.transition_order(tests.id('by_admin'), 'completed', '{"override": true, "reason": "تصحيح", "cash_collected": true}');
select results_eq(
  $$ select account_id, created_by from tests.auto(tests.id('by_admin')) $$,
  $$ values (tests.crew_box(), tests.user_id('+9647504444444')) $$,
  'an admin override with cash ticked records it into the crew''s box, by the admin'
);
select public.transition_order(tests.id('by_admin'), 'in_progress', '{"override": true, "reason": "تصحيح"}');
select public.transition_order(tests.id('by_admin'), 'completed', '{"override": true, "reason": "تصحيح"}');
select is((select count(*)::int from tests.auto(tests.id('by_admin'))), 1, 'and one without cash adds none');

-- Covered orders and switched-off boxes ------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333333'));
select public.transition_order(tests.id('covered'), 'completed', '{"cash_collected": true, "sterilant": "كلور"}');
select is_empty($$ select * from tests.auto(tests.id('covered')) $$, 'a covered order collects no cash');

select tests.clear_authentication();
update public.finance_accounts set active = false where id = tests.crew_box();
select tests.authenticate_as(tests.user_id('+9647703333333'));
select lives_ok(
  $$ select public.transition_order(tests.id('job2'), 'completed', '{"cash_collected": true, "sterilant": "كلور"}') $$,
  'a switched-off crew box never blocks a completion'
);
select is((select count(*)::int from tests.auto(tests.id('job2'))), 1, 'and still takes the cash');

-- The start day ------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_update_finance_settings(tests.today() - 45);
select results_eq(
  $$ select paid_on, amount_iqd, created_by from tests.auto(tests.id('past')) $$,
  $$ values (tests.today() - 40, 35000, tests.user_id('+9647703333333')) $$,
  'moving the start earlier records the cash of the orders now in the books'
);
select is_empty(
  $$ select * from tests.auto(tests.id('recash')) $$,
  'but not for an order whose last completion collected no cash'
);
select is_empty(
  $$ select * from tests.auto(tests.id('legacy')) $$,
  'nor one with no completion event'
);
select throws_ok(
  $$ select public.admin_update_finance_settings(tests.today()) $$,
  'ZL046', 'records_before_start', 'the start can''t move past a live payment'
);
select public.admin_void_payment((select id from tests.auto(tests.id('past'))), 'سلّموها قبل الحسابات');
select public.admin_save_manual_sale(null, tests.today() - 5, 'موكب', null, 'تنظيف', null, 50000, null, null, null) as sale \gset
select throws_ok(
  $$ select public.admin_update_finance_settings(tests.today()) $$,
  'ZL046', 'records_before_start', 'nor past a live manual sale'
);
select public.admin_void_manual_sale(:'sale', 'غلط');
select lives_ok(
  $$ select public.admin_update_finance_settings(tests.today()) $$,
  'voided records don''t hold it'
);
select is((select count(*)::int from tests.auto(tests.id('past'))), 1, 'and the voided payment is not made again');

select * from finish();
rollback;
