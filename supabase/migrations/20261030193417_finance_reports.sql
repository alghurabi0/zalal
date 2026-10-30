-- Accounting, part 3: reports and month close (spec §7 "Accounting", §8.3
-- "Overview and reports"; Phase 7, task 3). Settled with the owner on Oct
-- 30, 2026 (spec §13 "Reports and month close").
--
-- 1. Month close: finance_settings.closed_through, null (nothing closed) or
--    the last day of a month. Months close in order, one at a time, from
--    the start day's month, once they have ended (admin_close_finance_month);
--    only the latest closed month reopens, with a reason
--    (admin_reopen_finance_month). Any admin does both, audited. A moving
--    date rather than a table of closed months: books close in order, and
--    one date can't leave an open month between closed ones.
--
-- 2. Nothing dated in a closed month changes (ZL054 month_closed): a trigger
--    on expenses, finance_transfers, finance_payments, manual_sales and
--    finance_discounts (private.finance_refuse_closed) checks the record's
--    day before and after the change, so every writer obeys it, the later
--    tasks' RPCs too. A discount has no day of its own: it counts on its
--    item's revenue day, so that day decides. The one change it lets
--    through is account deletion blanking a customer's notes and reasons
--    (no amount moves; admins never get this pass). Days in the current
--    month skip the settings lock, since this month can't be closed yet.
--
-- 3. An override that takes an order completed in a closed month out of
--    completed is refused (ZL054): its revenue would leave that month.
--    Completing always dates today, so it never lands in a closed month.
--
-- 4. orders.completed_on: the Baghdad day of the last completion while the
--    order is completed. Kept by triggers (order_events after insert, the
--    order's status change), filled for the orders already completed.
--    finance_receivables and private.order_completed_on read it instead of
--    looking up order_events per order.
--
-- 5. While any month is closed the start day doesn't move (ZL056
--    books_closed): an earlier start would add the crews' automatic
--    payments inside closed months, a later one would drop closed months.
--
-- 6. Reports (security invoker, 42501 for non-admins):
--    admin_profit_and_loss(from, to), one row per month: accrual revenue by
--    revenue day (orders, subscriptions, manual sales) less discounts and
--    expenses = profit; and cash: payments in, refunds out, less expenses =
--    net cash. admin_expenses_by_category(from, to): each month's expenses
--    by category. Both from finance_receivables and the record tables.
--
-- New errors: ZL054 month_closed, ZL055 close_not_allowed /
-- reopen_not_allowed, ZL056 books_closed.
--
-- Departures from spec §7: orders.completed_on is new (a copy of what
-- order_events says, kept by triggers) so the books and the month-close
-- guard read one column.

-- finance_settings.closed_through --------------------------------------------------------

alter table public.finance_settings
  add column closed_through date,
  add constraint finance_settings_closed_through_check check (
    closed_through is null
    or closed_through = (date_trunc('month', closed_through) + interval '1 month' - interval '1 day')::date
  );

-- Whether a day is in a closed month. A day in this month never is (a month
-- closes once it has ended), so it skips the lock; an older day share-locks
-- the settings row, so a close running now finishes first or waits for us.
create function private.finance_month_closed(p_day date)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_closed date;
begin
  if p_day is null or p_day >= date_trunc('month', private.baghdad_today())::date then
    return false;
  end if;
  select s.closed_through into v_closed from public.finance_settings as s where s.id for share;
  return coalesce(p_day <= v_closed, false);
end;
$$;

-- orders.completed_on --------------------------------------------------------------------

alter table public.orders
  add column completed_on date,
  add constraint orders_completed_on_check check (completed_on is null or status = 'completed');

create index orders_completed_on_idx on public.orders (completed_on);

-- The orders already completed: their last completion day. updated_at keeps
-- its value (nothing about the order changed).
alter table public.orders disable trigger orders_set_updated_at;
update public.orders as o
set completed_on = c.completed_on
from (
  select e.order_id, (max(e.created_at) at time zone 'Asia/Baghdad')::date as completed_on
  from public.order_events as e
  where e.to_status = 'completed'
  group by e.order_id
) as c
where c.order_id = o.id and o.status = 'completed';
alter table public.orders enable trigger orders_set_updated_at;

