-- RLS audit of migration finance_partners (spec §7 "Accounting", §8.3 A20
-- and A22; Phase 7, task 5): partners, partner_shares, partner_movements,
-- opening_equipment, equipment_disposals, expenses.useful_life_months, the
-- views finance_equipment and finance_depreciation, and the reads
-- admin_equipment, admin_partner_balances, admin_balance_sheet. These are the
-- checks the audit ran that partners, partner_shares, partner_movements,
-- equipment, finance_balance_sheet and finance_opening_balances don't
-- already make.
--
-- 1. Privileges: no API role uses partner_shares' identity sequence or
--    writes any new table or view (nor expenses.useful_life_months); the
--    views are security invoker; no new table sends Realtime events; guests
--    run none of the new or replaced RPCs; every security definer function
--    of the migration has an empty search_path.
-- 2. A demoted admin (now a customer) reads no partner, share, movement or
--    equipment and runs none of the partner and equipment RPCs or reads; a
--    crew reads no depreciation and no partner balances.
-- 3. Month close: a closed month's figures (its profit and loss, each
--    partner's balance and profit share, the balance sheet, the equipment
--    and its depreciation) stay the same while the open month gets a
--    disposal of a purchase from a closed month, new shares, a withdrawal, a
--    new partner and a new box; a whole purchase dated in a closed month
--    gets no life.
-- 4. FINDING: admin_set_partner_shares adds a share to the 100% total for
--    each key, but stores one share per partner. Two spellings of one
--    partner's id ("…abc" and "…ABC", or with braces) count twice towards
--    10000 and are stored once, so a month's shares total less than 100%
--    and part of every later month's profit belongs to nobody (the
--    balance sheet stops balancing).
--
-- Not testable here (two transactions): the lock order. Every new writer
-- share-locks the settings row first (finance_check_day or a direct FOR
-- SHARE), then its partner, purchase or opening item, then the record, then
-- the box. admin_void_expense still locks the expense before the settings
-- row (through the expenses_refuse_closed trigger), as since migration
-- finance_ledger; it can't deadlock with admin_save_equipment_disposal
-- (settings, then the expense), since both take the settings row in share
-- mode, which doesn't queue behind a waiting month close.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(33);

select tests.create_user('+9647801111111');            -- customer
select tests.create_user('+9647504444444', 'admin');
select tests.create_user('+9647504444445', 'admin');   -- demoted below
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;
update public.finance_accounts set opening_balance_iqd = 0 where true;
insert into public.finance_accounts (kind, name, opening_balance_iqd) values ('cash', 'قاصة تدقيق', 500000);
insert into public.expense_categories (name, kind) values ('عام تدقيق', 'general'), ('معدات تدقيق', 'equipment');
insert into public.partners (name, opening_capital_iqd) values ('شريك أول', 300000), ('شريك ثاني', 200000);
insert into tests.ids
select name, id from public.partners
union all select 'cash', id from public.finance_accounts where name = 'قاصة تدقيق';

create function tests.category(p_name text) returns bigint language sql stable security definer
as $$ select id from public.expense_categories where name = p_name $$;
create function tests.month_total(p_month date) returns int language sql stable security definer
as $$ select coalesce(sum(s.share_bp), 0)::int from public.partner_shares as s where s.starts_on = p_month $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Records in what become the closed months, made while they are open.
select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_manual_sale(
  null, tests.month(2) + 3, 'موكب', null, 'تنظيف', null, 90000, null, null, tests.id('cash')
);
select public.admin_save_expense(null, tests.month(2) + 4, tests.category('عام تدقيق'), tests.id('cash'), 12000, null);
select public.admin_save_expense(
  null, tests.month(2) + 5, tests.category('معدات تدقيق'), tests.id('cash'), 60000, 'مضخة', null, 6
) as pump \gset
select public.admin_save_opening_equipment(null, 'سيارة', 36000, 12, null) as car \gset
select public.admin_set_partner_shares(
  tests.month(2), jsonb_build_object(tests.id('شريك أول'), 6000, tests.id('شريك ثاني'), 4000)
);
select public.admin_save_partner_movement(
  null, tests.id('شريك ثاني'), tests.month(1) + 2, 'capital', tests.id('cash'), 50000, null
);
select tests.clear_authentication();
-- A whole purchase in an equipment category, as saved before lives existed.
insert into public.expenses (spent_on, category_id, account_id, amount_iqd, created_by)
values (tests.month(1) + 3, tests.category('معدات تدقيق'), tests.id('cash'), 8000, tests.user_id('+9647504444444'))
returning id as old_buy \gset

update public.finance_settings as s set closed_through = tests.month(0) - 1 where s.id;

-- 1. Privileges --------------------------------------------------------------------------------

