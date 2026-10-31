-- RLS audit of migration finance_reports (spec §7 "Accounting", §8.3
-- "Overview and reports"; Phase 7, task 3).
--
-- 1. A box's opening balance is what it held on the books' start day, a day
--    inside the first closed month once any month is closed, so changing it
--    (or adding a box with one) changes every box's balance at the end of
--    the closed months. Settled with the owner on Oct 30, 2026 (spec §13
--    "Reports and month close"): opening balances stay editable, because no
--    report shows a box's balance at a past month's end, only now, so no
--    closed figure (revenue, discounts, expenses, payments, profit) moves.
--    These tests pin that decision; if a report ever shows past balances,
--    refuse opening balance changes while a month is closed instead.
--
-- 2. Not testable here (two transactions or the clock): a change started on
--    a month's last day and committed after the month closed at midnight.
--    private.finance_month_closed takes the settings lock for that month too
--    on its last day, and completing an order checks the day, so the change
--    waits for the close and is refused (ZL054).
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(3);

select tests.create_user('+9647504444444', 'admin');

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;

create function tests.opening(p_id uuid) returns integer language sql stable security definer
as $$ select opening_balance_iqd from public.finance_accounts where id = p_id $$;
create function tests.box_named(p_name text) returns integer language sql stable security definer
as $$ select opening_balance_iqd from public.finance_accounts where name = p_name $$;

-- The admin's changes, read back afterwards.
create function tests.set_opening(p_id uuid, p_amount integer) returns integer
language plpgsql
as $$
begin
  perform public.admin_save_finance_account(p_id, null, null, p_amount, null);
  return tests.opening(p_id);
exception when sqlstate 'ZL054' or sqlstate 'ZL056' then
  return tests.opening(p_id);
end;
$$;
create function tests.add_box(p_name text, p_amount integer) returns integer
language plpgsql
as $$
begin
  perform public.admin_save_finance_account(null, 'bank', p_name, p_amount, true);
  return tests.box_named(p_name);
exception when sqlstate 'ZL054' or sqlstate 'ZL056' then
  return tests.box_named(p_name);
end;
$$;
grant execute on all functions in schema tests to anon, authenticated;

-- A box made while every month is open, then the two months since the start closed.
select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_finance_account(null, 'cash', 'صندوق التدقيق', 100000, true) as box \gset
select public.admin_close_finance_month(tests.month(2));
select public.admin_close_finance_month(tests.month(1));

-- 1. Opening balances while a month is closed ------------------------------------------

select is(
  tests.set_opening(:'box', 250000),
  250000,
  'a box''s opening balance still changes while a month is closed (no report shows past balances)'
);
select is(
  tests.add_box('مصرف التدقيق', 500000),
  500000,
  'and a box is still added with an opening balance'
);
select lives_ok(
  format($$ select public.admin_save_finance_account(%L, null, 'صندوق المكتب', null, false) $$, :'box'),
  'renaming or switching off a box still goes through'
);

select * from finish();
rollback;