-- A completion event sets the day (the last one, as events may arrive out
-- of order in fixtures).
create function private.order_events_set_completed_on()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.orders as o
  set completed_on = (
    select (max(e.created_at) at time zone 'Asia/Baghdad')::date
    from public.order_events as e
    where e.order_id = o.id and e.to_status = 'completed'
  )
  where o.id = new.order_id and o.status = 'completed';
  return null;
end;
$$;

create trigger order_events_set_completed_on
after insert on public.order_events
for each row
when (new.to_status = 'completed')
execute function private.order_events_set_completed_on();

-- Leaving completed clears the day, unless it is in a closed month.
create function private.orders_leave_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'completed' then
    if private.finance_month_closed(old.completed_on) then
      raise exception using errcode = 'ZL054', message = 'month_closed';
    end if;
    new.completed_on := null;
  end if;
  return new;
end;
$$;

create trigger orders_leave_completed
before update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function private.orders_leave_completed();

create or replace function private.order_completed_on(p_order_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select o.completed_on from public.orders as o where o.id = p_order_id;
$$;

-- finance_receivables: the stored completion day ------------------------------------------

create or replace view public.finance_receivables
with (security_invoker = true)
as
with books as (
  select s.start_on from public.finance_settings as s where s.id
),
order_rows as (
  select
    o.id, o.number, o.customer_id, o.crew_id, o.total_iqd, o.completed_on,
    coalesce(o.subscription_id is null and o.completed_on >= b.start_on, false) as counted
  from public.orders as o
  cross join books as b
  where (o.status = 'completed' and o.subscription_id is null)
    or exists (select 1 from public.finance_payments as p where p.order_id = o.id and p.voided_at is null)
),
subscription_rows as (
  select
    s.id, s.user_id, s.price_iqd,
    (s.activated_at at time zone 'Asia/Baghdad')::date as activated_on,
    (s.activated_at at time zone 'Asia/Baghdad')::date >= b.start_on as counted
  from public.subscriptions as s
  cross join books as b
  where s.activated_at is not null
),
items as (
  select
    'order'::text as kind, r.id as item_id, r.id as order_id, null::uuid as subscription_id,
    null::uuid as sale_id, r.number as order_number,
    case when r.counted then r.completed_on end as revenue_on, r.counted,
    r.customer_id, p.full_name as customer_name, p.phone as customer_phone, r.crew_id,
    null::text as service, r.total_iqd
  from order_rows as r
  left join public.profiles as p on p.id = r.customer_id
  union all
  select
    'subscription', r.id, null, r.id, null, null,
    case when r.counted then r.activated_on end, r.counted,
    r.user_id, p.full_name, p.phone, null, null, r.price_iqd
  from subscription_rows as r
  left join public.profiles as p on p.id = r.user_id
  union all
  select
    'sale', m.id, null, null, m.id, null, m.sold_on, true,
    null, m.customer_name, m.customer_phone, m.crew_id, m.service, m.amount_iqd
  from public.manual_sales as m
  where m.voided_at is null
)
select
  i.kind, i.item_id, i.order_id, i.subscription_id, i.sale_id, i.order_number, i.revenue_on, i.counted,
  i.customer_id, i.customer_name, i.customer_phone, i.crew_id, i.service, i.total_iqd,
  case when i.counted then i.total_iqd else 0 end as amount_iqd,
  case when i.counted then coalesce(d.amount_iqd, 0) else 0 end as discount_iqd,
  coalesce(pay.paid_iqd, 0) as paid_iqd,
  case when i.counted then i.total_iqd - coalesce(d.amount_iqd, 0) else 0 end
    - coalesce(pay.paid_iqd, 0) as balance_iqd
from items as i
left join lateral (
  select sum(p.amount_iqd) as paid_iqd
  from public.finance_payments as p
  where p.voided_at is null
    and (p.order_id = i.order_id or p.subscription_id = i.subscription_id or p.sale_id = i.sale_id)
) as pay on true
left join lateral (
  select x.amount_iqd
  from public.finance_discounts as x
  where x.voided_at is null and (x.order_id = i.order_id or x.subscription_id = i.subscription_id)
) as d on true
-- An item outside the books is listed only for its payments.
where (i.counted or pay.paid_iqd is not null)
  and (select private.is_admin());

-- Closed months refuse changes ------------------------------------------------------------

-- The revenue day of a discount's item: an order's completion day, a
-- subscription's activation day.
create function private.finance_item_revenue_on(p_order_id uuid, p_subscription_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select o.completed_on from public.orders as o where o.id = p_order_id),
    (
      select (s.activated_at at time zone 'Asia/Baghdad')::date
      from public.subscriptions as s
      where s.id = p_subscription_id
    )
  );
