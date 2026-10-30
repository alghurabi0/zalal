-- Accounting, part 2: revenue and debts (spec §7 "Accounting", §8.3
-- "Revenue and debts"; Phase 7, task 2). Settled with the owner on Oct 30,
-- 2026 (spec §13 "Accounting details").
--
-- 1. manual_sales: work done outside the app (phone bookings, hotels and
--    مواكب, outside Karbala). Not an order: a day, the customer's name, an
--    optional phone, the service and place as text, the amount, an optional
--    crew. Workers come with payroll (task 4).
--
-- 2. finance_payments: money in (or, negative, a refund out) for exactly one
--    order, subscription or manual sale, into a box. One table rather than
--    one per item, so the boxes, the lists and task 3's reports sum one
--    table. An item's live payments never total below zero (ZL050). A
--    covered order takes none (the subscription is paid), nor an item
--    outside the books (ZL049); an order not yet completed may be paid
--    ahead.
--
-- 3. The automatic payment: a move to completed with "cash collected" (the
--    crew's C4, or an admin override that ticks it) records the order's
--    total into the order's crew box, dated on the completion day, by
--    whoever completed it (finance_payments.automatic). A trigger on
--    order_events rather than a seventh copy of transition_order: the event
--    already records cash_collected, and every path to completed writes
--    one. Once per order (a unique index over voided rows too), so an
--    override that completes the order again adds none. It skips the
--    switched-off box check, so it never blocks a completion. The orders
--    already completed in the books (and those that join them when the
--    start day moves earlier) get theirs now, so they don't show as owed.
--
-- 4. finance_discounts: a discount with a reason on a completed order or an
--    activated subscription in the books, at most one live per item, up to
--    its amount. In the books only: orders.total_iqd and the certificate
--    don't change. It counts on the item's revenue day.
--
-- 5. finance_receivables (security invoker, admins' rows only): one row per
--    item in the books, with its revenue day, amount, discount, paid and
--    balance (owed above 0, credit below). An order is revenue on its last
--    completion day when completed, not covered and completed on or after
--    the start day; a subscription on its activation day (cancelled or
--    not); a live manual sale on its day. An order outside the books that
--    holds live payments is listed with no amount, so they show as credit.
--    A view rather than functions, so task 3's reports group it by month.
--
-- 6. A subscription in the books is "paid" exactly while its payments cover
--    its price less its discount (private.sync_subscription_paid, both
--    ways); A7's switch keeps only the ones activated before the start day
--    (ZL053 paid_set_by_finance). admin_activate_subscription is unchanged:
--    the new A7 form sends paid false, and the payment is recorded after.
--
-- 6b. finance_customer_balances (security invoker): each customer's items
--    added up, each manual sale alone; admin_revenue_summary(from, to) and
--    admin_expense_summary(…) (security invoker, 42501 for non-admins): the
--    revenue tab's totals, and A16's count and total in SQL (task 1 summed
--    them in the app 1,000 rows at a time).
--
-- Changed functions: finance_account_balances adds the live payments;
-- admin_update_finance_settings also refuses to move the start past a live
-- payment or manual sale (ZL046) and records the automatic payments of the
-- orders a move brings into the books; admin_set_subscription_paid (ZL053);
-- private.scrub_audit_text (delete_account) also blanks the notes of the
-- customer's payments, the reasons of their discounts and the note and
-- reason in those audit rows.
--
-- Access: admins read every new table and the view; guests, customers and
-- crews nothing. Written only by audited security definer RPCs:
-- admin_save_payment / admin_void_payment, admin_save_discount /
-- admin_void_discount, admin_save_manual_sale / admin_void_manual_sale.
-- New errors: ZL049 payment_not_allowed, ZL050 refund_too_large, ZL051
-- discount_not_allowed, ZL052 discount_exists, ZL053 paid_set_by_finance;
-- P0002 payment_not_found, discount_not_found, sale_not_found.
--
-- Departures from spec §7: finance_payments.created_by is null only for an
-- automatic payment whose completion event lost its actor (an account
-- deleted since); finance_discounts.reason is null only once account
-- deletion blanked it (the RPC requires one).

-- manual_sales ---------------------------------------------------------------------------

create table public.manual_sales (
  id uuid primary key default gen_random_uuid(),
  sold_on date not null,
  customer_name text not null
    check (char_length(customer_name) between 2 and 80 and customer_name = btrim(customer_name)),
  customer_phone text check (customer_phone ~ '^\+9647[3-9][0-9]{8}$'),
  service text not null check (char_length(service) between 2 and 120 and service = btrim(service)),
  place text check (char_length(place) between 1 and 120 and place = btrim(place)),
  amount_iqd integer not null check (amount_iqd between 1 and 1000000000),
  crew_id uuid references public.crews (id) on delete restrict,
  note text check (char_length(note) between 1 and 300 and note = btrim(note)),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text check (char_length(void_reason) between 1 and 300 and void_reason = btrim(void_reason)),
  constraint manual_sales_void_check check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

alter table public.manual_sales enable row level security;

create index manual_sales_sold_on_idx on public.manual_sales (sold_on);
create index manual_sales_crew_id_idx on public.manual_sales (crew_id);
create index manual_sales_created_by_idx on public.manual_sales (created_by);
create index manual_sales_voided_by_idx on public.manual_sales (voided_by);

create trigger manual_sales_set_updated_at
before update on public.manual_sales
for each row execute function private.set_updated_at();

revoke all on public.manual_sales from anon, authenticated;
grant select on public.manual_sales to authenticated;

create policy "Admins read the manual sales"
on public.manual_sales
for select
to authenticated
using ((select private.is_admin()));

-- finance_payments -----------------------------------------------------------------------

create table public.finance_payments (
  id uuid primary key default gen_random_uuid(),
  paid_on date not null,
  order_id uuid references public.orders (id) on delete restrict,
  subscription_id uuid references public.subscriptions (id) on delete restrict,
  sale_id uuid references public.manual_sales (id) on delete restrict,
  -- The box the money went into (or, for a refund, left).
  account_id uuid not null references public.finance_accounts (id) on delete restrict,
  -- Negative: a refund.
  amount_iqd integer not null check (amount_iqd between -1000000000 and 1000000000 and amount_iqd <> 0),
  -- The crew's cash, recorded when the order was completed.
  automatic boolean not null default false,
  note text check (char_length(note) between 1 and 300 and note = btrim(note)),
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text check (char_length(void_reason) between 1 and 300 and void_reason = btrim(void_reason)),
  constraint finance_payments_item_check check (num_nonnulls(order_id, subscription_id, sale_id) = 1),
  constraint finance_payments_automatic_check check (not automatic or order_id is not null),
  -- Departure: an automatic payment whose completion lost its actor has none.
  constraint finance_payments_created_by_check check (automatic or created_by is not null),
  constraint finance_payments_void_check check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

alter table public.finance_payments enable row level security;

-- One automatic payment per order, voided or not.
create unique index finance_payments_order_id_automatic_key on public.finance_payments (order_id) where automatic;
create index finance_payments_paid_on_idx on public.finance_payments (paid_on);
create index finance_payments_order_id_idx on public.finance_payments (order_id);
create index finance_payments_subscription_id_idx on public.finance_payments (subscription_id);
create index finance_payments_sale_id_idx on public.finance_payments (sale_id);
create index finance_payments_account_id_idx on public.finance_payments (account_id);
create index finance_payments_created_by_idx on public.finance_payments (created_by);
create index finance_payments_voided_by_idx on public.finance_payments (voided_by);

create trigger finance_payments_set_updated_at
before update on public.finance_payments
for each row execute function private.set_updated_at();

revoke all on public.finance_payments from anon, authenticated;
grant select on public.finance_payments to authenticated;

create policy "Admins read the payments"
on public.finance_payments
for select
to authenticated
using ((select private.is_admin()));

-- finance_discounts ----------------------------------------------------------------------

create table public.finance_discounts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete restrict,
  subscription_id uuid references public.subscriptions (id) on delete restrict,
  amount_iqd integer not null check (amount_iqd between 1 and 1000000000),
  -- Departure: null once account deletion blanked it; the RPC requires one.
  reason text check (char_length(reason) between 1 and 300 and reason = btrim(reason)),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text check (char_length(void_reason) between 1 and 300 and void_reason = btrim(void_reason)),
  constraint finance_discounts_item_check check (num_nonnulls(order_id, subscription_id) = 1),
  constraint finance_discounts_void_check check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

alter table public.finance_discounts enable row level security;

create unique index finance_discounts_order_id_key on public.finance_discounts (order_id) where voided_at is null;
create unique index finance_discounts_subscription_id_key
on public.finance_discounts (subscription_id) where voided_at is null;
create index finance_discounts_order_id_idx on public.finance_discounts (order_id);
create index finance_discounts_subscription_id_idx on public.finance_discounts (subscription_id);
create index finance_discounts_created_by_idx on public.finance_discounts (created_by);
create index finance_discounts_voided_by_idx on public.finance_discounts (voided_by);

create trigger finance_discounts_set_updated_at
before update on public.finance_discounts
for each row execute function private.set_updated_at();

revoke all on public.finance_discounts from anon, authenticated;
grant select on public.finance_discounts to authenticated;

create policy "Admins read the discounts"
on public.finance_discounts
for select
to authenticated
using ((select private.is_admin()));

-- finance_account_balances: with the payments --------------------------------------------

create or replace view public.finance_account_balances
with (security_invoker = true)
as
select
  a.id as account_id,
  a.opening_balance_iqd
    + coalesce((
      select sum(t.amount_iqd) from public.finance_transfers as t
      where t.to_account_id = a.id and t.voided_at is null
    ), 0)
    - coalesce((
      select sum(t.amount_iqd) from public.finance_transfers as t
      where t.from_account_id = a.id and t.voided_at is null
    ), 0)
    - coalesce((
      select sum(e.amount_iqd) from public.expenses as e
      where e.account_id = a.id and e.voided_at is null
    ), 0)
    + coalesce((
      select sum(p.amount_iqd) from public.finance_payments as p
      where p.account_id = a.id and p.voided_at is null
    ), 0) as balance_iqd
from public.finance_accounts as a;

-- finance_receivables --------------------------------------------------------------------

create view public.finance_receivables
with (security_invoker = true)
as
with books as (
  select s.start_on from public.finance_settings as s where s.id
),
order_rows as (
  select
    o.id, o.number, o.customer_id, o.crew_id, o.total_iqd, c.completed_on,
    coalesce(o.subscription_id is null and c.completed_on >= b.start_on, false) as counted
  from public.orders as o
  cross join books as b
  left join lateral (
    -- The last move to completed, while the order is still completed.
    select (max(e.created_at) at time zone 'Asia/Baghdad')::date as completed_on
    from public.order_events as e
    where e.order_id = o.id and e.to_status = 'completed' and o.status = 'completed'
  ) as c on true
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

revoke all on public.finance_receivables from anon, authenticated;
grant select on public.finance_receivables to authenticated;

-- finance_customer_balances --------------------------------------------------------------

-- The revenue tab's "who owes" and "credit": each customer's items added up
-- (orders and subscriptions), each manual sale alone (its customer has no
-- account). Security invoker over finance_receivables, so admins only.
create view public.finance_customer_balances
with (security_invoker = true)
as
select
  'customer'::text as kind, r.customer_id, null::uuid as sale_id,
  max(r.customer_name) as customer_name, max(r.customer_phone) as customer_phone,
  count(*)::integer as items,
  sum(r.amount_iqd - r.discount_iqd)::bigint as amount_iqd,
  sum(r.paid_iqd)::bigint as paid_iqd,
  sum(r.balance_iqd)::bigint as balance_iqd,
  max(r.revenue_on) as last_revenue_on
from public.finance_receivables as r
where r.customer_id is not null
group by r.customer_id
union all
select
  'sale', null, r.sale_id, r.customer_name, r.customer_phone, 1,
  r.amount_iqd - r.discount_iqd, r.paid_iqd, r.balance_iqd, r.revenue_on
from public.finance_receivables as r
where r.sale_id is not null;

revoke all on public.finance_customer_balances from anon, authenticated;
grant select on public.finance_customer_balances to authenticated;

-- Summaries (admins only) ----------------------------------------------------------------

-- The revenue tab's totals: the period's revenue (by revenue day), its
-- discounts and the money in (payments less refunds, by payment day), and
-- what customers owe and hold as credit now.
create function public.admin_revenue_summary(p_from date, p_to date)
returns table (
  revenue_iqd bigint,
  discounts_iqd bigint,
  received_iqd bigint,
  owed_iqd bigint,
  credit_iqd bigint
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  return query
  select
    coalesce((
      select sum(r.amount_iqd) from public.finance_receivables as r
      where r.revenue_on between p_from and p_to
    ), 0)::bigint,
    coalesce((
      select sum(r.discount_iqd) from public.finance_receivables as r
      where r.revenue_on between p_from and p_to
    ), 0)::bigint,
    coalesce((
      select sum(p.amount_iqd) from public.finance_payments as p
      where p.voided_at is null and p.paid_on between p_from and p_to
    ), 0)::bigint,
    coalesce((
      select sum(b.balance_iqd) from public.finance_customer_balances as b where b.balance_iqd > 0
    ), 0)::bigint,
    coalesce((
      select -sum(b.balance_iqd) from public.finance_customer_balances as b where b.balance_iqd < 0
    ), 0)::bigint;
end;
$$;

-- A16's count and total, with its filters (task 1 summed them in the app a
-- page at a time). Words match the note in any case, % and _ as plain
-- characters.
create function public.admin_expense_summary(
  p_from date,
  p_to date,
  p_voided boolean default false,
  p_category_id bigint default null,
  p_account_id uuid default null,
  p_words text default null
)
returns table (count bigint, total bigint)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pattern text := '%' || replace(replace(replace(nullif(btrim(p_words), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  return query
  select count(*), coalesce(sum(e.amount_iqd), 0)::bigint
  from public.expenses as e
  where e.spent_on between p_from and p_to
    and (e.voided_at is not null) = coalesce(p_voided, false)
    and (p_category_id is null or e.category_id = p_category_id)
    and (p_account_id is null or e.account_id = p_account_id)
    and (v_pattern is null or e.note ilike v_pattern);
end;
$$;

-- Helpers --------------------------------------------------------------------------------

-- The day an order was last completed, in Baghdad; null unless it is completed.
create function private.order_completed_on(p_order_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (max(e.created_at) at time zone 'Asia/Baghdad')::date
  from public.order_events as e
  join public.orders as o on o.id = e.order_id
  where e.order_id = p_order_id and e.to_status = 'completed' and o.status = 'completed';
$$;

-- Locks the one item a payment or discount is for (22023 invalid_target
-- unless exactly one is given; P0002 when missing; ZL047 for a voided sale)
-- and returns its amount in the books (null when outside them) and whether
-- it may take a new payment: not a covered order, and not an order or
-- subscription that dropped out of the books.
create function private.lock_finance_item(
  p_order_id uuid,
  p_subscription_id uuid,
  p_sale_id uuid,
  out amount_iqd integer,
  out payable boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_start date := (select s.start_on from public.finance_settings as s where s.id);
  v_order public.orders;
  v_sub public.subscriptions;
  v_sale public.manual_sales;
  v_completed_on date;
begin
  if num_nonnulls(p_order_id, p_subscription_id, p_sale_id) <> 1 then
    raise exception using errcode = '22023', message = 'invalid_target';
  end if;
  if p_order_id is not null then
    select * into v_order from public.orders as o where o.id = p_order_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'order_not_found';
    end if;
    v_completed_on := private.order_completed_on(p_order_id);
    if v_order.subscription_id is null and v_completed_on >= v_start then
      amount_iqd := v_order.total_iqd;
    end if;
    -- An order not yet completed may be paid ahead; one completed before the books may not.
    payable := v_order.subscription_id is null and (v_completed_on is null or v_completed_on >= v_start);
  elsif p_subscription_id is not null then
    select * into v_sub from public.subscriptions as s where s.id = p_subscription_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'subscription_not_found';
    end if;
    if (v_sub.activated_at at time zone 'Asia/Baghdad')::date >= v_start then
      amount_iqd := v_sub.price_iqd;
    end if;
    payable := amount_iqd is not null;
  else
    select * into v_sale from public.manual_sales as m where m.id = p_sale_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'sale_not_found';
    end if;
    if v_sale.voided_at is not null then
      raise exception using errcode = 'ZL047', message = 'record_voided';
    end if;
    amount_iqd := v_sale.amount_iqd;
    payable := true;
  end if;
end;
$$;

-- An item's live payments, refunds taken off, never total below zero.
create function private.finance_check_refunds(p_order_id uuid, p_subscription_id uuid, p_sale_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if (
    select coalesce(sum(p.amount_iqd), 0)
    from public.finance_payments as p
    where p.voided_at is null
      and (p.order_id = p_order_id or p.subscription_id = p_subscription_id or p.sale_id = p_sale_id)
  ) < 0 then
    raise exception using errcode = 'ZL050', message = 'refund_too_large';
  end if;
end;
$$;

-- A subscription in the books is paid exactly while its payments cover its
-- price less its discount. Logged as subscription.paid by the calling admin.
create function private.sync_subscription_paid(p_subscription_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
  v_paid boolean;
begin
  select * into v_sub from public.subscriptions as s where s.id = p_subscription_id;
  if v_sub.activated_at is null
    or (v_sub.activated_at at time zone 'Asia/Baghdad')::date
      < (select s.start_on from public.finance_settings as s where s.id)
  then
    return;
  end if;
  v_paid := v_sub.price_iqd
    - coalesce((
      select d.amount_iqd from public.finance_discounts as d
      where d.subscription_id = v_sub.id and d.voided_at is null
    ), 0)
    - coalesce((
      select sum(p.amount_iqd) from public.finance_payments as p
      where p.subscription_id = v_sub.id and p.voided_at is null
    ), 0) <= 0;
  if v_paid is distinct from v_sub.paid then
    update public.subscriptions as s set paid = v_paid where s.id = v_sub.id;
    perform private.log_admin_action(
      'subscription.paid', 'subscriptions', v_sub.id::text,
      jsonb_build_object('paid', jsonb_build_object('from', v_sub.paid, 'to', v_paid))
    );
  end if;
end;
$$;

-- The automatic payment of a completed order's cash: its total into its crew
-- box, on its last completion day, by whoever completed it. Nothing for a
-- covered order, one with no crew, one completed before the books, or one
-- that already has its automatic payment (voided or not).
create function private.record_crew_cash(p_order_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
  v_event public.order_events;
  v_day date;
  v_box uuid;
begin
  select * into v_order from public.orders as o where o.id = p_order_id;
  if v_order.status is distinct from 'completed' or v_order.subscription_id is not null or v_order.crew_id is null then
    return;
  end if;
  select * into v_event
  from public.order_events as e
  where e.order_id = p_order_id and e.to_status = 'completed'
  order by e.created_at desc, e.id desc
  limit 1;
  v_day := (v_event.created_at at time zone 'Asia/Baghdad')::date;
  if v_day < (select s.start_on from public.finance_settings as s where s.id) then
    return;
  end if;
  select a.id into v_box from public.finance_accounts as a where a.crew_id = v_order.crew_id;
  if v_box is null then
    return;
  end if;
  insert into public.finance_payments (paid_on, order_id, account_id, amount_iqd, automatic, created_by)
  values (v_day, v_order.id, v_box, v_order.total_iqd, true, v_event.actor_id)
  on conflict (order_id) where automatic do nothing;
end;
$$;

create function private.order_events_record_crew_cash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_crew_cash(new.order_id);
  return null;
end;
$$;

create trigger order_events_record_crew_cash
after insert on public.order_events
for each row
when (new.to_status = 'completed' and new.details ->> 'cash_collected' = 'true')
execute function private.order_events_record_crew_cash();

-- The orders completed in the books before this migration.
select private.record_crew_cash(o.id)
from public.orders as o
where o.status = 'completed' and o.cash_collected and o.subscription_id is null and o.crew_id is not null;

-- admin_save_payment ---------------------------------------------------------------------

-- p_id null: a new payment for one item. An edit keeps its item (the item
-- arguments null or the same). Every other value is given each time.
create function public.admin_save_payment(
  p_id uuid default null,
  p_order_id uuid default null,
  p_subscription_id uuid default null,
  p_sale_id uuid default null,
  p_paid_on date default null,
  p_account_id uuid default null,
  p_amount_iqd integer default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.finance_payments;
  v_note text;
  v_order_id uuid := p_order_id;
  v_sub_id uuid := p_subscription_id;
  v_sale_id uuid := p_sale_id;
  v_item record;
  v_id uuid;
  v_new jsonb;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_amount_iqd is null or p_amount_iqd = 0 or p_amount_iqd not between -1000000000 and 1000000000 then
    raise exception using errcode = '22023', message = 'invalid_amount';
  end if;
  v_note := private.finance_note(p_note);
  -- The settings row first (share lock), then the item, as every finance RPC.
  perform private.finance_check_day(p_paid_on);
  if p_id is not null then
    select * into v_old from public.finance_payments as p where p.id = p_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'payment_not_found';
    end if;
    if (p_order_id is not null and p_order_id is distinct from v_old.order_id)
      or (p_subscription_id is not null and p_subscription_id is distinct from v_old.subscription_id)
      or (p_sale_id is not null and p_sale_id is distinct from v_old.sale_id)
    then
      raise exception using errcode = '22023', message = 'invalid_target';
    end if;
    v_order_id := v_old.order_id;
    v_sub_id := v_old.subscription_id;
    v_sale_id := v_old.sale_id;
  end if;
  select * into v_item from private.lock_finance_item(v_order_id, v_sub_id, v_sale_id);
  if p_id is null then
    if not v_item.payable then
      raise exception using errcode = 'ZL049', message = 'payment_not_allowed';
    end if;
  else
    select * into v_old from public.finance_payments as p where p.id = p_id for update;
    if v_old.voided_at is not null then
      raise exception using errcode = 'ZL047', message = 'record_voided';
    end if;
  end if;
  perform private.finance_check_account(p_account_id, v_old.account_id is distinct from p_account_id);

  v_new := jsonb_build_object(
    'paid_on', p_paid_on, 'account_id', p_account_id, 'amount_iqd', p_amount_iqd, 'note', v_note
  );
  if p_id is null then
    insert into public.finance_payments (
      paid_on, order_id, subscription_id, sale_id, account_id, amount_iqd, note, created_by
    )
    values (
      p_paid_on, v_order_id, v_sub_id, v_sale_id, p_account_id, p_amount_iqd, v_note, (select auth.uid())
    )
    returning id into v_id;
    perform private.log_admin_action(
      'payment.create', 'finance_payments', v_id::text,
      jsonb_build_object('order_id', v_order_id, 'subscription_id', v_sub_id, 'sale_id', v_sale_id) || v_new
    );
  else
    v_id := p_id;
    v_diff := private.audit_changes(
      jsonb_build_object(
        'paid_on', v_old.paid_on, 'account_id', v_old.account_id, 'amount_iqd', v_old.amount_iqd,
        'note', v_old.note
      ),
      v_new
    );
    if v_diff <> '{}' then
      update public.finance_payments as p
      set paid_on = p_paid_on, account_id = p_account_id, amount_iqd = p_amount_iqd, note = v_note
      where p.id = p_id;
      perform private.log_admin_action('payment.update', 'finance_payments', p_id::text, v_diff);
    end if;
  end if;

  perform private.finance_check_refunds(v_order_id, v_sub_id, v_sale_id);
  if v_sub_id is not null then
    perform private.sync_subscription_paid(v_sub_id);
  end if;
  return v_id;
end;
$$;

-- admin_void_payment ---------------------------------------------------------------------

create function public.admin_void_payment(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_old public.finance_payments;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_reason := private.void_reason(p_reason);
  select * into v_old from public.finance_payments as p where p.id = p_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'payment_not_found';
  end if;
  -- The item first, then the payment, as admin_save_payment. A voided sale's
  -- payments are voided with it, so its lock never refuses here.
  if v_old.sale_id is not null then
    perform 1 from public.manual_sales as m where m.id = v_old.sale_id for update;
  else
    perform private.lock_finance_item(v_old.order_id, v_old.subscription_id, null);
  end if;
  select * into v_old from public.finance_payments as p where p.id = p_id for update;
  if v_old.voided_at is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;
  update public.finance_payments as p
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where p.id = p_id;
  perform private.log_admin_action(
    'payment.void', 'finance_payments', p_id::text, jsonb_build_object('reason', v_reason)
  );
  perform private.finance_check_refunds(v_old.order_id, v_old.subscription_id, v_old.sale_id);
  if v_old.subscription_id is not null then
    perform private.sync_subscription_paid(v_old.subscription_id);
  end if;
end;
$$;

-- admin_save_discount --------------------------------------------------------------------

-- p_id null: a new discount on an order or a subscription. An edit keeps its item.
create function public.admin_save_discount(
  p_id uuid default null,
  p_order_id uuid default null,
  p_subscription_id uuid default null,
  p_amount_iqd integer default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_old public.finance_discounts;
  v_order_id uuid := p_order_id;
  v_sub_id uuid := p_subscription_id;
  v_item record;
  v_id uuid;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_reason := private.void_reason(p_reason);
  if p_amount_iqd is null or p_amount_iqd < 1 then
    raise exception using errcode = '22023', message = 'invalid_amount';
  end if;
  if p_id is not null then
    select * into v_old from public.finance_discounts as d where d.id = p_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'discount_not_found';
    end if;
    if (p_order_id is not null and p_order_id is distinct from v_old.order_id)
      or (p_subscription_id is not null and p_subscription_id is distinct from v_old.subscription_id)
    then
      raise exception using errcode = '22023', message = 'invalid_target';
    end if;
    v_order_id := v_old.order_id;
    v_sub_id := v_old.subscription_id;
  elsif num_nonnulls(p_order_id, p_subscription_id) <> 1 then
    raise exception using errcode = '22023', message = 'invalid_target';
  end if;
  select * into v_item from private.lock_finance_item(v_order_id, v_sub_id, null);
  if v_item.amount_iqd is null then
    raise exception using errcode = 'ZL051', message = 'discount_not_allowed';
  end if;
  if p_amount_iqd > v_item.amount_iqd then
    raise exception using errcode = '22023', message = 'invalid_amount';
  end if;

  if p_id is null then
    if exists (
      select 1 from public.finance_discounts as d
      where d.voided_at is null and (d.order_id = v_order_id or d.subscription_id = v_sub_id)
    ) then
      raise exception using errcode = 'ZL052', message = 'discount_exists';
    end if;
    insert into public.finance_discounts (order_id, subscription_id, amount_iqd, reason, created_by)
    values (v_order_id, v_sub_id, p_amount_iqd, v_reason, (select auth.uid()))
    returning id into v_id;
    perform private.log_admin_action(
      'discount.create', 'finance_discounts', v_id::text,
      jsonb_build_object(
        'order_id', v_order_id, 'subscription_id', v_sub_id, 'amount_iqd', p_amount_iqd, 'reason', v_reason
      )
    );
  else
    v_id := p_id;
    select * into v_old from public.finance_discounts as d where d.id = p_id for update;
    if v_old.voided_at is not null then
      raise exception using errcode = 'ZL047', message = 'record_voided';
    end if;
    v_diff := private.audit_changes(
      jsonb_build_object('amount_iqd', v_old.amount_iqd, 'reason', v_old.reason),
      jsonb_build_object('amount_iqd', p_amount_iqd, 'reason', v_reason)
    );
    if v_diff <> '{}' then
      update public.finance_discounts as d
      set amount_iqd = p_amount_iqd, reason = v_reason
      where d.id = p_id;
      perform private.log_admin_action('discount.update', 'finance_discounts', p_id::text, v_diff);
    end if;
  end if;

  if v_sub_id is not null then
    perform private.sync_subscription_paid(v_sub_id);
  end if;
  return v_id;
end;
$$;

-- admin_void_discount --------------------------------------------------------------------

create function public.admin_void_discount(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_old public.finance_discounts;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_reason := private.void_reason(p_reason);
  select * into v_old from public.finance_discounts as d where d.id = p_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'discount_not_found';
  end if;
  perform private.lock_finance_item(v_old.order_id, v_old.subscription_id, null);
  select * into v_old from public.finance_discounts as d where d.id = p_id for update;
  if v_old.voided_at is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;
  update public.finance_discounts as d
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where d.id = p_id;
  perform private.log_admin_action(
    'discount.void', 'finance_discounts', p_id::text, jsonb_build_object('reason', v_reason)
  );
  if v_old.subscription_id is not null then
    perform private.sync_subscription_paid(v_old.subscription_id);
  end if;
end;
$$;

-- admin_save_manual_sale -----------------------------------------------------------------

-- p_id null: a new sale; p_paid_account_id (new sales only) also records a
-- payment of the whole amount into that box on the sale's day. Every other
-- value is given each time; text is trimmed, a blank phone, place or note
-- is none.
create function public.admin_save_manual_sale(
  p_id uuid default null,
  p_sold_on date default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_service text default null,
  p_place text default null,
  p_amount_iqd integer default null,
  p_crew_id uuid default null,
  p_note text default null,
  p_paid_account_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(p_customer_name);
  v_phone text := nullif(btrim(p_customer_phone), '');
  v_service text := btrim(p_service);
  v_place text := nullif(btrim(p_place), '');
  v_note text;
  v_old public.manual_sales;
  v_id uuid;
  v_payment_id uuid;
  v_new jsonb;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'invalid_name';
  end if;
  if v_phone !~ '^\+9647[3-9][0-9]{8}$' then
    raise exception using errcode = '22023', message = 'invalid_phone';
  end if;
  if v_service is null or char_length(v_service) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'invalid_service';
  end if;
  if char_length(v_place) > 120 then
    raise exception using errcode = '22023', message = 'invalid_place';
  end if;
  perform private.finance_check_amount(p_amount_iqd);
  v_note := private.finance_note(p_note);
  if p_id is not null and p_paid_account_id is not null then
    raise exception using errcode = '22023', message = 'invalid_payment';
  end if;
  perform private.finance_check_day(p_sold_on);
  if p_crew_id is not null and not exists (select 1 from public.crews as c where c.id = p_crew_id) then
    raise exception using errcode = 'P0002', message = 'crew_not_found';
  end if;

  v_new := jsonb_build_object(
    'sold_on', p_sold_on, 'customer_name', v_name, 'customer_phone', v_phone, 'service', v_service,
    'place', v_place, 'amount_iqd', p_amount_iqd, 'crew_id', p_crew_id, 'note', v_note
  );
  if p_id is null then
    if p_paid_account_id is not null then
      perform private.finance_check_account(p_paid_account_id, true);
    end if;
    insert into public.manual_sales (
      sold_on, customer_name, customer_phone, service, place, amount_iqd, crew_id, note, created_by
    )
    values (
      p_sold_on, v_name, v_phone, v_service, v_place, p_amount_iqd, p_crew_id, v_note, (select auth.uid())
    )
    returning id into v_id;
    perform private.log_admin_action('sale.create', 'manual_sales', v_id::text, v_new);
    if p_paid_account_id is not null then
      insert into public.finance_payments (paid_on, sale_id, account_id, amount_iqd, created_by)
      values (p_sold_on, v_id, p_paid_account_id, p_amount_iqd, (select auth.uid()))
      returning id into v_payment_id;
      perform private.log_admin_action(
        'payment.create', 'finance_payments', v_payment_id::text,
        jsonb_build_object(
          'order_id', null, 'subscription_id', null, 'sale_id', v_id, 'paid_on', p_sold_on,
          'account_id', p_paid_account_id, 'amount_iqd', p_amount_iqd, 'note', null
        )
      );
    end if;
    return v_id;
  end if;

  select * into v_old from public.manual_sales as m where m.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'sale_not_found';
  end if;
  if v_old.voided_at is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;
  v_diff := private.audit_changes(
    jsonb_build_object(
      'sold_on', v_old.sold_on, 'customer_name', v_old.customer_name, 'customer_phone', v_old.customer_phone,
      'service', v_old.service, 'place', v_old.place, 'amount_iqd', v_old.amount_iqd,
      'crew_id', v_old.crew_id, 'note', v_old.note
    ),
    v_new
  );
  if v_diff <> '{}' then
    update public.manual_sales as m
    set sold_on = p_sold_on, customer_name = v_name, customer_phone = v_phone, service = v_service,
      place = v_place, amount_iqd = p_amount_iqd, crew_id = p_crew_id, note = v_note
    where m.id = p_id;
    perform private.log_admin_action('sale.update', 'manual_sales', p_id::text, v_diff);
  end if;
  return p_id;
end;
$$;

-- admin_void_manual_sale -----------------------------------------------------------------

-- Voids the sale and its live payments, with the same reason.
create function public.admin_void_manual_sale(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_old public.manual_sales;
  v_payment_id uuid;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_reason := private.void_reason(p_reason);
  select * into v_old from public.manual_sales as m where m.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'sale_not_found';
  end if;
  if v_old.voided_at is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;
  update public.manual_sales as m
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where m.id = p_id;
  for v_payment_id in
    update public.finance_payments as p
    set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
    where p.sale_id = p_id and p.voided_at is null
    returning p.id
  loop
    perform private.log_admin_action(
      'payment.void', 'finance_payments', v_payment_id::text, jsonb_build_object('reason', v_reason)
    );
  end loop;
  perform private.log_admin_action('sale.void', 'manual_sales', p_id::text, jsonb_build_object('reason', v_reason));
end;
$$;

-- admin_update_finance_settings: payments and sales hold the start too --------------------

create or replace function public.admin_update_finance_settings(p_start_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old date;
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
  select s.start_on into v_old from public.finance_settings as s where s.id for update;
  if v_old = p_start_on then
    return;
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
  end if;
end;
$$;

-- admin_set_subscription_paid: only outside the books ------------------------------------

create or replace function public.admin_set_subscription_paid(p_subscription_id uuid, p_paid boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions := private.lock_subscription(p_subscription_id);
begin
  if v_sub.status <> 'active' then
    raise exception using errcode = 'ZL036', message = 'invalid_subscription_status';
  end if;
  -- In the books, payments set it (private.sync_subscription_paid).
  if (v_sub.activated_at at time zone 'Asia/Baghdad')::date
    >= (select s.start_on from public.finance_settings as s where s.id)
  then
    raise exception using errcode = 'ZL053', message = 'paid_set_by_finance';
  end if;
  if p_paid is null or v_sub.paid = p_paid then
    return;
  end if;
  update public.subscriptions as s set paid = p_paid where s.id = v_sub.id;
  perform private.log_admin_action(
    'subscription.paid', 'subscriptions', v_sub.id::text,
    jsonb_build_object('paid', jsonb_build_object('from', v_sub.paid, 'to', p_paid))
  );
end;
$$;

-- Account deletion: the free text about the customer's money too -------------------------

create or replace function private.scrub_audit_text(p_user_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.admin_audit_log as l
  set diff = (
    select jsonb_object_agg(e.key, case when e.key in ('note', 'reason') then 'null'::jsonb else e.value end)
    from jsonb_each(l.diff) as e
  )
  where (l.diff ->> 'note' is not null or l.diff ->> 'reason' is not null)
    and (
      (l.entity = 'orders' and l.entity_id in (
        select o.id::text from public.orders as o where o.customer_id = p_user_id
      ))
      or (l.entity = 'tickets' and l.entity_id in (
        select t.id::text from public.tickets as t where t.user_id = p_user_id
      ))
      or (l.entity = 'subscriptions' and l.entity_id in (
        select s.id::text from public.subscriptions as s where s.user_id = p_user_id
      ))
      or (l.entity = 'finance_payments' and l.entity_id in (
        select p.id::text
        from public.finance_payments as p
        left join public.orders as o on o.id = p.order_id
        left join public.subscriptions as s on s.id = p.subscription_id
        where o.customer_id = p_user_id or s.user_id = p_user_id
      ))
      or (l.entity = 'finance_discounts' and l.entity_id in (
        select d.id::text
        from public.finance_discounts as d
        left join public.orders as o on o.id = d.order_id
        left join public.subscriptions as s on s.id = d.subscription_id
        where o.customer_id = p_user_id or s.user_id = p_user_id
      ))
    );

  -- Staff notes about the customer's money; the records stay.
  update public.finance_payments as p
  set note = null
  where p.note is not null
    and (
      p.order_id in (select o.id from public.orders as o where o.customer_id = p_user_id)
      or p.subscription_id in (select s.id from public.subscriptions as s where s.user_id = p_user_id)
    );
  update public.finance_discounts as d
  set reason = null
  where d.reason is not null
    and (
      d.order_id in (select o.id from public.orders as o where o.customer_id = p_user_id)
      or d.subscription_id in (select s.id from public.subscriptions as s where s.user_id = p_user_id)
    );
$$;

-- Grants ---------------------------------------------------------------------------------

revoke execute on function public.admin_save_payment(uuid, uuid, uuid, uuid, date, uuid, integer, text)
from public, anon;
grant execute on function public.admin_save_payment(uuid, uuid, uuid, uuid, date, uuid, integer, text)
to authenticated;
revoke execute on function public.admin_void_payment(uuid, text) from public, anon;
grant execute on function public.admin_void_payment(uuid, text) to authenticated;
revoke execute on function public.admin_save_discount(uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.admin_save_discount(uuid, uuid, uuid, integer, text) to authenticated;
revoke execute on function public.admin_void_discount(uuid, text) from public, anon;
grant execute on function public.admin_void_discount(uuid, text) to authenticated;
revoke execute on function public.admin_save_manual_sale(uuid, date, text, text, text, text, integer, uuid, text, uuid)
from public, anon;
grant execute on function public.admin_save_manual_sale(uuid, date, text, text, text, text, integer, uuid, text, uuid)
to authenticated;
revoke execute on function public.admin_void_manual_sale(uuid, text) from public, anon;
grant execute on function public.admin_void_manual_sale(uuid, text) to authenticated;
revoke execute on function public.admin_revenue_summary(date, date) from public, anon;
grant execute on function public.admin_revenue_summary(date, date) to authenticated;
revoke execute on function public.admin_expense_summary(date, date, boolean, bigint, uuid, text) from public, anon;
grant execute on function public.admin_expense_summary(date, date, boolean, bigint, uuid, text) to authenticated;

revoke execute on all functions in schema private from public;
