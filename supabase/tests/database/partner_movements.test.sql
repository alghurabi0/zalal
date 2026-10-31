-- partner_movements, admin_save_partner_movement and
-- admin_void_partner_movement (spec §7, §8.3 A22; Phase 7, task 5).
--
-- Capital a partner puts in (into a box) and withdrawals they take (out of
-- a box), dated, with an optional note. They move the box's balance
-- (finance_account_balances) and the partner's balance, never the profit.
-- Admins read them; guests, customers and crews none. Nobody writes the
-- table directly.
--
-- admin_save_partner_movement(id, partner_id, moved_on, kind, account_id,
-- amount_iqd, note) records or edits one with the expense rules: the day
-- (ZL042, ZL043), the amount (22023 invalid_amount), a switched-on box
-- (ZL044 account_inactive), the partner kept on an edit (22023
-- invalid_target), ZL047 once voided. A switched-off partner may still
-- withdraw what they hold. admin_void_partner_movement(id, reason): ZL011,
-- ZL047. P0002 partner_not_found / movement_not_found /
-- finance_account_not_found. Nothing dated in a closed month is added,
-- changed or voided (ZL054), and the start day doesn't move past a live one
-- (ZL046). Logs partner_movement.create / .update / .void.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(29);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;

insert into public.partners (name) values ('أبو علي'), ('موقوف');
update public.partners set active = false where name = 'موقوف';
insert into tests.ids select name, id from public.partners;
insert into public.finance_accounts (kind, name, opening_balance_iqd) values ('cash', 'قاصة الشركاء', 100000);
insert into public.finance_accounts (kind, name, active) values ('bank', 'مصرف قديم', false);
insert into tests.ids select name, id from public.finance_accounts where name in ('قاصة الشركاء', 'مصرف قديم');

create function tests.balance(p_id uuid) returns bigint language sql stable security definer
as $$ select balance_iqd from public.finance_account_balances where account_id = p_id $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.partner_movements'::regclass), 'RLS is on for partner_movements');
select throws_ok(
  format(
    $$ insert into public.partner_movements (partner_id, moved_on, kind, account_id, amount_iqd, created_by)
       values (%L, current_date, 'capital', %L, 0, %L) $$,
    tests.id('أبو علي'), tests.id('قاصة الشركاء'), tests.user_id('+9647504444444')
  ),
  '23514', null, 'an amount is positive'
);

insert into public.partner_movements (partner_id, moved_on, kind, account_id, amount_iqd, created_by)
values (tests.id('أبو علي'), tests.today(), 'capital', tests.id('قاصة الشركاء'), 1000, tests.user_id('+9647504444444'));

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.partner_movements $$, '42501', null, 'a guest cannot read movements');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.partner_movements $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.partner_movements $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.partner_movements $$, 'nor a crew');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.partner_movements), 1, 'an admin reads them');
select throws_ok(
  $$ delete from public.partner_movements where true $$,
  '42501', null, 'but cannot write the table directly'
);
select is(tests.balance(tests.id('قاصة الشركاء')), 101000::bigint, 'capital put in adds to its box');

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  format(
    $$ select public.admin_save_partner_movement(null, %L, current_date, 'capital', %L, 5000, null) $$,
    tests.id('أبو علي'), tests.id('قاصة الشركاء')
  ),
  '42501', null, 'a guest cannot record capital'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  format(
    $$ select public.admin_save_partner_movement(null, %L, current_date, 'capital', %L, 5000, null) $$,
    tests.id('أبو علي'), tests.id('قاصة الشركاء')
  ),
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  format(
    $$ select public.admin_save_partner_movement(null, %L, current_date, 'capital', %L, 5000, null) $$,
    tests.id('أبو علي'), tests.id('قاصة الشركاء')
  ),
  '42501', 'not_allowed', 'nor a crew'
);