$$;

-- tg_argv[0]: the record's day column (none for discounts, which take their
-- item's revenue day).
create function private.finance_refuse_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Account deletion blanks these (private.scrub_audit_text); updated_at follows any change.
  v_text constant text[] := array['note', 'reason', 'void_reason', 'updated_at'];
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_new_day date;
  v_old_day date;
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    -- Only free text changed, and not by an admin (they change records only
    -- through the RPCs): the deletion's scrub, which moves no amount.
    if v_old - v_text = v_new - v_text and not coalesce((select private.is_admin()), false) then
      return new;
    end if;
  end if;
  if tg_table_name = 'finance_discounts' then
    v_new_day := private.finance_item_revenue_on((v_new ->> 'order_id')::uuid, (v_new ->> 'subscription_id')::uuid);
    v_old_day := private.finance_item_revenue_on((v_old ->> 'order_id')::uuid, (v_old ->> 'subscription_id')::uuid);
  else
    v_new_day := (v_new ->> tg_argv[0])::date;
    v_old_day := (v_old ->> tg_argv[0])::date;
  end if;
  if private.finance_month_closed(v_new_day) or private.finance_month_closed(v_old_day) then
    raise exception using errcode = 'ZL054', message = 'month_closed';
  end if;
  return new;
end;
$$;

create trigger expenses_refuse_closed
before insert or update on public.expenses
for each row execute function private.finance_refuse_closed('spent_on');

create trigger finance_transfers_refuse_closed
before insert or update on public.finance_transfers
for each row execute function private.finance_refuse_closed('moved_on');

create trigger finance_payments_refuse_closed
before insert or update on public.finance_payments
for each row execute function private.finance_refuse_closed('paid_on');

create trigger manual_sales_refuse_closed
before insert or update on public.manual_sales
for each row execute function private.finance_refuse_closed('sold_on');

create trigger finance_discounts_refuse_closed
before insert or update on public.finance_discounts
for each row execute function private.finance_refuse_closed();

-- admin_close_finance_month / admin_reopen_finance_month -----------------------------------

