-- finance_transfers, admin_save_transfer and admin_void_transfer (spec §7,
-- §8.3 A15; Phase 7, task 1).
--
-- Money moved between two boxes; a crew handing in its cash is a transfer
-- from its box to the cash box. Admins read every transfer; guests,
-- customers and crews none. Nobody writes the table directly.
--
-- admin_save_transfer(id, moved_on, from_account_id, to_account_id,
-- amount_iqd, note): records (id null) or edits a transfer, with the
-- expense rules for the day (ZL042, ZL043), amount (22023 invalid_amount),
-- note (22023 invalid_note) and switched-off boxes (ZL044 account_inactive,
-- kept when an edit leaves the box as it was). Two different boxes (22023
-- same_account). P0002 transfer_not_found, finance_account_not_found; ZL047
-- record_voided. Logs transfer.create / transfer.update.
-- admin_void_transfer(id, reason): ZL011 reason_required; ZL047 once voided.
-- Logs transfer.void.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

select plan(27);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.today() - 30 where s.id;
insert into public.finance_accounts (kind, name, active) values ('bank', 'مصرف مطفأ', false);

create function tests.cash() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'cash' order by created_at limit 1 $$;
create function tests.bank() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where kind = 'bank' and active order by created_at limit 1 $$;
create function tests.off() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where name = 'مصرف مطفأ' $$;
create function tests.crew_box() returns uuid language sql stable security definer
as $$ select id from public.finance_accounts where crew_id = tests.id('crew') $$;
create function tests.transfer(p_id uuid) returns public.finance_transfers language sql stable security definer
as $$ select * from public.finance_transfers where id = p_id $$;
create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.finance_transfers'::regclass),
  'RLS is on for finance_transfers'
);
select throws_ok(
  $$ insert into public.finance_transfers (moved_on, from_account_id, to_account_id, amount_iqd, created_by)
     values (current_date, tests.cash(), tests.cash(), 1000, tests.user_id('+9647504444444')) $$,
  '23514', null, 'a transfer moves money between two different boxes'
);

insert into public.finance_transfers (moved_on, from_account_id, to_account_id, amount_iqd, created_by)
values (tests.today(), tests.crew_box(), tests.cash(), 50000, tests.user_id('+9647504444444'));

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.finance_transfers $$, '42501', null, 'a guest cannot read transfers');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.finance_transfers $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.finance_transfers $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.finance_transfers $$, 'nor a crew, not even its own handover');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.finance_transfers), 1, 'an admin reads them');
select throws_ok(
  $$ delete from public.finance_transfers where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_save_transfer(null, current_date, tests.crew_box(), tests.cash(), 1000, null) $$,
  '42501', null, 'a guest cannot record a transfer'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_save_transfer(null, current_date, tests.crew_box(), tests.cash(), 1000, null) $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_save_transfer(null, current_date, tests.crew_box(), tests.cash(), 1000, null) $$,
  '42501', 'not_allowed', 'nor a crew handing in its own cash'
);
select throws_ok(
  $$ select public.admin_void_transfer((select id from public.finance_transfers limit 1), 'غلط') $$,
  '42501', 'not_allowed', 'and a crew cannot void one'
);

-- Save, edit, void ---------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_transfer(
  null, tests.today() - 1, tests.crew_box(), tests.cash(), 75000, 'تسليم عهدة'
) as handover \gset
select is((tests.transfer(:'handover')).amount_iqd, 75000, 'an admin records a crew handover');
select is(
  tests.last_diff('transfer.create'),
  jsonb_build_object(
    'moved_on', tests.today() - 1, 'from_account_id', tests.crew_box(),
    'to_account_id', tests.cash(), 'amount_iqd', 75000, 'note', 'تسليم عهدة'
  ),
  'logged as transfer.create'
);
select throws_ok(
  $$ select public.admin_save_transfer(null, current_date, tests.cash(), tests.cash(), 1000, null) $$,
  '22023', 'same_account', 'the two boxes differ'
);
select throws_ok(
  $$ select public.admin_save_transfer(null, tests.today() + 1, tests.cash(), tests.bank(), 1000, null) $$,
  'ZL043', 'date_in_future', 'a day after today is refused'
);
select throws_ok(
  $$ select public.admin_save_transfer(null, tests.today() - 31, tests.cash(), tests.bank(), 1000, null) $$,
  'ZL042', 'before_finance_start', 'so is a day before the books start'
);
select throws_ok(
  $$ select public.admin_save_transfer(null, current_date, tests.cash(), tests.bank(), -5, null) $$,
  '22023', 'invalid_amount', 'an amount is positive'
);
select throws_ok(
  $$ select public.admin_save_transfer(null, current_date, tests.cash(), tests.off(), 1000, null) $$,
  'ZL044', 'account_inactive', 'a switched-off box is refused'
);
select throws_ok(
  $$ select public.admin_save_transfer(null, current_date, tests.cash(), gen_random_uuid(), 1000, null) $$,
  'P0002', 'finance_account_not_found', 'so is a missing box'
);
select lives_ok(
  format(
    $$ select public.admin_save_transfer(%L, %L, %L, %L, 70000, 'تسليم عهدة') $$,
    :'handover', tests.today() - 1, tests.crew_box(), tests.bank()
  ),
  'an admin edits a transfer'
);
select is(
  tests.last_diff('transfer.update'),
  jsonb_build_object(
    'to_account_id', jsonb_build_object('from', tests.cash(), 'to', tests.bank()),
    'amount_iqd', jsonb_build_object('from', 75000, 'to', 70000)
  ),
  'logged with only what changed'
);
select throws_ok(
  $$ select public.admin_save_transfer(gen_random_uuid(), current_date, tests.cash(), tests.bank(), 1000, null) $$,
  'P0002', 'transfer_not_found', 'a missing transfer is refused'
);
select throws_ok(
  format($$ select public.admin_void_transfer(%L, null) $$, :'handover'),
  'ZL011', 'reason_required', 'voiding needs a reason'
);
select lives_ok(
  format($$ select public.admin_void_transfer(%L, 'المبلغ ما وصل') $$, :'handover'),
  'an admin voids a transfer'
);
select is(
  tests.last_diff('transfer.void'),
  jsonb_build_object('moved_on', tests.today() - 1, 'amount_iqd', 70000, 'reason', 'المبلغ ما وصل'),
  'logged as transfer.void'
);
select throws_ok(
  format(
    $$ select public.admin_save_transfer(%L, %L, %L, %L, 1000, null) $$,
    :'handover', tests.today() - 1, tests.crew_box(), tests.cash()
  ),
  'ZL047', 'record_voided', 'a voided transfer cannot be edited'
);

select * from finish();
rollback;