select ok(
  not has_sequence_privilege('anon', 'public.partner_shares_id_seq', 'usage')
    and not has_sequence_privilege('anon', 'public.partner_shares_id_seq', 'update')
    and not has_sequence_privilege('authenticated', 'public.partner_shares_id_seq', 'usage')
    and not has_sequence_privilege('authenticated', 'public.partner_shares_id_seq', 'update'),
  'no API role uses the partner_shares identity sequence'
);
select is_empty(
  $$ select r.role || ' ' || t.name || ' ' || p.priv
     from unnest(array[
       'partners', 'partner_shares', 'partner_movements', 'opening_equipment', 'equipment_disposals',
       'finance_equipment', 'finance_depreciation', 'finance_account_balances'
     ]) as t(name)
     cross join unnest(array['anon', 'authenticated']) as r(role)
     cross join unnest(array['insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as p(priv)
     where has_table_privilege(r.role, 'public.' || t.name, p.priv) $$,
  'no API role writes the partner and equipment tables or views'
);
select ok(
  not has_table_privilege('anon', 'public.partners', 'select')
    and not has_table_privilege('anon', 'public.finance_equipment', 'select')
    and not has_table_privilege('anon', 'public.finance_depreciation', 'select'),
  'guests have no select on them either'
);
select ok(
  not has_column_privilege('authenticated', 'public.expenses', 'useful_life_months', 'update')
    and not has_column_privilege('authenticated', 'public.expenses', 'useful_life_months', 'insert'),
  'no API role writes expenses.useful_life_months directly'
);
select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class as c
   where c.oid in ('public.finance_equipment'::regclass, 'public.finance_depreciation'::regclass,
                   'public.finance_account_balances'::regclass)
     and 'security_invoker=true' = any(c.reloptions)),
  array['finance_account_balances', 'finance_depreciation', 'finance_equipment'],
  'the views run as the caller'
);
select is_empty(
  $$ select tablename from pg_publication_tables
     where pubname = 'supabase_realtime'
       and tablename in ('partners', 'partner_shares', 'partner_movements', 'opening_equipment', 'equipment_disposals') $$,
  'no partner or equipment table sends Realtime events'
);
select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_proc as p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in (
         'admin_save_partner', 'admin_set_partner_shares', 'admin_save_partner_movement',
         'admin_void_partner_movement', 'admin_save_opening_equipment', 'admin_void_opening_equipment',
         'admin_save_equipment_disposal', 'admin_void_equipment_disposal', 'admin_save_expense',
         'admin_void_expense', 'admin_save_expense_category', 'admin_save_finance_account',
         'admin_update_finance_settings', 'admin_equipment', 'admin_profit_and_loss',
         'admin_expenses_by_category', 'admin_partner_balances', 'admin_balance_sheet'
       )
       and (has_function_privilege('anon', p.oid, 'execute')
         or exists (select 1 from aclexplode(p.proacl) as a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) $$,
  'guests (and PUBLIC) run none of the new or replaced RPCs'
);
select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_proc as p
     where p.pronamespace = 'public'::regnamespace
       and p.prosecdef
       and p.proname ~ '^admin_(save|set|void)_(partner|opening_equipment|equipment_disposal|expense|finance_account)'
       and not coalesce('search_path=""' = any(p.proconfig), false) $$,
  'every security definer writer has an empty search_path'
);

-- 2. Demoted admin, crew -----------------------------------------------------------------------

update public.profiles set role = 'customer' where id = tests.user_id('+9647504444445');
select tests.authenticate_as(tests.user_id('+9647504444445'));
select is_empty(
  $$ select 1 from public.partners
     union all select 1 from public.partner_shares
     union all select 1 from public.partner_movements
     union all select 1 from public.opening_equipment
     union all select 1 from public.equipment_disposals
     union all select 1 from public.finance_equipment
     union all select 1 from public.finance_depreciation $$,
  'a demoted admin reads no partner, share, movement or equipment'
);
select throws_ok(
  format($$ select public.admin_save_partner(%L, 'شريك أول', null, null, 0) $$, tests.id('شريك أول')),
  '42501', 'not_allowed', 'nor zeroes a partner''s capital'
);
select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, '{}') $$, tests.month(0)),
  '42501', 'not_allowed', 'nor sets shares'
);
select throws_ok(
  format($$ select public.admin_void_equipment_disposal(%L, 'سبب') $$, gen_random_uuid()),
  '42501', 'not_allowed', 'nor voids a disposal'
);
select throws_ok(
  format($$ select * from public.admin_partner_balances(%L) $$, tests.month(1)),
  '42501', 'not_allowed', 'nor reads the partner balances'
);
select throws_ok(
  format($$ select * from public.admin_balance_sheet(%L) $$, tests.month(1)),
  '42501', 'not_allowed', 'nor the balance sheet'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.finance_depreciation $$, 'a crew reads no depreciation');