-- Closes the month of p_month (any day names it): the next one after the
-- last closed month (the start day's month when none is), once it has ended.
create function public.admin_close_finance_month(p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end date;
  v_settings public.finance_settings;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if v_month is null then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  v_end := (v_month + interval '1 month' - interval '1 day')::date;
  -- Waits for records being saved in older months (they share-lock the row).
  select * into v_settings from public.finance_settings as s where s.id for update;
  if v_end >= private.baghdad_today()
    or v_month <> coalesce(v_settings.closed_through + 1, date_trunc('month', v_settings.start_on)::date)
  then
    raise exception using errcode = 'ZL055', message = 'close_not_allowed';
  end if;
  update public.finance_settings as s set closed_through = v_end where s.id;
  perform private.log_admin_action(
    'finance.month_close', 'finance_settings', 'main',
    jsonb_build_object('closed_through', jsonb_build_object('from', v_settings.closed_through, 'to', v_end))
  );
end;
$$;

-- Reopens the latest closed month, with a reason.
create function public.admin_reopen_finance_month(p_month date, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_reason text;
  v_through date;
  v_settings public.finance_settings;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if v_month is null then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  v_reason := private.void_reason(p_reason);
  select * into v_settings from public.finance_settings as s where s.id for update;
  if v_settings.closed_through is distinct from (v_month + interval '1 month' - interval '1 day')::date then
    raise exception using errcode = 'ZL055', message = 'reopen_not_allowed';
  end if;
  v_through := case when v_month > date_trunc('month', v_settings.start_on)::date then v_month - 1 end;
  update public.finance_settings as s set closed_through = v_through where s.id;
  perform private.log_admin_action(
    'finance.month_reopen', 'finance_settings', 'main',
    jsonb_build_object(
      'closed_through', jsonb_build_object('from', v_settings.closed_through, 'to', v_through),
      'reason', v_reason
    )
  );
end;
$$;

-- admin_update_finance_settings: the start day holds while a month is closed --------------

create or replace function public.admin_update_finance_settings(p_start_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old date;
  v_closed date;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_start_on is null then
    raise exception using errcode = '22023', message = 'invalid_start';
  end if;
  if p_start_on > private.baghdad_today() then
    raise exception using errcode = 'ZL043', message = 'date_in_future';
  end if;
  -- Waits for records being saved (they hold a share lock on the row).
  select s.start_on, s.closed_through into v_old, v_closed from public.finance_settings as s where s.id for update;
  if v_old = p_start_on then
    return;
  end if;
  if v_closed is not null then
    raise exception using errcode = 'ZL056', message = 'books_closed';
  end if;
  if exists (
    select 1 from public.expenses as e where e.voided_at is null and e.spent_on < p_start_on
  ) or exists (
    select 1 from public.finance_transfers as t where t.voided_at is null and t.moved_on < p_start_on
  ) or exists (
    select 1 from public.finance_payments as p where p.voided_at is null and p.paid_on < p_start_on
  ) or exists (
    select 1 from public.manual_sales as m where m.voided_at is null and m.sold_on < p_start_on
  ) then
    raise exception using errcode = 'ZL046', message = 'records_before_start';
  end if;
  update public.finance_settings as s set start_on = p_start_on where s.id;
  perform private.log_admin_action(
    'finance.settings', 'finance_settings', 'main',
    jsonb_build_object('start_on', jsonb_build_object('from', v_old, 'to', p_start_on))
  );
  -- An earlier start brings more completed orders into the books: their crews' cash too.
  if p_start_on < v_old then
    perform private.record_crew_cash(o.id)
    from public.orders as o
    where o.status = 'completed' and o.cash_collected and o.subscription_id is null and o.crew_id is not null;
    -- And subscriptions: their paid tick now follows their payments (RLS audit).
    perform private.sync_subscription_paid(s.id)
    from public.subscriptions as s
    where s.activated_at is not null
      and (s.activated_at at time zone 'Asia/Baghdad')::date >= p_start_on
      and (s.activated_at at time zone 'Asia/Baghdad')::date < v_old;
  end if;
end;
$$;

-- Reports (admins only) ------------------------------------------------------------------

-- One row per month. Accrual: the items in the books by revenue day, less
-- their discounts and the month's expenses. Cash: payments in and refunds
-- out by payment day, less expenses. Voided records count nowhere.
create function public.admin_profit_and_loss(p_from date, p_to date)
returns table (
  month date,
  orders_iqd bigint,
  subscriptions_iqd bigint,
  sales_iqd bigint,
  discounts_iqd bigint,
  revenue_iqd bigint,
  expenses_iqd bigint,
  profit_iqd bigint,
  received_iqd bigint,
  refunded_iqd bigint,
  net_cash_iqd bigint,
  closed boolean
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_first date;
  v_last date;
  v_end date;
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_first := date_trunc('month', p_from)::date;
  v_last := date_trunc('month', p_to)::date;
  -- From's month through to's, at most 24.
  if v_first is null or v_last is null or v_last < v_first or v_last >= v_first + interval '24 months' then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  v_end := (v_last + interval '1 month')::date;
  return query
  with months as (
    select g::date as m from generate_series(v_first, v_last, interval '1 month') as g
  ),
  revenue as (
    select
      date_trunc('month', r.revenue_on)::date as m,
      coalesce(sum(r.amount_iqd) filter (where r.kind = 'order'), 0) as orders,
      coalesce(sum(r.amount_iqd) filter (where r.kind = 'subscription'), 0) as subscriptions,
      coalesce(sum(r.amount_iqd) filter (where r.kind = 'sale'), 0) as sales,
      sum(r.discount_iqd) as discounts
    from public.finance_receivables as r
    where r.revenue_on >= v_first and r.revenue_on < v_end
    group by 1
  ),
  spent as (
    select date_trunc('month', e.spent_on)::date as m, sum(e.amount_iqd) as total
    from public.expenses as e
    where e.voided_at is null and e.spent_on >= v_first and e.spent_on < v_end
    group by 1
  ),
  cash as (
    select
      date_trunc('month', p.paid_on)::date as m,
      coalesce(sum(p.amount_iqd) filter (where p.amount_iqd > 0), 0) as received,
      coalesce(-sum(p.amount_iqd) filter (where p.amount_iqd < 0), 0) as refunded
    from public.finance_payments as p
    where p.voided_at is null and p.paid_on >= v_first and p.paid_on < v_end
    group by 1
  ),
  totals as (
    select
      x.m,
      coalesce(r.orders, 0) as orders,
      coalesce(r.subscriptions, 0) as subscriptions,
      coalesce(r.sales, 0) as sales,
      coalesce(r.discounts, 0) as discounts,
      coalesce(s.total, 0) as expenses,
      coalesce(c.received, 0) as received,
      coalesce(c.refunded, 0) as refunded
    from months as x
    left join revenue as r on r.m = x.m
    left join spent as s on s.m = x.m
    left join cash as c on c.m = x.m
  )
  select
    w.m,
    w.orders::bigint,
    w.subscriptions::bigint,
    w.sales::bigint,
    w.discounts::bigint,
    (w.orders + w.subscriptions + w.sales - w.discounts)::bigint,
    w.expenses::bigint,
    (w.orders + w.subscriptions + w.sales - w.discounts - w.expenses)::bigint,
    w.received::bigint,
    w.refunded::bigint,
    (w.received - w.refunded - w.expenses)::bigint,
    coalesce(w.m <= (select f.closed_through from public.finance_settings as f where f.id), false)
  from totals as w
  order by w.m;
end;
$$;

-- Each month's live expenses by category ("where the money went").
create function public.admin_expenses_by_category(p_from date, p_to date)
returns table (month date, category_id bigint, total_iqd bigint)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_first date;
  v_last date;
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_first := date_trunc('month', p_from)::date;
  v_last := date_trunc('month', p_to)::date;
  -- From's month through to's, at most 24.
  if v_first is null or v_last is null or v_last < v_first or v_last >= v_first + interval '24 months' then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  return query
  select date_trunc('month', e.spent_on)::date, e.category_id, sum(e.amount_iqd)::bigint
  from public.expenses as e
  where e.voided_at is null
    and e.spent_on >= v_first
    and e.spent_on < (v_last + interval '1 month')::date
  group by 1, 2
  order by 1, 2;
end;
$$;

-- Access ---------------------------------------------------------------------------------

revoke execute on function public.admin_close_finance_month(date) from public, anon;
revoke execute on function public.admin_reopen_finance_month(date, text) from public, anon;
revoke execute on function public.admin_profit_and_loss(date, date) from public, anon;
revoke execute on function public.admin_expenses_by_category(date, date) from public, anon;
grant execute on function public.admin_close_finance_month(date) to authenticated;
grant execute on function public.admin_reopen_finance_month(date, text) to authenticated;
grant execute on function public.admin_profit_and_loss(date, date) to authenticated;
grant execute on function public.admin_expenses_by_category(date, date) to authenticated;

revoke execute on all functions in schema private from public;
