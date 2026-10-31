-- Accounting, part 5: partners, equipment spread over its life, accrued wages
-- and the balance sheet (spec §7 "Accounting", §8.3 A20 and A22; Phase 7,
-- task 5). Settled with the owner on Oct 31, 2026 with the plan's
-- recommendations (spec §13 "Partners and balance sheet").
--
-- 1. partners: records in the books with no login (name, optional phone and
--    note, the capital each held at the books' start, a switch). The
--    opening capital holds while a month is closed (ZL056), like every
--    opening balance.
--
-- 2. partner_shares: each partner's share of the profit in hundredths of a
--    percent, from a month's first day until the next month with shares.
--    A month's shares total 100% (ZL061 shares_total) and are saved as one
--    set (admin_set_partner_shares; an empty set removes the month's).
--    Shares change only from the 1st, so each month has one set and its
--    profit is split by it: rounded down, the dinars left to the largest
--    remainders, so the shares add up to the profit exactly. A loss is
--    shared the same way. The profit of a month with no shares in force is
--    "not yet shared" (it stays in the equity).
--
-- 3. partner_movements: capital put in (into a box) and withdrawals (out of
--    one), dated, voidable. They move the box and the partner's balance,
--    never the profit. The profit share stays on paper until withdrawn. A
--    switched-off partner may still withdraw; a withdrawal beyond the
--    partner's balance is allowed (the screen warns).
--
-- 4. expenses.useful_life_months: a purchase in an equipment category is
--    spread over its life, straight line by month from its own month (cost
--    ÷ life rounded down, the last month the rest), with no salvage value.
--    A life only on an equipment category (ZL060 life_not_allowed); a new
--    expense in one, or one moved into one, needs a life (22023
--    invalid_life, 1–240 months). Purchases saved before this migration
--    keep none and stay whole expenses in their month; an admin may give
--    one a life while its month is open. A category with live spread
--    purchases stays an equipment one (ZL060), and a spread purchase keeps
--    a life (22023 invalid_life). Editing a purchase can't
--    reach a closed month: its first month of depreciation is its own.
--
-- 5. opening_equipment: what the company owned at the books' start, with its
--    value then and the months left, spread from the start day's month. No
--    box: its value is part of the opening balances. Added, changed and
--    voided only while no month is closed (ZL056).
--
-- 6. equipment_disposals: a dated write-off of a spread item, one live per
--    item (ZL062 equipment_disposed), with an optional sale price into a
--    box (22023 invalid_payment: both or neither). The disposal month has
--    no depreciation; the result (price less what was left) counts in it.
--    An item with a live disposal is neither edited nor voided (ZL062).
--
-- 7. Wages are accrued: the profit counts what workers earned each month
--    (admin_payroll), and a wage expense linked to a worker pays down what
--    they're owed instead of counting again. Wages with no worker (casual
--    labour) stay an expense when paid. The cash view is unchanged.
--
-- 8. Views and reads (security invoker; admins only, 42501 otherwise):
--    finance_equipment (each spread item with its disposal) and
--    finance_depreciation (each item's months); admin_equipment(month);
--    admin_profit_and_loss gains spent, wages, depreciation, equipment
--    result and paid out (its return type changes, so it is dropped and
--    made again; expenses_iqd now means the month's costs on the accrual
--    basis); admin_expenses_by_category gains counted_iqd (the part the
--    profit counts); admin_partner_balances(month); admin_balance_sheet(month):
--    at a month's end (or today), assets (boxes, crew cash, what customers
--    owe, workers' advances, equipment left) and liabilities (customer
--    credit, wages owed) from their records, equity (partners, profit not
--    yet shared, opening balances no partner holds) from its own, and
--    whether they agree. Customer credit is never netted against what
--    others owe; each customer's items are added up as on A18.
--
-- 9. Month close: partner_shares, partner_movements and equipment_disposals
--    get the *_refuse_closed trigger. Box opening balances now hold while a
--    month is closed too (ZL056), since the balance sheet shows a box at a
--    past month's end (spec §13, Oct 30: "if one ever does, lock them").
--    The start day doesn't move past a live movement, disposal or a month
--    with shares (ZL046). Writers share-lock the settings row first, then
--    the partner, purchase or opening item, then the record.
--
-- Changed functions: admin_save_expense (the life; dropped and made again,
-- its signature grows), admin_void_expense and admin_save_expense_category
-- (ZL062, ZL060), admin_save_finance_account (ZL056),
-- admin_update_finance_settings (ZL046), finance_account_balances (with
-- partner movements and sale prices).
--
-- Access: admins read every new table and view; guests, customers and
-- crews nothing. Written only by audited security definer RPCs:
-- admin_save_partner, admin_set_partner_shares, admin_save_partner_movement
-- / admin_void_partner_movement, admin_save_opening_equipment /
-- admin_void_opening_equipment, admin_save_equipment_disposal /
-- admin_void_equipment_disposal.
--
-- New errors: ZL060 life_not_allowed, ZL061 shares_total, ZL062
-- equipment_disposed, ZL063 partner_has_share (switching off a partner who
-- holds a share in the set in force or a later one); ZL044 also covers partner_inactive; 22023
-- invalid_shares, invalid_life; P0002 partner_not_found,
-- movement_not_found, equipment_not_found, disposal_not_found.
--
-- Departures from spec §7: none beyond the new tables and column, which §7
-- now lists. Depreciation, profit shares and the balance sheet are
-- computed, never stored, so they can't drift from their records.
--
-- Release: the migration refuses to run while any month is closed; reopen
-- them first (spec §13): accrued wages and spread purchases change the
-- profit of every month in the books.

-- Refused while a month is closed: the new methods change every month's profit.
do $$
begin
  if exists (select 1 from public.finance_settings as s where s.id and s.closed_through is not null) then
    raise exception 'finance_partners: reopen every closed month before this migration (spec §13)';
  end if;
end;
$$;

-- Types ----------------------------------------------------------------------------------

create type public.partner_movement_kind as enum ('capital', 'withdrawal');

-- partners -------------------------------------------------------------------------------

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 60 and name = btrim(name)),
  phone text check (phone ~ '^\+9647[3-9][0-9]{8}$'),
  note text check (char_length(note) between 1 and 300 and note = btrim(note)),
  -- What the partner held in the company at the books' start (below 0: they owed it).
  opening_capital_iqd integer not null default 0 check (opening_capital_iqd between -1000000000 and 1000000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.partners enable row level security;

create trigger partners_set_updated_at
before update on public.partners
for each row execute function private.set_updated_at();

revoke all on public.partners from anon, authenticated;
grant select on public.partners to authenticated;

create policy "Admins read the partners"
on public.partners
for select
to authenticated
using ((select private.is_admin()));

-- partner_shares -------------------------------------------------------------------------

create table public.partner_shares (
  id bigint generated always as identity primary key,
  -- The month's first day: the share holds from then until the next month with shares.
  starts_on date not null check (starts_on = date_trunc('month', starts_on)::date),
  partner_id uuid not null references public.partners (id) on delete restrict,
  -- Hundredths of a percent: 10000 is all of it.
  share_bp integer not null check (share_bp between 1 and 10000),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.partner_shares enable row level security;

create unique index partner_shares_starts_on_partner_id_key on public.partner_shares (starts_on, partner_id);
create index partner_shares_partner_id_idx on public.partner_shares (partner_id);
create index partner_shares_created_by_idx on public.partner_shares (created_by);

revoke all on public.partner_shares from anon, authenticated;
revoke all on sequence public.partner_shares_id_seq from anon, authenticated;
grant select on public.partner_shares to authenticated;

create policy "Admins read the partner shares"
on public.partner_shares
for select
to authenticated
using ((select private.is_admin()));

create trigger partner_shares_refuse_closed
before insert or update or delete on public.partner_shares
for each row execute function private.finance_refuse_closed('starts_on');

-- partner_movements ----------------------------------------------------------------------

create table public.partner_movements (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  moved_on date not null,
  kind public.partner_movement_kind not null,
  -- The box the capital went into, or the withdrawal came out of.
  account_id uuid not null references public.finance_accounts (id) on delete restrict,
  amount_iqd integer not null check (amount_iqd between 1 and 1000000000),
  note text check (char_length(note) between 1 and 300 and note = btrim(note)),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text check (char_length(void_reason) between 1 and 300 and void_reason = btrim(void_reason)),
  constraint partner_movements_void_check check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

alter table public.partner_movements enable row level security;

create index partner_movements_partner_id_idx on public.partner_movements (partner_id);
create index partner_movements_moved_on_idx on public.partner_movements (moved_on);
create index partner_movements_account_id_idx on public.partner_movements (account_id);
create index partner_movements_created_by_idx on public.partner_movements (created_by);
create index partner_movements_voided_by_idx on public.partner_movements (voided_by);

create trigger partner_movements_set_updated_at
before update on public.partner_movements
for each row execute function private.set_updated_at();

create trigger partner_movements_refuse_closed
before insert or update or delete on public.partner_movements
for each row execute function private.finance_refuse_closed('moved_on');

revoke all on public.partner_movements from anon, authenticated;
grant select on public.partner_movements to authenticated;

create policy "Admins read the partner movements"
on public.partner_movements
for select
to authenticated
using ((select private.is_admin()));

-- expenses.useful_life_months ------------------------------------------------------------

-- Months a purchase in an equipment category is spread over; null: a whole expense.
alter table public.expenses
  add column useful_life_months smallint check (useful_life_months between 1 and 240);

-- opening_equipment ----------------------------------------------------------------------

create table public.opening_equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60 and name = btrim(name)),
  -- Its value at the books' start, spread from the start day's month.
  value_iqd integer not null check (value_iqd between 1 and 1000000000),
  months_left smallint not null check (months_left between 1 and 240),
  note text check (char_length(note) between 1 and 300 and note = btrim(note)),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text check (char_length(void_reason) between 1 and 300 and void_reason = btrim(void_reason)),
  constraint opening_equipment_void_check check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

alter table public.opening_equipment enable row level security;

create index opening_equipment_created_by_idx on public.opening_equipment (created_by);
create index opening_equipment_voided_by_idx on public.opening_equipment (voided_by);

create trigger opening_equipment_set_updated_at
before update on public.opening_equipment
for each row execute function private.set_updated_at();

revoke all on public.opening_equipment from anon, authenticated;
grant select on public.opening_equipment to authenticated;

create policy "Admins read the opening equipment"
on public.opening_equipment
for select
to authenticated
using ((select private.is_admin()));

-- equipment_disposals --------------------------------------------------------------------

create table public.equipment_disposals (
  id uuid primary key default gen_random_uuid(),
  -- Exactly one: a spread purchase or opening equipment.
  expense_id uuid references public.expenses (id) on delete restrict,
  opening_equipment_id uuid references public.opening_equipment (id) on delete restrict,
  disposed_on date not null,
  -- A sale price and the box it went into, or neither (a write-off).
  account_id uuid references public.finance_accounts (id) on delete restrict,
  proceeds_iqd integer not null default 0 check (proceeds_iqd between 0 and 1000000000),
  note text check (char_length(note) between 1 and 300 and note = btrim(note)),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text check (char_length(void_reason) between 1 and 300 and void_reason = btrim(void_reason)),
  constraint equipment_disposals_item_check check (num_nonnulls(expense_id, opening_equipment_id) = 1),
  constraint equipment_disposals_proceeds_check check ((proceeds_iqd = 0) = (account_id is null)),
  constraint equipment_disposals_void_check check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

alter table public.equipment_disposals enable row level security;

create unique index equipment_disposals_expense_id_key
on public.equipment_disposals (expense_id) where voided_at is null;
create unique index equipment_disposals_opening_equipment_id_key
on public.equipment_disposals (opening_equipment_id) where voided_at is null;
create index equipment_disposals_expense_id_idx on public.equipment_disposals (expense_id);
create index equipment_disposals_opening_equipment_id_idx on public.equipment_disposals (opening_equipment_id);
create index equipment_disposals_disposed_on_idx on public.equipment_disposals (disposed_on);
create index equipment_disposals_account_id_idx on public.equipment_disposals (account_id);
create index equipment_disposals_created_by_idx on public.equipment_disposals (created_by);
create index equipment_disposals_voided_by_idx on public.equipment_disposals (voided_by);

create trigger equipment_disposals_set_updated_at
before update on public.equipment_disposals
for each row execute function private.set_updated_at();

create trigger equipment_disposals_refuse_closed
before insert or update or delete on public.equipment_disposals
for each row execute function private.finance_refuse_closed('disposed_on');

revoke all on public.equipment_disposals from anon, authenticated;
grant select on public.equipment_disposals to authenticated;

create policy "Admins read the equipment disposals"
on public.equipment_disposals
for select
to authenticated
using ((select private.is_admin()));

-- finance_account_balances: with partner money and sale prices ---------------------------

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
    ), 0)
    + coalesce((
      select sum(case when m.kind = 'capital' then m.amount_iqd else -m.amount_iqd end)
      from public.partner_movements as m
      where m.account_id = a.id and m.voided_at is null
    ), 0)
    + coalesce((
      select sum(d.proceeds_iqd) from public.equipment_disposals as d
      where d.account_id = a.id and d.voided_at is null
    ), 0) as balance_iqd
from public.finance_accounts as a;

-- finance_equipment and finance_depreciation ---------------------------------------------

-- Every live spread item: a purchase with a life, or opening equipment (from
-- the start day), with its live disposal.
create view public.finance_equipment
with (security_invoker = true)
as
select
  i.kind,
  i.item_id,
  i.expense_id,
  i.opening_equipment_id,
  i.name,
  i.category_id,
  i.acquired_on,
  date_trunc('month', i.acquired_on)::date as starts_month,
  i.cost_iqd,
  i.life_months,
  d.id as disposal_id,
  d.disposed_on,
  coalesce(d.proceeds_iqd, 0) as proceeds_iqd,
  d.account_id as disposal_account_id
from (
  select
    'purchase'::text as kind,
    e.id as item_id,
    e.id as expense_id,
    null::uuid as opening_equipment_id,
    coalesce(e.note, c.name) as name,
    e.category_id,
    e.spent_on as acquired_on,
    e.amount_iqd as cost_iqd,
    e.useful_life_months::integer as life_months
  from public.expenses as e
  join public.expense_categories as c on c.id = e.category_id
  where e.voided_at is null and e.useful_life_months is not null
  union all
  select
    'opening'::text,
    o.id,
    null::uuid,
    o.id,
    o.name,
    null::bigint,
    s.start_on,
    o.value_iqd,
    o.months_left::integer
  from public.opening_equipment as o
  cross join public.finance_settings as s
  where o.voided_at is null and s.id
) as i
left join public.equipment_disposals as d
  on d.voided_at is null
  and (d.expense_id = i.expense_id or d.opening_equipment_id = i.opening_equipment_id)
where (select private.is_admin());

revoke all on public.finance_equipment from anon, authenticated;
grant select on public.finance_equipment to authenticated;

-- Each item's depreciation by month: cost ÷ life rounded down, the last month
-- the rest; none from the disposal month on.
create view public.finance_depreciation
with (security_invoker = true)
as
select
  q.item_id,
  (q.starts_month + make_interval(months => k.n))::date as month,
  (
    case
      when k.n = q.life_months - 1 then q.cost_iqd - (q.cost_iqd / q.life_months) * (q.life_months - 1)
      else q.cost_iqd / q.life_months
    end
  )::bigint as amount_iqd
from public.finance_equipment as q
cross join lateral generate_series(0, q.life_months - 1) as k (n)
where q.disposed_on is null
  or (q.starts_month + make_interval(months => k.n))::date < date_trunc('month', q.disposed_on)::date;

revoke all on public.finance_depreciation from anon, authenticated;
grant select on public.finance_depreciation to authenticated;

-- Partners -------------------------------------------------------------------------------

-- p_id null: a new partner. The name is required on every save.
create function public.admin_save_partner(
  p_id uuid default null,
  p_name text default null,
  p_phone text default null,
  p_note text default null,
  p_opening_capital_iqd integer default null,
  p_active boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.partners;
  v_phone text := nullif(btrim(p_phone), '');
  v_note text;
  v_opening integer;
  v_active boolean;
  v_closed date;
  v_id uuid;
  v_new jsonb;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_name is null or char_length(p_name) not between 2 and 60 or p_name <> btrim(p_name) then
    raise exception using errcode = '22023', message = 'invalid_name';
  end if;
  if v_phone !~ '^\+9647[3-9][0-9]{8}$' then
    raise exception using errcode = '22023', message = 'invalid_phone';
  end if;
  v_note := private.finance_note(p_note);
  if p_opening_capital_iqd not between -1000000000 and 1000000000 then
    raise exception using errcode = '22023', message = 'invalid_amount';
  end if;

  -- The settings row first (share), then the partner.
  select s.closed_through into v_closed from public.finance_settings as s where s.id for share;
  if p_id is not null then
    select * into v_old from public.partners as p where p.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'partner_not_found';
    end if;
  end if;
  v_opening := coalesce(p_opening_capital_iqd, v_old.opening_capital_iqd, 0);
  v_active := coalesce(p_active, v_old.active, true);

  -- The opening capital holds while a month is closed, like every opening balance.
  if v_opening <> coalesce(v_old.opening_capital_iqd, 0) and v_closed is not null then
    raise exception using errcode = 'ZL056', message = 'books_closed';
  end if;

  if exists (select 1 from public.partners as p where p.name = p_name and p.id is distinct from p_id) then
    raise exception using errcode = 'ZL048', message = 'name_taken';
  end if;

  -- A switched-off partner takes no share: not while they hold one in the
  -- set in force this month or in a later one (code review). Set new shares first.
  if coalesce(v_old.active, false) and not v_active and exists (
    select 1 from public.partner_shares as s
    where s.partner_id = p_id
      and s.starts_on >= coalesce((
        select max(x.starts_on) from public.partner_shares as x
        where x.starts_on <= date_trunc('month', private.baghdad_today())::date
      ), '-infinity'::date)
  ) then
    raise exception using errcode = 'ZL063', message = 'partner_has_share';
  end if;

  v_new := jsonb_build_object(
    'name', p_name, 'phone', v_phone, 'note', v_note, 'opening_capital_iqd', v_opening, 'active', v_active
  );
  begin
    if p_id is null then
      insert into public.partners (name, phone, note, opening_capital_iqd, active)
      values (p_name, v_phone, v_note, v_opening, v_active)
      returning id into v_id;
      perform private.log_admin_action('partner.create', 'partners', v_id::text, v_new);
      return v_id;
    end if;

    v_diff := private.audit_changes(
      jsonb_build_object(
        'name', v_old.name, 'phone', v_old.phone, 'note', v_old.note,
        'opening_capital_iqd', v_old.opening_capital_iqd, 'active', v_old.active
      ),
      v_new
    );
    if v_diff <> '{}' then
      update public.partners as p
      set name = p_name, phone = v_phone, note = v_note, opening_capital_iqd = v_opening, active = v_active
      where p.id = p_id;
      perform private.log_admin_action('partner.update', 'partners', p_id::text, v_diff);
    end if;
  exception when unique_violation then
    raise exception using errcode = 'ZL048', message = 'name_taken';
  end;
  return p_id;
end;
$$;

-- The month's shares become exactly p_shares, {partner_id: share_bp}; {}
-- removes them, so the month before's apply.
create function public.admin_set_partner_shares(p_month date, p_shares jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_start date;
  v_entry record;
  v_partner uuid;
  v_share integer;
  v_active boolean;
  v_total integer := 0;
  v_old jsonb;
  v_new jsonb := '{}';
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if v_month is null then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  if p_shares is null or jsonb_typeof(p_shares) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_shares';
  end if;

  -- The settings row first (share), then the month's shares, then the partners.
  select s.start_on into v_start from public.finance_settings as s where s.id for share;
  if v_month > date_trunc('month', private.baghdad_today())::date then
    raise exception using errcode = 'ZL043', message = 'date_in_future';
  end if;
  if v_month < date_trunc('month', v_start)::date then
    raise exception using errcode = 'ZL042', message = 'before_finance_start';
  end if;
  -- Two saves of the same month queue rather than both replacing it.
  perform pg_advisory_xact_lock(hashtext('public.partner_shares')::bigint);

  -- jsonb_each runs in key order, so partners are locked in one order.
  for v_entry in select e.key, e.value from jsonb_each(p_shares) as e loop
    begin
      v_partner := v_entry.key::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'invalid_shares';
    end;
    if jsonb_typeof(v_entry.value) <> 'number'
      or (v_entry.value::text)::numeric <> trunc((v_entry.value::text)::numeric)
      or (v_entry.value::text)::numeric not between 1 and 10000
    then
      raise exception using errcode = '22023', message = 'invalid_shares';
    end if;
    v_share := (v_entry.value::text)::integer;
    -- One partner spelled two ways (case, braces) is one partner (RLS audit).
    if v_new ? v_partner::text then
      raise exception using errcode = '22023', message = 'invalid_shares';
    end if;
    select p.active into v_active from public.partners as p where p.id = v_partner for share;
    if not found then
      raise exception using errcode = 'P0002', message = 'partner_not_found';
    end if;
    if not v_active then
      raise exception using errcode = 'ZL044', message = 'partner_inactive';
    end if;
    v_total := v_total + v_share;
    v_new := v_new || jsonb_build_object(v_partner::text, v_share);
  end loop;
  if v_new <> '{}' and v_total <> 10000 then
    raise exception using errcode = 'ZL061', message = 'shares_total';
  end if;

  select coalesce(jsonb_object_agg(s.partner_id::text, s.share_bp), '{}') into v_old
  from public.partner_shares as s where s.starts_on = v_month;
  if v_old = v_new then
    return;
  end if;
  -- The *_refuse_closed trigger refuses a closed month (ZL054).
  delete from public.partner_shares as s where s.starts_on = v_month;
  insert into public.partner_shares (starts_on, partner_id, share_bp, created_by)
  select v_month, e.key::uuid, e.value::integer, (select auth.uid())
  from jsonb_each_text(v_new) as e;
  perform private.log_admin_action(
    'partner.shares', 'partner_shares', v_month::text,
    jsonb_build_object('shares', jsonb_build_object('from', v_old, 'to', v_new))
  );
end;
$$;

create function public.admin_save_partner_movement(
  p_id uuid default null,
  p_partner_id uuid default null,
  p_moved_on date default null,
  p_kind public.partner_movement_kind default null,
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
  v_old public.partner_movements;
  v_partner uuid;
  v_note text;
  v_id uuid;
  v_new jsonb;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_kind is null then
    raise exception using errcode = '22023', message = 'invalid_kind';
  end if;
  perform private.finance_check_amount(p_amount_iqd);
  v_note := private.finance_note(p_note);
  -- The settings row first (share lock), then the partner, then the record.
  perform private.finance_check_day(p_moved_on);

  if p_id is not null then
    select m.partner_id into v_partner from public.partner_movements as m where m.id = p_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'movement_not_found';
    end if;
  end if;
  perform 1 from public.partners as p where p.id = p_partner_id for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'partner_not_found';
  end if;
  if p_id is not null then
    if v_partner <> p_partner_id then
      raise exception using errcode = '22023', message = 'invalid_target';
    end if;
    select * into v_old from public.partner_movements as m where m.id = p_id for update;
    if v_old.voided_at is not null then
      raise exception using errcode = 'ZL047', message = 'record_voided';
    end if;
  end if;
  perform private.finance_check_account(p_account_id, v_old.account_id is distinct from p_account_id);

  v_new := jsonb_build_object(
    'partner_id', p_partner_id, 'moved_on', p_moved_on, 'kind', p_kind,
    'account_id', p_account_id, 'amount_iqd', p_amount_iqd, 'note', v_note
  );
  if p_id is null then
    insert into public.partner_movements (partner_id, moved_on, kind, account_id, amount_iqd, note, created_by)
    values (p_partner_id, p_moved_on, p_kind, p_account_id, p_amount_iqd, v_note, (select auth.uid()))
    returning id into v_id;
    perform private.log_admin_action('partner_movement.create', 'partner_movements', v_id::text, v_new);
    return v_id;
  end if;

  v_diff := private.audit_changes(
    jsonb_build_object(
      'partner_id', v_old.partner_id, 'moved_on', v_old.moved_on, 'kind', v_old.kind,
      'account_id', v_old.account_id, 'amount_iqd', v_old.amount_iqd, 'note', v_old.note
    ),
    v_new
  );
  if v_diff <> '{}' then
    update public.partner_movements as m
    set moved_on = p_moved_on, kind = p_kind, account_id = p_account_id, amount_iqd = p_amount_iqd, note = v_note
    where m.id = p_id;
    -- The partner too, so the audit log names and links it (code review).
    perform private.log_admin_action(
      'partner_movement.update', 'partner_movements', p_id::text,
      v_diff || jsonb_build_object('partner_id', v_old.partner_id)
    );
  end if;
  return p_id;
end;
$$;

create function public.admin_void_partner_movement(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.partner_movements;
  v_reason text;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_reason := private.void_reason(p_reason);

  perform 1 from public.finance_settings as s where s.id for share;
  select * into v_old from public.partner_movements as m where m.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'movement_not_found';
  end if;
  if v_old.voided_at is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;

  update public.partner_movements as m
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where m.id = p_id;
  perform private.log_admin_action(
    'partner_movement.void', 'partner_movements', p_id::text,
    jsonb_build_object(
      'partner_id', v_old.partner_id, 'moved_on', v_old.moved_on, 'kind', v_old.kind,
      'amount_iqd', v_old.amount_iqd, 'reason', v_reason
    )
  );
end;
$$;

-- Equipment ------------------------------------------------------------------------------

create function public.admin_save_opening_equipment(
  p_id uuid default null,
  p_name text default null,
  p_value_iqd integer default null,
  p_months_left integer default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.opening_equipment;
  v_note text;
  v_closed date;
  v_id uuid;
  v_new jsonb;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_name is null or char_length(p_name) not between 2 and 60 or p_name <> btrim(p_name) then
    raise exception using errcode = '22023', message = 'invalid_name';
  end if;
  perform private.finance_check_amount(p_value_iqd);
  if p_months_left is null or p_months_left not between 1 and 240 then
    raise exception using errcode = '22023', message = 'invalid_life';
  end if;
  v_note := private.finance_note(p_note);

  -- At the books' start: only while no month is closed, like every opening balance.
  select s.closed_through into v_closed from public.finance_settings as s where s.id for share;
  if v_closed is not null then
    raise exception using errcode = 'ZL056', message = 'books_closed';
  end if;
  if p_id is not null then
    select * into v_old from public.opening_equipment as o where o.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'equipment_not_found';
    end if;
    if v_old.voided_at is not null then
      raise exception using errcode = 'ZL047', message = 'record_voided';
    end if;
    if exists (
      select 1 from public.equipment_disposals as d where d.opening_equipment_id = p_id and d.voided_at is null
    ) then
      raise exception using errcode = 'ZL062', message = 'equipment_disposed';
    end if;
  end if;

  v_new := jsonb_build_object('name', p_name, 'value_iqd', p_value_iqd, 'months_left', p_months_left, 'note', v_note);
  if p_id is null then
    insert into public.opening_equipment (name, value_iqd, months_left, note, created_by)
    values (p_name, p_value_iqd, p_months_left, v_note, (select auth.uid()))
    returning id into v_id;
    perform private.log_admin_action('opening_equipment.create', 'opening_equipment', v_id::text, v_new);
    return v_id;
  end if;

  v_diff := private.audit_changes(
    jsonb_build_object(
      'name', v_old.name, 'value_iqd', v_old.value_iqd, 'months_left', v_old.months_left, 'note', v_old.note
    ),
    v_new
  );
  if v_diff <> '{}' then
    update public.opening_equipment as o
    set name = p_name, value_iqd = p_value_iqd, months_left = p_months_left, note = v_note
    where o.id = p_id;
    perform private.log_admin_action('opening_equipment.update', 'opening_equipment', p_id::text, v_diff);
  end if;
  return p_id;
end;
$$;

create function public.admin_void_opening_equipment(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.opening_equipment;
  v_reason text;
  v_closed date;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_reason := private.void_reason(p_reason);

  select s.closed_through into v_closed from public.finance_settings as s where s.id for share;
  if v_closed is not null then
    raise exception using errcode = 'ZL056', message = 'books_closed';
  end if;
  select * into v_old from public.opening_equipment as o where o.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'equipment_not_found';
  end if;
  if v_old.voided_at is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;
  if exists (
    select 1 from public.equipment_disposals as d where d.opening_equipment_id = p_id and d.voided_at is null
  ) then
    raise exception using errcode = 'ZL062', message = 'equipment_disposed';
  end if;

  update public.opening_equipment as o
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where o.id = p_id;
  perform private.log_admin_action(
    'opening_equipment.void', 'opening_equipment', p_id::text,
    jsonb_build_object('name', v_old.name, 'value_iqd', v_old.value_iqd, 'reason', v_reason)
  );
end;
$$;

-- A new disposal names one item; an edit keeps its item (both null keeps it).
create function public.admin_save_equipment_disposal(
  p_id uuid default null,
  p_expense_id uuid default null,
  p_opening_equipment_id uuid default null,
  p_disposed_on date default null,
  p_account_id uuid default null,
  p_proceeds_iqd integer default 0,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.equipment_disposals;
  v_expense_id uuid := p_expense_id;
  v_opening_id uuid := p_opening_equipment_id;
  v_proceeds integer := coalesce(p_proceeds_iqd, 0);
  v_note text;
  v_item_on date;
  v_life smallint;
  v_voided timestamptz;
  v_id uuid;
  v_new jsonb;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_id is null and num_nonnulls(p_expense_id, p_opening_equipment_id) <> 1 then
    raise exception using errcode = '22023', message = 'invalid_target';
  end if;
  if v_proceeds not between 0 and 1000000000 then
    raise exception using errcode = '22023', message = 'invalid_amount';
  end if;
  if (v_proceeds > 0) <> (p_account_id is not null) then
    raise exception using errcode = '22023', message = 'invalid_payment';
  end if;
  v_note := private.finance_note(p_note);
  -- The settings row first (share lock), then the item, then the record.
  perform private.finance_check_day(p_disposed_on);

  if p_id is not null then
    select d.expense_id, d.opening_equipment_id into v_expense_id, v_opening_id
    from public.equipment_disposals as d where d.id = p_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'disposal_not_found';
    end if;
    if (p_expense_id is not null and p_expense_id is distinct from v_expense_id)
      or (p_opening_equipment_id is not null and p_opening_equipment_id is distinct from v_opening_id)
    then
      raise exception using errcode = '22023', message = 'invalid_target';
    end if;
  end if;

  if v_expense_id is not null then
    select e.spent_on, e.useful_life_months, e.voided_at into v_item_on, v_life, v_voided
    from public.expenses as e where e.id = v_expense_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'expense_not_found';
    end if;
    -- Only a spread purchase is equipment.
    if v_life is null then
      raise exception using errcode = '22023', message = 'invalid_target';
    end if;
  else
    select o.voided_at into v_voided from public.opening_equipment as o where o.id = v_opening_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'equipment_not_found';
    end if;
    select s.start_on into v_item_on from public.finance_settings as s where s.id;
  end if;
  if v_voided is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;

  if p_id is not null then
    select * into v_old from public.equipment_disposals as d where d.id = p_id for update;
    if v_old.voided_at is not null then
      raise exception using errcode = 'ZL047', message = 'record_voided';
    end if;
  end if;
  if exists (
    select 1 from public.equipment_disposals as d
    where d.voided_at is null
      and d.id is distinct from p_id
      and (d.expense_id = v_expense_id or d.opening_equipment_id = v_opening_id)
  ) then
    raise exception using errcode = 'ZL062', message = 'equipment_disposed';
  end if;
  if p_disposed_on < v_item_on then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  if p_account_id is not null then
    perform private.finance_check_account(p_account_id, v_old.account_id is distinct from p_account_id);
  end if;

  v_new := jsonb_build_object(
    'expense_id', v_expense_id, 'opening_equipment_id', v_opening_id, 'disposed_on', p_disposed_on,
    'account_id', p_account_id, 'proceeds_iqd', v_proceeds, 'note', v_note
  );
  if p_id is null then
    insert into public.equipment_disposals (
      expense_id, opening_equipment_id, disposed_on, account_id, proceeds_iqd, note, created_by
    )
    values (v_expense_id, v_opening_id, p_disposed_on, p_account_id, v_proceeds, v_note, (select auth.uid()))
    returning id into v_id;
    perform private.log_admin_action('equipment_disposal.create', 'equipment_disposals', v_id::text, v_new);
    return v_id;
  end if;

  v_diff := private.audit_changes(
    jsonb_build_object(
      'expense_id', v_old.expense_id, 'opening_equipment_id', v_old.opening_equipment_id,
      'disposed_on', v_old.disposed_on, 'account_id', v_old.account_id,
      'proceeds_iqd', v_old.proceeds_iqd, 'note', v_old.note
    ),
    v_new
  );
  if v_diff <> '{}' then
    update public.equipment_disposals as d
    set disposed_on = p_disposed_on, account_id = p_account_id, proceeds_iqd = v_proceeds, note = v_note
    where d.id = p_id;
    perform private.log_admin_action(
      'equipment_disposal.update', 'equipment_disposals', p_id::text,
      v_diff || jsonb_build_object('expense_id', v_old.expense_id, 'opening_equipment_id', v_old.opening_equipment_id)
    );
  end if;
  return p_id;
end;
$$;

create function public.admin_void_equipment_disposal(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.equipment_disposals;
  v_reason text;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_reason := private.void_reason(p_reason);

  perform 1 from public.finance_settings as s where s.id for share;
  select * into v_old from public.equipment_disposals as d where d.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'disposal_not_found';
  end if;
  if v_old.voided_at is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;

  update public.equipment_disposals as d
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where d.id = p_id;
  perform private.log_admin_action(
    'equipment_disposal.void', 'equipment_disposals', p_id::text,
    jsonb_build_object(
      'expense_id', v_old.expense_id, 'opening_equipment_id', v_old.opening_equipment_id,
      'disposed_on', v_old.disposed_on, 'proceeds_iqd', v_old.proceeds_iqd, 'reason', v_reason
    )
  );
end;
$$;

-- Expenses: the life, and disposed purchases hold ------------------------------------------

drop function public.admin_save_expense(uuid, date, bigint, uuid, integer, text, uuid);

create function public.admin_save_expense(
  p_id uuid default null,
  p_spent_on date default null,
  p_category_id bigint default null,
  p_account_id uuid default null,
  p_amount_iqd integer default null,
  p_note text default null,
  p_worker_id uuid default null,
  p_useful_life_months integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.expenses;
  v_note text;
  v_kind public.expense_category_kind;
  v_old_kind public.expense_category_kind;
  v_id uuid;
  v_new jsonb;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  perform private.finance_check_amount(p_amount_iqd);
  v_note := private.finance_note(p_note);
  if p_useful_life_months is not null and p_useful_life_months not between 1 and 240 then
    raise exception using errcode = '22023', message = 'invalid_life';
  end if;
  perform private.finance_check_day(p_spent_on);

  if p_id is not null then
    select * into v_old from public.expenses as e where e.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'expense_not_found';
    end if;
    if v_old.voided_at is not null then
      raise exception using errcode = 'ZL047', message = 'record_voided';
    end if;
    -- A disposed purchase holds: its write-off counts what was left of it.
    if exists (select 1 from public.equipment_disposals as d where d.expense_id = p_id and d.voided_at is null) then
      raise exception using errcode = 'ZL062', message = 'equipment_disposed';
    end if;
  end if;
  perform private.finance_check_category(p_category_id, v_old.category_id is distinct from p_category_id);
  perform private.finance_check_account(p_account_id, v_old.account_id is distinct from p_account_id);
  -- The category is share-locked above, so its kind can't change meanwhile.
  select c.kind into v_kind from public.expense_categories as c where c.id = p_category_id;
  if p_worker_id is not null then
    if v_kind <> 'wages' then
      raise exception using errcode = 'ZL057', message = 'worker_not_allowed';
    end if;
    -- A switched-off worker is still paid what they're owed (code review): only
    -- that the worker exists is checked.
    perform private.payroll_check_worker(p_worker_id, false);
  end if;
  -- A spread purchase stays spread, so its category stays an equipment one
  -- (RLS audit); a wrong one is voided and entered again.
  if p_useful_life_months is null and v_old.useful_life_months is not null then
    raise exception using errcode = '22023', message = 'invalid_life';
  end if;
  if p_useful_life_months is not null and v_kind <> 'equipment' then
    raise exception using errcode = 'ZL060', message = 'life_not_allowed';
  end if;
  -- A new purchase in an equipment category, or one moved into one, is spread;
  -- one saved before lifes existed may stay whole.
  if p_useful_life_months is null and v_kind = 'equipment' then
    if v_old.id is not null then
      select c.kind into v_old_kind from public.expense_categories as c where c.id = v_old.category_id;
    end if;
    if v_old.id is null or v_old_kind <> 'equipment' then
      raise exception using errcode = '22023', message = 'invalid_life';
    end if;
  end if;

  v_new := jsonb_build_object(
    'spent_on', p_spent_on, 'category_id', p_category_id, 'account_id', p_account_id,
    'amount_iqd', p_amount_iqd, 'note', v_note
  );

  if p_id is null then
    insert into public.expenses (
      spent_on, category_id, account_id, amount_iqd, note, worker_id, useful_life_months, created_by
    )
    values (
      p_spent_on, p_category_id, p_account_id, p_amount_iqd, v_note, p_worker_id, p_useful_life_months,
      (select auth.uid())
    )
    returning id into v_id;
    perform private.log_admin_action(
      'expense.create', 'expenses', v_id::text,
      v_new
        || case when p_worker_id is not null then jsonb_build_object('worker_id', p_worker_id) else '{}' end
        || case
          when p_useful_life_months is not null then jsonb_build_object('useful_life_months', p_useful_life_months)
          else '{}'
        end
    );
    return v_id;
  end if;

  v_diff := private.audit_changes(
    jsonb_build_object(
      'spent_on', v_old.spent_on, 'category_id', v_old.category_id, 'account_id', v_old.account_id,
      'amount_iqd', v_old.amount_iqd, 'note', v_old.note, 'worker_id', v_old.worker_id,
      'useful_life_months', v_old.useful_life_months
    ),
    v_new || jsonb_build_object('worker_id', p_worker_id, 'useful_life_months', p_useful_life_months)
  );
  if v_diff <> '{}' then
    update public.expenses as e
    set spent_on = p_spent_on, category_id = p_category_id, account_id = p_account_id,
      amount_iqd = p_amount_iqd, note = v_note, worker_id = p_worker_id,
      useful_life_months = p_useful_life_months
    where e.id = p_id;
    perform private.log_admin_action('expense.update', 'expenses', p_id::text, v_diff);
  end if;
  return p_id;
end;
$$;

create or replace function public.admin_void_expense(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.expenses;
  v_reason text;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_reason := private.void_reason(p_reason);

  select * into v_old from public.expenses as e where e.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'expense_not_found';
  end if;
  if v_old.voided_at is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;
  if exists (select 1 from public.equipment_disposals as d where d.expense_id = p_id and d.voided_at is null) then
    raise exception using errcode = 'ZL062', message = 'equipment_disposed';
  end if;

  update public.expenses as e
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where e.id = p_id;
  perform private.log_admin_action(
    'expense.void', 'expenses', p_id::text,
    jsonb_build_object('spent_on', v_old.spent_on, 'amount_iqd', v_old.amount_iqd, 'reason', v_reason)
  );
end;
$$;

create or replace function public.admin_save_expense_category(
  p_id bigint default null,
  p_name text default null,
  p_kind public.expense_category_kind default null,
  p_active boolean default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.expense_categories;
  v_new public.expense_categories;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if (p_id is null and p_name is null)
    or (p_name is not null and (char_length(p_name) not between 2 and 40 or p_name <> btrim(p_name)))
  then
    raise exception using errcode = '22023', message = 'invalid_name';
  end if;
  if exists (
    select 1 from public.expense_categories as c where c.name = p_name and c.id is distinct from p_id
  ) then
    raise exception using errcode = 'ZL048', message = 'name_taken';
  end if;

  begin
    if p_id is null then
      insert into public.expense_categories (name, kind, active)
      values (p_name, coalesce(p_kind, 'general'), coalesce(p_active, true))
      returning * into v_new;
      perform private.log_admin_action(
        'expense_category.create', 'expense_categories', v_new.id::text,
        jsonb_build_object('name', v_new.name, 'kind', v_new.kind, 'active', v_new.active)
      );
      return v_new.id;
    end if;

    select * into v_old from public.expense_categories as c where c.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'category_not_found';
    end if;
    -- Expenses being saved share-lock the category, so none links a worker meanwhile.
    if v_old.kind = 'wages' and coalesce(p_kind, v_old.kind) <> 'wages' and exists (
      select 1 from public.expenses as e
      where e.category_id = p_id and e.worker_id is not null and e.voided_at is null
    ) then
      raise exception using errcode = 'ZL057', message = 'worker_not_allowed';
    end if;
    -- Nor is a purchase spread meanwhile: a category with spread purchases stays equipment.
    if v_old.kind = 'equipment' and coalesce(p_kind, v_old.kind) <> 'equipment' and exists (
      select 1 from public.expenses as e
      where e.category_id = p_id and e.useful_life_months is not null and e.voided_at is null
    ) then
      raise exception using errcode = 'ZL060', message = 'life_not_allowed';
    end if;
    v_diff := private.audit_changes(
      jsonb_build_object('name', v_old.name, 'kind', v_old.kind, 'active', v_old.active),
      jsonb_build_object(
        'name', coalesce(p_name, v_old.name), 'kind', coalesce(p_kind, v_old.kind),
        'active', coalesce(p_active, v_old.active)
      )
    );
    if v_diff <> '{}' then
      update public.expense_categories as c
      set name = coalesce(p_name, v_old.name),
        kind = coalesce(p_kind, v_old.kind),
        active = coalesce(p_active, v_old.active)
      where c.id = p_id;
      perform private.log_admin_action('expense_category.update', 'expense_categories', p_id::text, v_diff);
    end if;
  exception when unique_violation then
    raise exception using errcode = 'ZL048', message = 'name_taken';
  end;
  return p_id;
end;
$$;

-- Boxes: the opening balance holds while a month is closed ---------------------------------

create or replace function public.admin_save_finance_account(
  p_id uuid default null,
  p_kind public.finance_account_kind default null,
  p_name text default null,
  p_opening_balance_iqd integer default null,
  p_active boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.finance_accounts;
  v_new public.finance_accounts;
  v_closed date;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_name is not null and (char_length(p_name) not between 2 and 40 or p_name <> btrim(p_name)) then
    raise exception using errcode = '22023', message = 'invalid_name';
  end if;
  if p_opening_balance_iqd is not null
    and p_opening_balance_iqd not between -1000000000 and 1000000000
  then
    raise exception using errcode = '22023', message = 'invalid_amount';
  end if;

  -- The settings row first (share), then the box.
  select s.closed_through into v_closed from public.finance_settings as s where s.id for share;
  if p_id is not null then
    select * into v_old from public.finance_accounts as a where a.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'finance_account_not_found';
    end if;
  end if;

  if p_id is null then
    if p_kind is null or p_kind = 'crew' then
      raise exception using errcode = '22023', message = 'invalid_kind';
    end if;
    if p_name is null then
      raise exception using errcode = '22023', message = 'invalid_name';
    end if;
  else
    if p_kind is not null and p_kind <> v_old.kind and (p_kind = 'crew' or v_old.kind = 'crew') then
      raise exception using errcode = '22023', message = 'invalid_kind';
    end if;
    if v_old.kind = 'crew' and p_name is not null then
      raise exception using errcode = '22023', message = 'invalid_name';
    end if;
  end if;

  -- The balance sheet shows a box at a past month's end, so its opening
  -- balance holds while a month is closed (spec §13).
  if coalesce(p_opening_balance_iqd, v_old.opening_balance_iqd, 0) <> coalesce(v_old.opening_balance_iqd, 0)
    and v_closed is not null
  then
    raise exception using errcode = 'ZL056', message = 'books_closed';
  end if;

  if exists (
    select 1 from public.finance_accounts as a where a.name = p_name and a.id is distinct from p_id
  ) then
    raise exception using errcode = 'ZL048', message = 'name_taken';
  end if;

  begin
    if p_id is null then
      insert into public.finance_accounts (kind, name, opening_balance_iqd, active)
      values (p_kind, p_name, coalesce(p_opening_balance_iqd, 0), coalesce(p_active, true))
      returning * into v_new;
      perform private.log_admin_action(
        'finance_account.create', 'finance_accounts', v_new.id::text,
        jsonb_build_object(
          'kind', v_new.kind, 'name', v_new.name,
          'opening_balance_iqd', v_new.opening_balance_iqd, 'active', v_new.active
        )
      );
      return v_new.id;
    end if;

    v_diff := private.audit_changes(
      jsonb_build_object(
        'kind', v_old.kind, 'name', v_old.name,
        'opening_balance_iqd', v_old.opening_balance_iqd, 'active', v_old.active
      ),
      jsonb_build_object(
        'kind', coalesce(p_kind, v_old.kind), 'name', coalesce(p_name, v_old.name),
        'opening_balance_iqd', coalesce(p_opening_balance_iqd, v_old.opening_balance_iqd),
        'active', coalesce(p_active, v_old.active)
      )
    );
    if v_diff <> '{}' then
      update public.finance_accounts as a
      set kind = coalesce(p_kind, v_old.kind),
        name = coalesce(p_name, v_old.name),
        opening_balance_iqd = coalesce(p_opening_balance_iqd, v_old.opening_balance_iqd),
        active = coalesce(p_active, v_old.active)
      where a.id = p_id;
      perform private.log_admin_action('finance_account.update', 'finance_accounts', p_id::text, v_diff);
    end if;
  exception when unique_violation then
    raise exception using errcode = 'ZL048', message = 'name_taken';
  end;
  return p_id;
end;
$$;

-- The start day: also past partner money, disposals and shares -------------------------------

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
  ) or exists (
    select 1 from public.payroll_adjustments as a where a.voided_at is null and a.adjusted_on < p_start_on
  ) or exists (
    select 1 from public.worker_days as d where d.worked_on < p_start_on
  ) or exists (
    select 1 from public.partner_movements as m where m.voided_at is null and m.moved_on < p_start_on
  ) or exists (
    select 1 from public.equipment_disposals as d where d.voided_at is null and d.disposed_on < p_start_on
  ) or exists (
    select 1 from public.partner_shares as s where s.starts_on < date_trunc('month', p_start_on)::date
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

-- Reads ----------------------------------------------------------------------------------

-- Each item acquired by the month's end (or today) and not disposed of before
-- the month: its depreciation that month and so far, the value left, and once
-- disposed of by then, the disposal and its result.
create function public.admin_equipment(p_month date)
returns table (
  kind text,
  item_id uuid,
  expense_id uuid,
  opening_equipment_id uuid,
  name text,
  category_id bigint,
  acquired_on date,
  cost_iqd bigint,
  life_months integer,
  starts_month date,
  monthly_iqd bigint,
  depreciated_iqd bigint,
  book_value_iqd bigint,
  disposal_id uuid,
  disposed_on date,
  disposal_account_id uuid,
  proceeds_iqd bigint,
  result_iqd bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_month date := date_trunc('month', p_month)::date;
  v_as_of date;
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if v_month is null or v_month > date_trunc('month', v_today)::date then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  v_as_of := least((v_month + interval '1 month' - interval '1 day')::date, v_today);

  return query
  select
    q.kind,
    q.item_id,
    q.expense_id,
    q.opening_equipment_id,
    q.name,
    q.category_id,
    q.acquired_on,
    q.cost_iqd::bigint,
    q.life_months,
    q.starts_month,
    coalesce((
      select d.amount_iqd from public.finance_depreciation as d
      where d.item_id = q.item_id and d.month = v_month
    ), 0)::bigint,
    so_far.total,
    case when q.disposed_on <= v_as_of then 0 else q.cost_iqd - so_far.total end::bigint,
    case when q.disposed_on <= v_as_of then q.disposal_id end,
    case when q.disposed_on <= v_as_of then q.disposed_on end,
    case when q.disposed_on <= v_as_of then q.disposal_account_id end,
    case when q.disposed_on <= v_as_of then q.proceeds_iqd end::bigint,
    case when q.disposed_on <= v_as_of then q.proceeds_iqd - (q.cost_iqd - so_far.total) end::bigint
  from public.finance_equipment as q
  cross join lateral (
    select coalesce(sum(d.amount_iqd), 0)::bigint as total
    from public.finance_depreciation as d
    where d.item_id = q.item_id and d.month <= v_month
  ) as so_far
  where q.acquired_on <= v_as_of
    and (q.disposed_on is null or q.disposed_on >= v_month)
  order by q.acquired_on, q.name;
end;
$$;

-- The profit and loss gains accrued wages, depreciation and disposals (spec
-- §8.3 A20). Its return type changes, so it is made again.
drop function public.admin_profit_and_loss(date, date);

create function public.admin_profit_and_loss(p_from date, p_to date)
returns table (
  month date,
  orders_iqd bigint,
  subscriptions_iqd bigint,
  sales_iqd bigint,
  discounts_iqd bigint,
  revenue_iqd bigint,
  -- Expenses the profit counts as paid: neither a spread purchase nor a wage to a worker.
  spent_iqd bigint,
  -- What the workers earned (admin_payroll).
  wages_iqd bigint,
  depreciation_iqd bigint,
  -- spent + wages + depreciation.
  expenses_iqd bigint,
  -- Disposals: sale prices less what was left (below 0, a loss).
  equipment_result_iqd bigint,
  profit_iqd bigint,
  received_iqd bigint,
  refunded_iqd bigint,
  -- Every live expense, by its day.
  paid_out_iqd bigint,
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
    select
      date_trunc('month', e.spent_on)::date as m,
      sum(e.amount_iqd) as paid_out,
      coalesce(sum(e.amount_iqd) filter (where e.worker_id is null and e.useful_life_months is null), 0) as counted
    from public.expenses as e
    where e.voided_at is null and e.spent_on >= v_first and e.spent_on < v_end
    group by 1
  ),
  wages as (
    select p.month as m, sum(p.earned_iqd) as earned
    from public.admin_payroll(v_first, v_last) as p
    group by 1
  ),
  depreciation as (
    select d.month as m, sum(d.amount_iqd) as total
    from public.finance_depreciation as d
    where d.month >= v_first and d.month < v_end
    group by 1
  ),
  disposals as (
    select
      date_trunc('month', q.disposed_on)::date as m,
      sum(
        q.proceeds_iqd - q.cost_iqd
        + coalesce((select sum(d.amount_iqd) from public.finance_depreciation as d where d.item_id = q.item_id), 0)
      ) as result
    from public.finance_equipment as q
    where q.disposed_on >= v_first and q.disposed_on < v_end
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
      coalesce(s.counted, 0) as counted,
      coalesce(w.earned, 0) as earned,
      coalesce(d.total, 0) as depreciation,
      coalesce(q.result, 0) as result,
      coalesce(s.paid_out, 0) as paid_out,
      coalesce(c.received, 0) as received,
      coalesce(c.refunded, 0) as refunded
    from months as x
    left join revenue as r on r.m = x.m
    left join spent as s on s.m = x.m
    left join wages as w on w.m = x.m
    left join depreciation as d on d.m = x.m
    left join disposals as q on q.m = x.m
    left join cash as c on c.m = x.m
  )
  select
    t.m,
    t.orders::bigint,
    t.subscriptions::bigint,
    t.sales::bigint,
    t.discounts::bigint,
    (t.orders + t.subscriptions + t.sales - t.discounts)::bigint,
    t.counted::bigint,
    t.earned::bigint,
    t.depreciation::bigint,
    (t.counted + t.earned + t.depreciation)::bigint,
    t.result::bigint,
    (t.orders + t.subscriptions + t.sales - t.discounts - t.counted - t.earned - t.depreciation + t.result)::bigint,
    t.received::bigint,
    t.refunded::bigint,
    t.paid_out::bigint,
    (t.received - t.refunded - t.paid_out)::bigint,
    coalesce(t.m <= (select f.closed_through from public.finance_settings as f where f.id), false)
  from totals as t
  order by t.m;
end;
$$;

-- Each month's live expenses by category: everything spent ("where the money
-- went", A19) and the part the profit counts (A20).
drop function public.admin_expenses_by_category(date, date);

create function public.admin_expenses_by_category(p_from date, p_to date)
returns table (month date, category_id bigint, total_iqd bigint, counted_iqd bigint)
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
  select
    date_trunc('month', e.spent_on)::date,
    e.category_id,
    sum(e.amount_iqd)::bigint,
    coalesce(sum(e.amount_iqd) filter (where e.worker_id is null and e.useful_life_months is null), 0)::bigint
  from public.expenses as e
  where e.voided_at is null
    and e.spent_on >= v_first
    and e.spent_on < (v_last + interval '1 month')::date
  group by 1, 2
  order by 1, 2;
end;
$$;

-- Each partner at the month's end (or today): opening capital, capital in,
-- withdrawals, the profit share that month and since the start, and the
-- balance. A row with no partner holds the profit of months with no shares.
create function public.admin_partner_balances(p_month date)
returns table (
  partner_id uuid,
  share_bp integer,
  opening_iqd bigint,
  capital_iqd bigint,
  withdrawn_iqd bigint,
  profit_month_iqd bigint,
  profit_iqd bigint,
  balance_iqd bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_month date := date_trunc('month', p_month)::date;
  v_start date;
  v_as_of date;
  v_from date;
  v_profits jsonb := '[]';
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if v_month is null or v_month > date_trunc('month', v_today)::date then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  select date_trunc('month', s.start_on)::date into v_start from public.finance_settings as s where s.id;
  v_as_of := least((v_month + interval '1 month' - interval '1 day')::date, v_today);

  -- Every month's profit from the books' start, 24 months at a time.
  v_from := v_start;
  while v_from <= v_month loop
    v_profits := v_profits || coalesce((
      select jsonb_agg(jsonb_build_object('m', p.month, 'p', p.profit_iqd))
      from public.admin_profit_and_loss(v_from, least((v_from + interval '23 months')::date, v_month)) as p
    ), '[]');
    v_from := (v_from + interval '24 months')::date;
  end loop;

  return query
  with profits as (
    select x.m, x.p,
      (select max(s.starts_on) from public.partner_shares as s where s.starts_on <= x.m) as set_on
    from jsonb_to_recordset(v_profits) as x (m date, p bigint)
  ),
  -- Each share rounded down, the dinars left to the largest remainders (then by partner).
  split as (
    select f.m, s.partner_id as who, f.p,
      (case when f.p < 0 then -1 else 1 end) * (abs(f.p) * s.share_bp / 10000) as base,
      (abs(f.p) * s.share_bp) % 10000 as rem
    from profits as f
    join public.partner_shares as s on s.starts_on = f.set_on
  ),
  ranked as (
    select sp.*,
      row_number() over (partition by sp.m order by sp.rem desc, sp.who) as rn,
      abs(sp.p) - sum(abs(sp.base)) over (partition by sp.m) as leftover
    from split as sp
  ),
  shared as (
    select r.m, r.who,
      r.base + case when r.rn <= r.leftover then (case when r.p < 0 then -1 else 1 end) else 0 end as amount
    from ranked as r
  ),
  moves as (
    select mv.partner_id as who,
      coalesce(sum(mv.amount_iqd) filter (where mv.kind = 'capital'), 0) as capital,
      coalesce(sum(mv.amount_iqd) filter (where mv.kind = 'withdrawal'), 0) as withdrawn
    from public.partner_movements as mv
    where mv.voided_at is null and mv.moved_on <= v_as_of
    group by 1
  ),
  current_shares as (
    select s.partner_id as who, s.share_bp
    from public.partner_shares as s
    where s.starts_on = (select max(x.starts_on) from public.partner_shares as x where x.starts_on <= v_month)
  ),
  lines as (
    select
      p.id as who,
      cs.share_bp,
      p.opening_capital_iqd::bigint as opening,
      coalesce(mv.capital, 0)::bigint as capital,
      coalesce(mv.withdrawn, 0)::bigint as withdrawn,
      coalesce((select sum(sh.amount) from shared as sh where sh.who = p.id and sh.m = v_month), 0)::bigint as month_share,
      coalesce((select sum(sh.amount) from shared as sh where sh.who = p.id), 0)::bigint as total_share,
      0 as sort
    from public.partners as p
    left join moves as mv on mv.who = p.id
    left join current_shares as cs on cs.who = p.id
    union all
    select
      null::uuid, null::integer, 0::bigint, 0::bigint, 0::bigint,
      coalesce(sum(f.p) filter (where f.set_on is null and f.m = v_month), 0)::bigint,
      coalesce(sum(f.p) filter (where f.set_on is null), 0)::bigint,
      1
    from profits as f
  )
  select r.who, r.share_bp, r.opening, r.capital, r.withdrawn, r.month_share, r.total_share,
    (r.opening + r.capital - r.withdrawn + r.total_share)::bigint
  from lines as r
  order by r.sort, r.share_bp desc nulls last, r.who;
end;
$$;

-- The balance sheet at the month's end (or today, for this month). Each side
-- from its own records; balanced says they agree.
create function public.admin_balance_sheet(p_month date)
returns table (
  as_of date,
  boxes_iqd bigint,
  crew_cash_iqd bigint,
  receivables_iqd bigint,
  advances_iqd bigint,
  equipment_iqd bigint,
  assets_iqd bigint,
  customer_credit_iqd bigint,
  wages_owed_iqd bigint,
  liabilities_iqd bigint,
  partners_iqd bigint,
  unallocated_profit_iqd bigint,
  opening_difference_iqd bigint,
  equity_iqd bigint,
  balanced boolean,
  closed boolean
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
  v_month date := date_trunc('month', p_month)::date;
  v_start date;
  v_closed date;
  v_as_of date;
  v_boxes bigint;
  v_crew bigint;
  v_receivables bigint;
  v_credit bigint;
  v_owed bigint;
  v_advances bigint;
  v_equipment bigint;
  v_partners bigint;
  v_unallocated bigint;
  v_opening bigint;
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select s.start_on, s.closed_through into v_start, v_closed from public.finance_settings as s where s.id;
  if v_month is null
    or v_month < date_trunc('month', v_start)::date
    or v_month > date_trunc('month', v_today)::date
  then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  v_as_of := least((v_month + interval '1 month' - interval '1 day')::date, v_today);

  -- Assets and liabilities, from the records dated by then.
  select
    coalesce(sum(b.balance) filter (where b.kind <> 'crew'), 0),
    coalesce(sum(b.balance) filter (where b.kind = 'crew'), 0)
  into v_boxes, v_crew
  from (
    select a.kind,
      a.opening_balance_iqd
        + coalesce((
          select sum(t.amount_iqd) from public.finance_transfers as t
          where t.to_account_id = a.id and t.voided_at is null and t.moved_on <= v_as_of
        ), 0)
        - coalesce((
          select sum(t.amount_iqd) from public.finance_transfers as t
          where t.from_account_id = a.id and t.voided_at is null and t.moved_on <= v_as_of
        ), 0)
        - coalesce((
          select sum(e.amount_iqd) from public.expenses as e
          where e.account_id = a.id and e.voided_at is null and e.spent_on <= v_as_of
        ), 0)
        + coalesce((
          select sum(p.amount_iqd) from public.finance_payments as p
          where p.account_id = a.id and p.voided_at is null and p.paid_on <= v_as_of
        ), 0)
        + coalesce((
          select sum(case when m.kind = 'capital' then m.amount_iqd else -m.amount_iqd end)
          from public.partner_movements as m
          where m.account_id = a.id and m.voided_at is null and m.moved_on <= v_as_of
        ), 0)
        + coalesce((
          select sum(d.proceeds_iqd) from public.equipment_disposals as d
          where d.account_id = a.id and d.voided_at is null and d.disposed_on <= v_as_of
        ), 0) as balance
    from public.finance_accounts as a
  ) as b;

  -- Each customer's items added up, each manual sale alone (as A18).
  select
    coalesce(sum(g.balance) filter (where g.balance > 0), 0),
    coalesce(-sum(g.balance) filter (where g.balance < 0), 0)
  into v_receivables, v_credit
  from (
    select sum(
      case when r.revenue_on <= v_as_of then r.amount_iqd - r.discount_iqd else 0 end
      - coalesce((
        select sum(p.amount_iqd) from public.finance_payments as p
        where p.voided_at is null and p.paid_on <= v_as_of
          and (p.order_id = r.order_id or p.subscription_id = r.subscription_id or p.sale_id = r.sale_id)
      ), 0)
    ) as balance
    from public.finance_receivables as r
    group by coalesce(r.customer_id, r.sale_id)
  ) as g;

  select
    coalesce(sum(p.balance_iqd) filter (where p.balance_iqd > 0), 0),
    coalesce(-sum(p.balance_iqd) filter (where p.balance_iqd < 0), 0)
  into v_owed, v_advances
  from public.admin_payroll(v_month, v_month) as p;

  select coalesce(sum(
    q.cost_iqd - coalesce((
      select sum(d.amount_iqd) from public.finance_depreciation as d
      where d.item_id = q.item_id and d.month <= v_month
    ), 0)
  ), 0)
  into v_equipment
  from public.finance_equipment as q
  where q.acquired_on <= v_as_of and (q.disposed_on is null or q.disposed_on > v_as_of);

  -- Equity, from the partners, the profit and the opening balances.
  select
    coalesce(sum(b.balance_iqd) filter (where b.partner_id is not null), 0),
    coalesce(sum(b.balance_iqd) filter (where b.partner_id is null), 0)
  into v_partners, v_unallocated
  from public.admin_partner_balances(v_month) as b;

  v_opening :=
    (select coalesce(sum(a.opening_balance_iqd), 0) from public.finance_accounts as a)
    - (select coalesce(sum(w.opening_balance_iqd), 0) from public.workers as w)
    + (select coalesce(sum(o.value_iqd), 0) from public.opening_equipment as o where o.voided_at is null)
    - (select coalesce(sum(p.opening_capital_iqd), 0) from public.partners as p);

  return query select
    v_as_of,
    v_boxes,
    v_crew,
    v_receivables,
    v_advances,
    v_equipment,
    v_boxes + v_crew + v_receivables + v_advances + v_equipment,
    v_credit,
    v_owed,
    v_credit + v_owed,
    v_partners,
    v_unallocated,
    v_opening,
    v_partners + v_unallocated + v_opening,
    v_boxes + v_crew + v_receivables + v_advances + v_equipment = v_credit + v_owed + v_partners + v_unallocated + v_opening,
    coalesce(v_month <= v_closed, false);
end;
$$;

-- Access ---------------------------------------------------------------------------------

revoke execute on function public.admin_save_partner(uuid, text, text, text, integer, boolean) from public, anon;
revoke execute on function public.admin_set_partner_shares(date, jsonb) from public, anon;
revoke execute on function public.admin_save_partner_movement(uuid, uuid, date, public.partner_movement_kind, uuid, integer, text)
from public, anon;
revoke execute on function public.admin_void_partner_movement(uuid, text) from public, anon;
revoke execute on function public.admin_save_opening_equipment(uuid, text, integer, integer, text) from public, anon;
revoke execute on function public.admin_void_opening_equipment(uuid, text) from public, anon;
revoke execute on function public.admin_save_equipment_disposal(uuid, uuid, uuid, date, uuid, integer, text)
from public, anon;
revoke execute on function public.admin_void_equipment_disposal(uuid, text) from public, anon;
revoke execute on function public.admin_save_expense(uuid, date, bigint, uuid, integer, text, uuid, integer)
from public, anon;
revoke execute on function public.admin_equipment(date) from public, anon;
revoke execute on function public.admin_profit_and_loss(date, date) from public, anon;
revoke execute on function public.admin_expenses_by_category(date, date) from public, anon;
revoke execute on function public.admin_partner_balances(date) from public, anon;
revoke execute on function public.admin_balance_sheet(date) from public, anon;

grant execute on function public.admin_save_partner(uuid, text, text, text, integer, boolean) to authenticated;
grant execute on function public.admin_set_partner_shares(date, jsonb) to authenticated;
grant execute on function public.admin_save_partner_movement(uuid, uuid, date, public.partner_movement_kind, uuid, integer, text)
to authenticated;
grant execute on function public.admin_void_partner_movement(uuid, text) to authenticated;
grant execute on function public.admin_save_opening_equipment(uuid, text, integer, integer, text) to authenticated;
grant execute on function public.admin_void_opening_equipment(uuid, text) to authenticated;
grant execute on function public.admin_save_equipment_disposal(uuid, uuid, uuid, date, uuid, integer, text)
to authenticated;
grant execute on function public.admin_void_equipment_disposal(uuid, text) to authenticated;
grant execute on function public.admin_save_expense(uuid, date, bigint, uuid, integer, text, uuid, integer)
to authenticated;
grant execute on function public.admin_equipment(date) to authenticated;
grant execute on function public.admin_profit_and_loss(date, date) to authenticated;
grant execute on function public.admin_expenses_by_category(date, date) to authenticated;
grant execute on function public.admin_partner_balances(date) to authenticated;
grant execute on function public.admin_balance_sheet(date) to authenticated;

revoke execute on all functions in schema private from public;