select throws_ok(
  format($$ select * from public.admin_partner_balances(%L) $$, tests.month(1)),
  '42501', 'not_allowed', 'nor the partner balances'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.finance_equipment $$, 'a customer reads no equipment');

-- 3. Month close -------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
-- The closed months as they stand.
select jsonb_agg(to_jsonb(p) order by p.month)::text as pl
from public.admin_profit_and_loss(tests.month(2), tests.month(1)) as p \gset
select jsonb_agg(to_jsonb(b) order by b.partner_id)::text as pb
from public.admin_partner_balances(tests.month(1)) as b \gset
select to_jsonb(s)::text as bs from public.admin_balance_sheet(tests.month(1)) as s \gset
select jsonb_agg(to_jsonb(e) - 'disposal_id' - 'disposed_on' - 'disposal_account_id' - 'proceeds_iqd'
                 - 'result_iqd' order by e.item_id)::text as eq
from public.admin_equipment(tests.month(1)) as e \gset
select jsonb_agg(to_jsonb(d) order by d.item_id, d.month)::text as dep
from public.finance_depreciation as d where d.month < tests.month(0) \gset

select ok(
  (select s.balanced from public.admin_balance_sheet(tests.month(1)) as s),
  'the closed month''s balance sheet balances before'
);

-- The open month moves on.
select lives_ok(
  format($$ select public.admin_save_equipment_disposal(null, %L, null, %L, %L, 30000, null) $$,
    :'pump', tests.month(0), tests.id('cash')),
  'a purchase from a closed month is disposed of in the open one'
);
select lives_ok(
  format($$ select public.admin_set_partner_shares(%L, %L) $$,
    tests.month(0), jsonb_build_object(tests.id('شريك أول'), 9000, tests.id('شريك ثاني'), 1000)),
  'the open month gets new shares'
);
select lives_ok(
  format($$ select public.admin_save_partner_movement(null, %L, %L, 'withdrawal', %L, 20000, null) $$,
    tests.id('شريك أول'), tests.month(0), tests.id('cash')),
  'and a withdrawal'
);
select lives_ok(
  $$ select public.admin_save_partner(null, 'شريك جديد') $$,
  'and a new partner with no capital'
);
select lives_ok(
  $$ select public.admin_save_finance_account(null, 'bank', 'مصرف تدقيق') $$,
  'and a new box with no opening balance'
);

select is(
  (select jsonb_agg(to_jsonb(p) order by p.month) from public.admin_profit_and_loss(tests.month(2), tests.month(1)) as p),
  :'pl'::jsonb,
  'the closed months'' profit and loss hold'
);
select is(
  (select jsonb_agg(to_jsonb(b) order by b.partner_id) from public.admin_partner_balances(tests.month(1)) as b
   where b.partner_id is null or b.partner_id in (tests.id('شريك أول'), tests.id('شريك ثاني'))),
  :'pb'::jsonb,
  'so do each partner''s balance and profit share at the closed month''s end'
);
select is(
  (select to_jsonb(s) from public.admin_balance_sheet(tests.month(1)) as s),
  :'bs'::jsonb,
  'and the balance sheet'
);
select is(
  (select jsonb_agg(to_jsonb(e) - 'disposal_id' - 'disposed_on' - 'disposal_account_id' - 'proceeds_iqd'
                    - 'result_iqd' order by e.item_id)
   from public.admin_equipment(tests.month(1)) as e),
  :'eq'::jsonb,
  'and the equipment at its end'
);
select is(
  (select jsonb_agg(to_jsonb(d) order by d.item_id, d.month) from public.finance_depreciation as d
   where d.month < tests.month(0)),
  :'dep'::jsonb,
  'and every closed month''s depreciation'
);
select throws_ok(
  format($$ select public.admin_save_expense(%L, %L, %s, %L, 8000, null, null, 12) $$,
    :'old_buy', tests.month(1) + 3, tests.category('معدات تدقيق'), tests.id('cash')),
  'ZL054', 'month_closed', 'a whole purchase in a closed month gets no life'
);
select throws_ok(
  format($$ select public.admin_void_opening_equipment(%L, 'سبب') $$, :'car'),
  'ZL056', 'books_closed', 'opening equipment is not voided while a month is closed'
);

-- 4. Finding: one partner named twice --------------------------------------------------------

select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, %L) $$,
    tests.month(0),
    jsonb_build_object(
      lower(tests.id('شريك أول')::text), 5000,
      upper(tests.id('شريك أول')::text), 5000
    )),
  '22023', 'invalid_shares', 'one partner named twice (two spellings of the id) is refused'
);
select is(
  tests.month_total(tests.month(0)),
  10000,
  'so the month''s shares still total 100%'
);
select ok(
  (select s.balanced from public.admin_balance_sheet(tests.month(0)) as s),
  'and this month''s balance sheet still balances (all its profit belongs to someone)'
);

select * from finish();
rollback;