-- Save, edit, void ---------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_partner_movement(
  null, tests.id('أبو علي'), tests.month(1) + 2, 'withdrawal', tests.id('قاصة الشركاء'), 30000, 'سحب شهري'
) as pull \gset
select is(
  tests.last_diff('partner_movement.create'),
  jsonb_build_object(
    'partner_id', tests.id('أبو علي'), 'moved_on', tests.month(1) + 2, 'kind', 'withdrawal',
    'account_id', tests.id('قاصة الشركاء'), 'amount_iqd', 30000, 'note', 'سحب شهري'
  ),
  'an admin records a withdrawal, logged as partner_movement.create'
);
select is(tests.balance(tests.id('قاصة الشركاء')), 71000::bigint, 'a withdrawal takes from its box');
select throws_ok(
  format(
    $$ select public.admin_save_partner_movement(null, %L, %L, 'capital', %L, 5000, null) $$,
    tests.id('أبو علي'), tests.month(2) - 1, tests.id('قاصة الشركاء')
  ),
  'ZL042', 'before_finance_start', 'not before the books start'
);
select throws_ok(
  format(
    $$ select public.admin_save_partner_movement(null, %L, %L, 'capital', %L, 5000, null) $$,
    tests.id('أبو علي'), tests.today() + 1, tests.id('قاصة الشركاء')
  ),
  'ZL043', 'date_in_future', 'nor after today'
);
select throws_ok(
  format(
    $$ select public.admin_save_partner_movement(null, %L, current_date, 'capital', %L, 0, null) $$,
    tests.id('أبو علي'), tests.id('قاصة الشركاء')
  ),
  '22023', 'invalid_amount', 'the amount is positive'
);
select throws_ok(
  format(
    $$ select public.admin_save_partner_movement(null, %L, current_date, 'capital', %L, 5000, null) $$,
    tests.id('أبو علي'), tests.id('مصرف قديم')
  ),
  'ZL044', 'account_inactive', 'a switched-off box takes nothing new'
);
select throws_ok(
  format(
    $$ select public.admin_save_partner_movement(null, %L, current_date, 'capital', %L, 5000, null) $$,
    gen_random_uuid(), tests.id('قاصة الشركاء')
  ),
  'P0002', 'partner_not_found', 'a missing partner'
);
select lives_ok(
  format(
    $$ select public.admin_save_partner_movement(null, %L, current_date, 'withdrawal', %L, 500, null) $$,
    tests.id('موقوف'), tests.id('قاصة الشركاء')
  ),
  'a switched-off partner still withdraws what they hold'
);
select throws_ok(
  format(
    $$ select public.admin_save_partner_movement(%L, %L, %L, 'withdrawal', %L, 30000, null) $$,
    :'pull', tests.id('موقوف'), tests.month(1) + 2, tests.id('قاصة الشركاء')
  ),
  '22023', 'invalid_target', 'an edit keeps its partner'
);
select public.admin_save_partner_movement(
  :'pull', tests.id('أبو علي'), tests.month(1) + 2, 'withdrawal', tests.id('قاصة الشركاء'), 25000, 'سحب شهري'
);
select is(
  tests.last_diff('partner_movement.update'),
  jsonb_build_object('amount_iqd', jsonb_build_object('from', 30000, 'to', 25000), 'partner_id', tests.id('أبو علي')),
  'an edit logs what changed, and its partner for the audit log''s link'
);
select throws_ok(
  format($$ select public.admin_void_partner_movement(%L, ' ') $$, :'pull'),
  'ZL011', 'reason_required', 'a void has a reason'
);
select public.admin_void_partner_movement(:'pull', 'مكرر');
select is(tests.balance(tests.id('قاصة الشركاء')), 100500::bigint, 'a voided withdrawal counts nowhere');
select throws_ok(
  format($$ select public.admin_void_partner_movement(%L, 'مرة ثانية') $$, :'pull'),
  'ZL047', 'record_voided', 'a voided record stays as it is'
);
select throws_ok(
  $$ select public.admin_void_partner_movement(gen_random_uuid(), 'غلط') $$,
  'P0002', 'movement_not_found', 'a missing movement'
);

-- Month close and the start day ----------------------------------------------------------------

select public.admin_save_partner_movement(
  null, tests.id('أبو علي'), tests.month(2) + 3, 'capital', tests.id('قاصة الشركاء'), 70000, null
) as early \gset
select throws_ok(
  format($$ select public.admin_update_finance_settings(%L) $$, tests.month(2) + 5),
  'ZL046', 'records_before_start', 'the start day doesn''t move past a live movement'
);
select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(1) - 1 where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format(
    $$ select public.admin_save_partner_movement(null, %L, %L, 'capital', %L, 5000, null) $$,
    tests.id('أبو علي'), tests.month(2) + 9, tests.id('قاصة الشركاء')
  ),
  'ZL054', 'month_closed', 'nothing is added to a closed month'
);
select throws_ok(
  format($$ select public.admin_void_partner_movement(%L, 'غلط') $$, :'early'),
  'ZL054', 'month_closed', 'nor voided in one'
);

select * from finish();
rollback;
