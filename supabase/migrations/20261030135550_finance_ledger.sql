-- Accounting, part 1: the ledger core (spec §7 "Accounting", §8.3 A15–A17;
-- Phase 7, task 1). Added to the product by the owner on Oct 30, 2026; every
-- admin uses it (no finance-only role).
--
-- 1. finance_settings: one row, start_on, the day the books start. No
--    expense or transfer is dated before it, and it can't move past a live
--    one (ZL046 records_before_start). The migration starts the books on the
--    first day of the current month in Baghdad; admins change it in A17.
--    Its own table, not a column of settings, because guests read settings.
--
-- 2. finance_accounts, the money boxes: kind (cash, zain_cash, bank, crew),
--    name, opening_balance_iqd, active. A crew box belongs to one crew, has
--    no name (the app shows the crew's) and is made by a trigger for every
--    crew, the existing ones included, because the crew holds the cash it
--    collects until it hands it in; the box goes with its crew unless it
--    has records. The migration adds a cash, a Zain Cash
--    and a bank box; admins rename them and add more. Switched off, never
--    deleted; a switched-off box takes no new record.
--
-- 3. expense_categories: name and kind (general, wages, equipment; payroll
--    and equipment in later tasks use the kind), active. The migration adds
--    nine. Deleted only while no expense uses it, else switched off.
--
-- 4. expenses and finance_transfers: integer IQD, a day between the start
--    and today in Baghdad, an optional note. Edits are allowed and audited;
--    "delete" voids the record (voided_at, voided_by, void_reason), which
--    keeps it but leaves it out of every total.
--
-- 5. finance_account_balances (security invoker): opening balance +
--    transfers in − transfers out − expenses, voided records left out.
--    A box may go below zero (a crew spends before its cash is recorded);
--    the app warns.
--
-- Access: admins read everything; guests, customers and crews nothing (a
-- crew not even its own box). Nobody writes the tables directly: audited
-- security definer RPCs (private.log_admin_action) do:
-- admin_update_finance_settings, admin_save_finance_account,
-- admin_save_expense_category / admin_delete_expense_category,
-- admin_save_expense / admin_void_expense, admin_save_transfer /
-- admin_void_transfer. A missing box is P0002 finance_account_not_found
-- (account_not_found is a login account's). New errors: ZL042
-- before_finance_start, ZL043 date_in_future, ZL044 account_inactive /
-- category_inactive, ZL045 category_in_use, ZL046 records_before_start,
-- ZL047 record_voided, ZL048 name_taken.
--
-- §7 had no accounting; these tables are new, so there are no departures.

-- Types ----------------------------------------------------------------------------------

create type public.finance_account_kind as enum ('cash', 'zain_cash', 'bank', 'crew');
create type public.expense_category_kind as enum ('general', 'wages', 'equipment');

-- finance_settings -----------------------------------------------------------------------

create table public.finance_settings (
  -- Always true: the primary key allows exactly one row.
  id boolean primary key default true check (id),
  start_on date not null,
  updated_at timestamptz not null default now()
);

alter table public.finance_settings enable row level security;

create trigger finance_settings_set_updated_at
before update on public.finance_settings
for each row execute function private.set_updated_at();

insert into public.finance_settings (start_on)
values (date_trunc('month', private.baghdad_today())::date)
on conflict do nothing;

revoke all on public.finance_settings from anon, authenticated;
grant select on public.finance_settings to authenticated;

create policy "Admins read the finance settings"
on public.finance_settings
for select
to authenticated
using ((select private.is_admin()));

-- finance_accounts -----------------------------------------------------------------------

create table public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  kind public.finance_account_kind not null,
  -- "الصندوق", "مصرف الرافدين"; null for a crew box, which shows its crew's name.
  name text unique check (char_length(name) between 2 and 40 and name = btrim(name)),
  -- A crew's box goes with the crew; a box with records holds the crew back (their foreign keys restrict).
  crew_id uuid unique references public.crews (id) on delete cascade,
  -- What the box held on the day the books start. Below zero for an overdrawn bank.
  opening_balance_iqd integer not null default 0
    check (opening_balance_iqd between -1000000000 and 1000000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_accounts_crew_check check ((kind = 'crew') = (crew_id is not null)),
  constraint finance_accounts_crew_name_check check ((kind = 'crew') = (name is null))
);

alter table public.finance_accounts enable row level security;

create trigger finance_accounts_set_updated_at
before update on public.finance_accounts
for each row execute function private.set_updated_at();

revoke all on public.finance_accounts from anon, authenticated;
grant select on public.finance_accounts to authenticated;

create policy "Admins read the money boxes"
on public.finance_accounts
for select
to authenticated
using ((select private.is_admin()));

insert into public.finance_accounts (kind, name)
select v.kind, v.name
from (
  values
    ('cash'::public.finance_account_kind, 'الصندوق'),
    ('zain_cash'::public.finance_account_kind, 'زين كاش'),
    ('bank'::public.finance_account_kind, 'الحساب المصرفي')
) as v (kind, name)
where not exists (select 1 from public.finance_accounts as a where a.kind = v.kind);

-- Every crew gets its box: the ones that exist now, and each new one.
create function private.create_crew_finance_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.finance_accounts (kind, crew_id) values ('crew', new.id)
  on conflict (crew_id) do nothing;
  return new;
end;
$$;

create trigger crews_create_finance_account
after insert on public.crews
for each row execute function private.create_crew_finance_account();

insert into public.finance_accounts (kind, crew_id)
select 'crew', c.id from public.crews as c
on conflict (crew_id) do nothing;

-- expense_categories ---------------------------------------------------------------------

create table public.expense_categories (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(name) between 2 and 40 and name = btrim(name)),
  kind public.expense_category_kind not null default 'general',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.expense_categories enable row level security;

create trigger expense_categories_set_updated_at
before update on public.expense_categories
for each row execute function private.set_updated_at();

revoke all on public.expense_categories from anon, authenticated;
revoke all on sequence public.expense_categories_id_seq from anon, authenticated;
grant select on public.expense_categories to authenticated;

create policy "Admins read the expense categories"
on public.expense_categories
for select
to authenticated
using ((select private.is_admin()));

-- In this order, which the screens keep (by id).
insert into public.expense_categories (name, kind)
select v.name, v.kind
from (
  values
    (1, 'مواد تعقيم وكلور', 'general'::public.expense_category_kind),
    (2, 'وقود ونقل', 'general'),
    (3, 'أجور عمال', 'wages'),
    (4, 'أدوات صغيرة وصيانة', 'general'),
    (5, 'شراء معدات', 'equipment'),
    (6, 'تسويق وإعلانات', 'general'),
    (7, 'إيجار ومكتب', 'general'),
    (8, 'اتصالات وإنترنت', 'general'),
    (9, 'مصاريف أخرى', 'general')
) as v (n, name, kind)
where not exists (select 1 from public.expense_categories as c where c.name = v.name)
order by v.n;

-- expenses -------------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null,
  category_id bigint not null references public.expense_categories (id) on delete restrict,
  -- The box the money left.
  account_id uuid not null references public.finance_accounts (id) on delete restrict,
  amount_iqd integer not null check (amount_iqd between 1 and 1000000000),
  note text check (char_length(note) between 1 and 300 and note = btrim(note)),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text check (char_length(void_reason) between 1 and 300 and void_reason = btrim(void_reason)),
  constraint expenses_void_check check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

alter table public.expenses enable row level security;

create index expenses_spent_on_idx on public.expenses (spent_on);
create index expenses_category_id_idx on public.expenses (category_id);
create index expenses_account_id_idx on public.expenses (account_id);
create index expenses_created_by_idx on public.expenses (created_by);
create index expenses_voided_by_idx on public.expenses (voided_by);

create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function private.set_updated_at();

revoke all on public.expenses from anon, authenticated;
grant select on public.expenses to authenticated;

create policy "Admins read the expenses"
on public.expenses
for select
to authenticated
using ((select private.is_admin()));

-- finance_transfers ----------------------------------------------------------------------

create table public.finance_transfers (
  id uuid primary key default gen_random_uuid(),
  moved_on date not null,
  from_account_id uuid not null references public.finance_accounts (id) on delete restrict,
  to_account_id uuid not null references public.finance_accounts (id) on delete restrict,
  amount_iqd integer not null check (amount_iqd between 1 and 1000000000),
  note text check (char_length(note) between 1 and 300 and note = btrim(note)),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text check (char_length(void_reason) between 1 and 300 and void_reason = btrim(void_reason)),
  constraint finance_transfers_accounts_check check (from_account_id <> to_account_id),
  constraint finance_transfers_void_check check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

alter table public.finance_transfers enable row level security;

create index finance_transfers_moved_on_idx on public.finance_transfers (moved_on);
create index finance_transfers_from_account_id_idx on public.finance_transfers (from_account_id);
create index finance_transfers_to_account_id_idx on public.finance_transfers (to_account_id);
create index finance_transfers_created_by_idx on public.finance_transfers (created_by);
create index finance_transfers_voided_by_idx on public.finance_transfers (voided_by);

create trigger finance_transfers_set_updated_at
before update on public.finance_transfers
for each row execute function private.set_updated_at();

revoke all on public.finance_transfers from anon, authenticated;
grant select on public.finance_transfers to authenticated;

create policy "Admins read the transfers"
on public.finance_transfers
for select
to authenticated
using ((select private.is_admin()));

-- finance_account_balances ---------------------------------------------------------------

create view public.finance_account_balances
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
    ), 0) as balance_iqd
from public.finance_accounts as a;

revoke all on public.finance_account_balances from anon, authenticated;
grant select on public.finance_account_balances to authenticated;

-- Helpers --------------------------------------------------------------------------------

-- Only the keys whose value changed, as {"key": {"from": old, "to": new}}.
create function private.audit_changes(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(n.key, jsonb_build_object('from', p_old -> n.key, 'to', n.value)),
    '{}'
  )
  from jsonb_each(p_new) as n
  where (p_old -> n.key) is distinct from n.value;
$$;

-- A record's day: between the books' start and today in Baghdad. Holds the
-- settings row (share lock), so the start can't move past it meanwhile.
create function private.finance_check_day(p_day date)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_start date;
begin
  if p_day is null then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  if p_day > private.baghdad_today() then
    raise exception using errcode = 'ZL043', message = 'date_in_future';
  end if;
  select s.start_on into v_start from public.finance_settings as s where s.id for share;
  if p_day < v_start then
    raise exception using errcode = 'ZL042', message = 'before_finance_start';
  end if;
end;
$$;

create function private.finance_check_amount(p_amount integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null or p_amount not between 1 and 1000000000 then
    raise exception using errcode = '22023', message = 'invalid_amount';
  end if;
end;
$$;

-- The note as stored: trimmed, blank = none, at most 300 characters.
create function private.finance_note(p_note text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(p_note), '');
begin
  if char_length(v_note) > 300 then
    raise exception using errcode = '22023', message = 'invalid_note';
  end if;
  return v_note;
end;
$$;

-- A box a record may use; p_new: the record takes it now (not kept from before
-- an edit), so it must be switched on.
create function private.finance_check_account(p_id uuid, p_new boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_active boolean;
begin
  -- Share lock: a switch-off running now (FOR UPDATE) finishes first, or waits for us.
  select a.active into v_active from public.finance_accounts as a where a.id = p_id for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'finance_account_not_found';
  end if;
  if p_new and not v_active then
    raise exception using errcode = 'ZL044', message = 'account_inactive';
  end if;
end;
$$;

create function private.finance_check_category(p_id bigint, p_new boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_active boolean;
begin
  select c.active into v_active from public.expense_categories as c where c.id = p_id for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;
  if p_new and not v_active then
    raise exception using errcode = 'ZL044', message = 'category_inactive';
  end if;
end;
$$;

-- A void reason: trimmed, 1–300 characters.
create function private.void_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_reason is null or char_length(v_reason) > 300 then
    raise exception using errcode = 'ZL011', message = 'reason_required';
  end if;
  return v_reason;
end;
$$;

-- admin_update_finance_settings ----------------------------------------------------------

create function public.admin_update_finance_settings(p_start_on date)
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
  ) then
    raise exception using errcode = 'ZL046', message = 'records_before_start';
  end if;

  update public.finance_settings as s set start_on = p_start_on where s.id;
  perform private.log_admin_action(
    'finance.settings', 'finance_settings', 'main',
    jsonb_build_object('start_on', jsonb_build_object('from', v_old, 'to', p_start_on))
  );
end;
$$;

-- admin_save_finance_account -------------------------------------------------------------

-- p_id null: a new box (any kind but crew, with a name). Otherwise null keeps a value.
create function public.admin_save_finance_account(
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

-- admin_save_expense_category ------------------------------------------------------------

-- p_id null: a new category (general and active unless given). Otherwise null keeps a value.
create function public.admin_save_expense_category(
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

-- admin_delete_expense_category ----------------------------------------------------------

create function public.admin_delete_expense_category(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.expense_categories;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select * into v_old from public.expense_categories as c where c.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;
  -- Voided expenses keep their category too.
  if exists (select 1 from public.expenses as e where e.category_id = p_id) then
    raise exception using errcode = 'ZL045', message = 'category_in_use';
  end if;

  begin
    delete from public.expense_categories as c where c.id = p_id;
  exception when foreign_key_violation then
    -- An expense took the category a moment ago.
    raise exception using errcode = 'ZL045', message = 'category_in_use';
  end;

  perform private.log_admin_action(
    'expense_category.delete', 'expense_categories', p_id::text, jsonb_build_object('name', v_old.name)
  );
end;
$$;

-- admin_save_expense ---------------------------------------------------------------------

-- p_id null: a new expense. Every value is given each time (the form sends them all).
create function public.admin_save_expense(
  p_id uuid default null,
  p_spent_on date default null,
  p_category_id bigint default null,
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
  v_old public.expenses;
  v_note text;
  v_id uuid;
  v_new jsonb;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  perform private.finance_check_amount(p_amount_iqd);
  v_note := private.finance_note(p_note);
  perform private.finance_check_day(p_spent_on);

  if p_id is not null then
    select * into v_old from public.expenses as e where e.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'expense_not_found';
    end if;
    if v_old.voided_at is not null then
      raise exception using errcode = 'ZL047', message = 'record_voided';
    end if;
  end if;
  perform private.finance_check_category(p_category_id, v_old.category_id is distinct from p_category_id);
  perform private.finance_check_account(p_account_id, v_old.account_id is distinct from p_account_id);

  v_new := jsonb_build_object(
    'spent_on', p_spent_on, 'category_id', p_category_id, 'account_id', p_account_id,
    'amount_iqd', p_amount_iqd, 'note', v_note
  );

  if p_id is null then
    insert into public.expenses (spent_on, category_id, account_id, amount_iqd, note, created_by)
    values (p_spent_on, p_category_id, p_account_id, p_amount_iqd, v_note, (select auth.uid()))
    returning id into v_id;
    perform private.log_admin_action('expense.create', 'expenses', v_id::text, v_new);
    return v_id;
  end if;

  v_diff := private.audit_changes(
    jsonb_build_object(
      'spent_on', v_old.spent_on, 'category_id', v_old.category_id, 'account_id', v_old.account_id,
      'amount_iqd', v_old.amount_iqd, 'note', v_old.note
    ),
    v_new
  );
  if v_diff <> '{}' then
    update public.expenses as e
    set spent_on = p_spent_on, category_id = p_category_id, account_id = p_account_id,
      amount_iqd = p_amount_iqd, note = v_note
    where e.id = p_id;
    perform private.log_admin_action('expense.update', 'expenses', p_id::text, v_diff);
  end if;
  return p_id;
end;
$$;

-- admin_void_expense ---------------------------------------------------------------------

create function public.admin_void_expense(p_id uuid, p_reason text)
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

  update public.expenses as e
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where e.id = p_id;
  perform private.log_admin_action(
    'expense.void', 'expenses', p_id::text,
    jsonb_build_object('spent_on', v_old.spent_on, 'amount_iqd', v_old.amount_iqd, 'reason', v_reason)
  );
end;
$$;

-- admin_save_transfer --------------------------------------------------------------------

-- p_id null: a new transfer. Every value is given each time.
create function public.admin_save_transfer(
  p_id uuid default null,
  p_moved_on date default null,
  p_from_account_id uuid default null,
  p_to_account_id uuid default null,
  p_amount_iqd integer default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.finance_transfers;
  v_note text;
  v_id uuid;
  v_new jsonb;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  perform private.finance_check_amount(p_amount_iqd);
  v_note := private.finance_note(p_note);
  perform private.finance_check_day(p_moved_on);
  if p_from_account_id = p_to_account_id then
    raise exception using errcode = '22023', message = 'same_account';
  end if;

  if p_id is not null then
    select * into v_old from public.finance_transfers as t where t.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'transfer_not_found';
    end if;
    if v_old.voided_at is not null then
      raise exception using errcode = 'ZL047', message = 'record_voided';
    end if;
  end if;
  perform private.finance_check_account(p_from_account_id, v_old.from_account_id is distinct from p_from_account_id);
  perform private.finance_check_account(p_to_account_id, v_old.to_account_id is distinct from p_to_account_id);

  v_new := jsonb_build_object(
    'moved_on', p_moved_on, 'from_account_id', p_from_account_id, 'to_account_id', p_to_account_id,
    'amount_iqd', p_amount_iqd, 'note', v_note
  );

  if p_id is null then
    insert into public.finance_transfers (moved_on, from_account_id, to_account_id, amount_iqd, note, created_by)
    values (p_moved_on, p_from_account_id, p_to_account_id, p_amount_iqd, v_note, (select auth.uid()))
    returning id into v_id;
    perform private.log_admin_action('transfer.create', 'finance_transfers', v_id::text, v_new);
    return v_id;
  end if;

  v_diff := private.audit_changes(
    jsonb_build_object(
      'moved_on', v_old.moved_on, 'from_account_id', v_old.from_account_id,
      'to_account_id', v_old.to_account_id, 'amount_iqd', v_old.amount_iqd, 'note', v_old.note
    ),
    v_new
  );
  if v_diff <> '{}' then
    update public.finance_transfers as t
    set moved_on = p_moved_on, from_account_id = p_from_account_id, to_account_id = p_to_account_id,
      amount_iqd = p_amount_iqd, note = v_note
    where t.id = p_id;
    perform private.log_admin_action('transfer.update', 'finance_transfers', p_id::text, v_diff);
  end if;
  return p_id;
end;
$$;

-- admin_void_transfer --------------------------------------------------------------------

create function public.admin_void_transfer(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.finance_transfers;
  v_reason text;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_reason := private.void_reason(p_reason);

  select * into v_old from public.finance_transfers as t where t.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'transfer_not_found';
  end if;
  if v_old.voided_at is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;

  update public.finance_transfers as t
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where t.id = p_id;
  perform private.log_admin_action(
    'transfer.void', 'finance_transfers', p_id::text,
    jsonb_build_object('moved_on', v_old.moved_on, 'amount_iqd', v_old.amount_iqd, 'reason', v_reason)
  );
end;
$$;

-- Grants ---------------------------------------------------------------------------------

revoke execute on function public.admin_update_finance_settings(date) from public, anon;
grant execute on function public.admin_update_finance_settings(date) to authenticated;
revoke execute on function public.admin_save_finance_account(uuid, public.finance_account_kind, text, integer, boolean)
from public, anon;
grant execute on function public.admin_save_finance_account(uuid, public.finance_account_kind, text, integer, boolean)
to authenticated;
revoke execute on function public.admin_save_expense_category(bigint, text, public.expense_category_kind, boolean)
from public, anon;
grant execute on function public.admin_save_expense_category(bigint, text, public.expense_category_kind, boolean)
to authenticated;
revoke execute on function public.admin_delete_expense_category(bigint) from public, anon;
grant execute on function public.admin_delete_expense_category(bigint) to authenticated;
revoke execute on function public.admin_save_expense(uuid, date, bigint, uuid, integer, text) from public, anon;
grant execute on function public.admin_save_expense(uuid, date, bigint, uuid, integer, text) to authenticated;
revoke execute on function public.admin_void_expense(uuid, text) from public, anon;
grant execute on function public.admin_void_expense(uuid, text) to authenticated;
revoke execute on function public.admin_save_transfer(uuid, date, uuid, uuid, integer, text) from public, anon;
grant execute on function public.admin_save_transfer(uuid, date, uuid, uuid, integer, text) to authenticated;
revoke execute on function public.admin_void_transfer(uuid, text) from public, anon;
grant execute on function public.admin_void_transfer(uuid, text) to authenticated;

revoke execute on all functions in schema private from public;
