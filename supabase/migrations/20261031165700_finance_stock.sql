-- Accounting, part 6: stock (spec §7 "Accounting", §8.3 A16, A19 and A23;
-- Phase 7, task 6). Settled with the owner on Oct 31, 2026 with the plan's
-- recommendations (spec §13 "Stock").
--
-- 1. Quantities only. Stock carries no value in the books: a purchase stays
--    an ordinary expense in its month, as before, so the profit and loss,
--    the cash view and the balance sheet are unchanged and still balance.
--    No opening stock value, so nothing here has to hold while a month is
--    closed beyond the dated records.
--
-- 2. stock_items: name (2–60, unique), unit (free text, 1–20), minimum (0
--    or more, up to 2 decimals), optional note, a switch. Deleted only while
--    no stock record uses it, voided ones included (ZL045 item_in_use);
--    else switched off. A switched-off item takes no new record (ZL044
--    item_inactive) and is never low.
--
-- 3. stock_moves: every change, dated (the finance day rules, ZL042, ZL043,
--    and a stock_moves_refuse_closed trigger, ZL054): in, out (may name the
--    crew that took it; one company stock, no stock per crew) and count (the
--    quantity on hand at the end of its day, one live per item a day, ZL066
--    count_exists). Logged by hand: usage isn't taken from completed orders.
--    Edited (keeping its item and kind) or voided with a reason, never
--    deleted.
--
-- 4. The quantity at a day's end is the latest count on or before it plus
--    the ins and less the outs after the count's day (stock_levels, a view
--    of each item's days with records). It is never below zero at a day's
--    end, nor before a count by the day's outs: a save, edit or void that
--    would make it so is refused (ZL065 stock_too_low). An item never holds
--    more than 1,000,000,000 (22023 invalid_quantity). A count's correction
--    is what it adds to or takes from the quantity before it.
--
-- 5. An in may name the expense that paid for it (stock_moves.expense_id):
--    a live expense in a general category dated on or before the in (ZL067
--    expense_not_allowed). One expense may cover several items. While a
--    live in names it, the expense isn't voided, dated after the in or moved
--    to a wages or equipment category, and its category doesn't move off
--    general (ZL064 expense_has_stock, from the triggers
--    expenses_guard_stock and expense_categories_guard_stock): void the
--    stock record first.
--
-- 6. Low stock: an item is low while it is switched on and its quantity now
--    is at or below its minimum. When a save, edit or void takes a
--    switched-on item from above its minimum to at or below it, every admin
--    gets a stock_low notification (once per crossing; a new minimum alone
--    sends none). A19 and A23 list low items.
--
-- 7. Reads (security invoker, admins only, 42501 otherwise): the view
--    stock_levels; admin_stock_items() (each item with its quantity now,
--    low, and its last record's day); admin_stock_month(month) (each item's
--    opening quantity, ins, outs, corrections and closing quantity; 22023
--    invalid_date outside the books' months through this one).
--
-- Lock order (supabase/CLAUDE.md): the settings row (share), then the item
-- (FOR UPDATE, so its quantity check sees every record), then the record,
-- then the linked expense and its category (FOR SHARE, so a void of the
-- expense or a move of its category off general at the same moment waits
-- and then sees the record, or wins and the link is refused).
--
-- Changed functions: admin_update_finance_settings (the start day doesn't
-- move past a live stock record, ZL046).
--
-- Access: admins read both tables and the view; guests, customers and
-- crews nothing (a crew not even the records naming it). Written only by
-- audited security definer RPCs: admin_save_stock_item,
-- admin_delete_stock_item, admin_save_stock_move, admin_void_stock_move.
--
-- New errors: ZL064 expense_has_stock, ZL065 stock_too_low, ZL066
-- count_exists, ZL067 expense_not_allowed; ZL044 also covers
-- item_inactive, ZL045 item_in_use; 22023 invalid_unit, invalid_quantity,
-- invalid_crew; P0002 stock_item_not_found, stock_move_not_found.
--
-- Departures from spec §7: none beyond the new tables, which §7 now lists.
-- Quantities are numeric(12,2) rather than integers, since chlorine is
-- bought and used by the kilo and litre. Quantities on hand are computed,
-- never stored, so they can't drift from their records.

-- Types ----------------------------------------------------------------------------------

create type public.stock_move_kind as enum ('in', 'out', 'count');

-- stock_items ----------------------------------------------------------------------------

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 60 and name = btrim(name)),
  unit text not null check (char_length(unit) between 1 and 20 and unit = btrim(unit)),
  -- At or below it the item is low.
  min_quantity numeric(12, 2) not null default 0 check (min_quantity between 0 and 1000000000),
  note text check (char_length(note) between 1 and 300 and note = btrim(note)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stock_items enable row level security;

create trigger stock_items_set_updated_at
before update on public.stock_items
for each row execute function private.set_updated_at();

revoke all on public.stock_items from anon, authenticated;
grant select on public.stock_items to authenticated;

create policy "Admins read the stock items"
on public.stock_items
for select
to authenticated
using ((select private.is_admin()));

-- stock_moves ----------------------------------------------------------------------------

create table public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.stock_items (id) on delete restrict,
  moved_on date not null,
  kind public.stock_move_kind not null,
  -- In and out: how much (above 0). Count: the quantity on hand at the end of the day.
  quantity numeric(12, 2) not null check (quantity between 0 and 1000000000),
  -- The crew that took it (an out only).
  crew_id uuid references public.crews (id) on delete restrict,
  -- The expense that paid for it (an in only).
  expense_id uuid references public.expenses (id) on delete restrict,
  note text check (char_length(note) between 1 and 300 and note = btrim(note)),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text check (char_length(void_reason) between 1 and 300 and void_reason = btrim(void_reason)),
  constraint stock_moves_kind_quantity_check check (kind = 'count' or quantity > 0),
  constraint stock_moves_crew_check check (crew_id is null or kind = 'out'),
  constraint stock_moves_expense_check check (expense_id is null or kind = 'in'),
  constraint stock_moves_void_check check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

alter table public.stock_moves enable row level security;

-- One live count per item a day.
create unique index stock_moves_item_id_moved_on_key
on public.stock_moves (item_id, moved_on) where kind = 'count' and voided_at is null;
create index stock_moves_item_id_idx on public.stock_moves (item_id, moved_on);
create index stock_moves_moved_on_idx on public.stock_moves (moved_on);
create index stock_moves_crew_id_idx on public.stock_moves (crew_id);
create index stock_moves_expense_id_idx on public.stock_moves (expense_id);
create index stock_moves_created_by_idx on public.stock_moves (created_by);
create index stock_moves_voided_by_idx on public.stock_moves (voided_by);

create trigger stock_moves_set_updated_at
before update on public.stock_moves
for each row execute function private.set_updated_at();

create trigger stock_moves_refuse_closed
before insert or update or delete on public.stock_moves
for each row execute function private.finance_refuse_closed('moved_on');

revoke all on public.stock_moves from anon, authenticated;
grant select on public.stock_moves to authenticated;

create policy "Admins read the stock records"
on public.stock_moves
for select
to authenticated
using ((select private.is_admin()));

-- stock_levels ---------------------------------------------------------------------------

-- Each item's days with live records: the day's ins and outs, its count, the
-- quantity at the day's end, and what the count corrected.
create view public.stock_levels
with (security_invoker = true)
as
with days as (
  select
    m.item_id,
    m.moved_on as day,
    coalesce(sum(m.quantity) filter (where m.kind = 'in'), 0) as in_quantity,
    coalesce(sum(m.quantity) filter (where m.kind = 'out'), 0) as out_quantity,
    max(m.quantity) filter (where m.kind = 'count') as counted
  from public.stock_moves as m
  where m.voided_at is null
  group by m.item_id, m.moved_on
),
grouped as (
  -- Each count starts a group; the days before the first count are group 0.
  select d.*, count(d.counted) over (partition by d.item_id order by d.day) as grp
  from days as d
),
levels as (
  select
    g.*,
    sum(coalesce(g.counted, g.in_quantity - g.out_quantity))
      over (partition by g.item_id, g.grp order by g.day) as quantity
  from grouped as g
)
select
  l.item_id,
  l.day,
  l.in_quantity,
  l.out_quantity,
  l.counted,
  l.quantity,
  -- What the records made it at the day's end: the quantity, or before a
  -- count, the day before plus the day's ins less its outs.
  case
    when l.counted is null then l.quantity
    else coalesce(lag(l.quantity) over (partition by l.item_id order by l.day), 0)
      + l.in_quantity - l.out_quantity
  end as recorded,
  -- A count: the counted quantity less what the records made it.
  case
    when l.counted is null then 0
    else l.counted - coalesce(lag(l.quantity) over (partition by l.item_id order by l.day), 0)
      - l.in_quantity + l.out_quantity
  end as correction
from levels as l;

revoke all on public.stock_levels from anon, authenticated;
grant select on public.stock_levels to authenticated;

-- Helpers --------------------------------------------------------------------------------

-- An item's quantity now (the latest day's), 0 with no records.
create function private.stock_quantity(p_item_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select l.quantity from public.stock_levels as l where l.item_id = p_item_id order by l.day desc limit 1),
    0
  );
$$;

-- After a change to an item's records (the item locked): refuses a quantity
-- below zero at any day's end, and tells admins when the item has just
-- dropped to its minimum or below.
create function private.stock_after_change(p_item public.stock_items, p_before numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_after numeric;
begin
  -- Below zero at a day's end, or before a count by the day's outs (RLS
  -- audit: a count must not hide an out of more than was there).
  if exists (
    select 1 from public.stock_levels as l
    where l.item_id = p_item.id and (l.quantity < 0 or l.recorded < 0)
  ) then
    raise exception using errcode = 'ZL065', message = 'stock_too_low';
  end if;
  -- An item never holds more than one record may (RLS audit: the reads
  -- return numeric(12, 2)).
  if exists (
    select 1 from public.stock_levels as l
    where l.item_id = p_item.id and greatest(l.quantity, l.recorded) > 1000000000
  ) then
    raise exception using errcode = '22023', message = 'invalid_quantity';
  end if;
  v_after := private.stock_quantity(p_item.id);
  if p_item.active and p_before > p_item.min_quantity and v_after <= p_item.min_quantity then
    perform private.notify_admins(
      'stock_low',
      jsonb_build_object('item_id', p_item.id, 'name', p_item.name, 'unit', p_item.unit, 'quantity', v_after)
    );
  end if;
end;
$$;

-- A quantity as stored: 0 up to 1,000,000,000 with at most 2 decimals.
create function private.stock_check_quantity(p_quantity numeric)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_quantity is null or p_quantity < 0 or p_quantity > 1000000000 or p_quantity <> round(p_quantity, 2) then
    raise exception using errcode = '22023', message = 'invalid_quantity';
  end if;
end;
$$;

-- An expense linked to stock holds while a live in names it: not voided, not
-- dated after the in, and in a general category.
create function private.expenses_guard_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.voided_at is not distinct from old.voided_at
    and new.spent_on = old.spent_on
    and new.category_id = old.category_id then
    return new;
  end if;
  if exists (
    select 1 from public.stock_moves as m
    where m.expense_id = new.id
      and m.voided_at is null
      and (
        new.voided_at is not null
        or m.moved_on < new.spent_on
        or (select c.kind from public.expense_categories as c where c.id = new.category_id) <> 'general'
      )
  ) then
    raise exception using errcode = 'ZL064', message = 'expense_has_stock';
  end if;
  return new;
end;
$$;

create trigger expenses_guard_stock
before update on public.expenses
for each row execute function private.expenses_guard_stock();

create function private.expense_categories_guard_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'general' and old.kind = 'general' and exists (
    select 1
    from public.stock_moves as m
    join public.expenses as e on e.id = m.expense_id
    where e.category_id = new.id and e.voided_at is null and m.voided_at is null
  ) then
    raise exception using errcode = 'ZL064', message = 'expense_has_stock';
  end if;
  return new;
end;
$$;

create trigger expense_categories_guard_stock
before update of kind on public.expense_categories
for each row execute function private.expense_categories_guard_stock();

-- Notifications --------------------------------------------------------------------------

alter table public.notifications
alter column audience set expression as (
  case
    when type in (
      'new_booking', 'customer_rescheduled', 'customer_cancelled', 'customer_message', 'new_ticket',
      'subscription_requested', 'customer_postponed', 'stock_low'
    ) then 'admin'::public.app_role
    when type in ('new_job', 'job_changed') then 'crew'::public.app_role
    else 'customer'::public.app_role
  end
);

-- Items ----------------------------------------------------------------------------------

create function public.admin_save_stock_item(
  p_id uuid default null,
  p_name text default null,
  p_unit text default null,
  p_min_quantity numeric default null,
  p_note text default null,
  p_active boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.stock_items;
  v_note text;
  v_min numeric;
  v_active boolean;
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
  if p_unit is null or char_length(p_unit) not between 1 and 20 or p_unit <> btrim(p_unit) then
    raise exception using errcode = '22023', message = 'invalid_unit';
  end if;
  v_note := private.finance_note(p_note);

  if p_id is not null then
    select * into v_old from public.stock_items as i where i.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'stock_item_not_found';
    end if;
  end if;
  v_min := coalesce(p_min_quantity, v_old.min_quantity, 0);
  perform private.stock_check_quantity(v_min);
  v_active := coalesce(p_active, v_old.active, true);

  if exists (select 1 from public.stock_items as i where i.name = p_name and i.id is distinct from p_id) then
    raise exception using errcode = 'ZL048', message = 'name_taken';
  end if;

  v_new := jsonb_build_object(
    'name', p_name, 'unit', p_unit, 'min_quantity', v_min, 'note', v_note, 'active', v_active
  );
  begin
    if p_id is null then
      insert into public.stock_items (name, unit, min_quantity, note, active)
      values (p_name, p_unit, v_min, v_note, v_active)
      returning id into v_id;
      perform private.log_admin_action('stock_item.create', 'stock_items', v_id::text, v_new);
      return v_id;
    end if;

    v_diff := private.audit_changes(
      jsonb_build_object(
        'name', v_old.name, 'unit', v_old.unit, 'min_quantity', v_old.min_quantity,
        'note', v_old.note, 'active', v_old.active
      ),
      v_new
    );
    if v_diff <> '{}' then
      update public.stock_items as i
      set name = p_name, unit = p_unit, min_quantity = v_min, note = v_note, active = v_active
      where i.id = p_id;
      perform private.log_admin_action('stock_item.update', 'stock_items', p_id::text, v_diff);
    end if;
  exception when unique_violation then
    raise exception using errcode = 'ZL048', message = 'name_taken';
  end;
  return p_id;
end;
$$;

create function public.admin_delete_stock_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.stock_items;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select * into v_old from public.stock_items as i where i.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'stock_item_not_found';
  end if;
  if exists (select 1 from public.stock_moves as m where m.item_id = p_id) then
    raise exception using errcode = 'ZL045', message = 'item_in_use';
  end if;
  delete from public.stock_items as i where i.id = p_id;
  perform private.log_admin_action(
    'stock_item.delete', 'stock_items', p_id::text, jsonb_build_object('name', v_old.name, 'unit', v_old.unit)
  );
end;
$$;

-- Records --------------------------------------------------------------------------------

create function public.admin_save_stock_move(
  p_id uuid default null,
  p_item_id uuid default null,
  p_moved_on date default null,
  p_kind public.stock_move_kind default null,
  p_quantity numeric default null,
  p_crew_id uuid default null,
  p_expense_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.stock_moves;
  v_item public.stock_items;
  v_old_item uuid;
  v_before numeric;
  v_note text;
  v_crew_active boolean;
  v_expense record;
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
  perform private.stock_check_quantity(p_quantity);
  if p_kind <> 'count' and p_quantity = 0 then
    raise exception using errcode = '22023', message = 'invalid_quantity';
  end if;
  if p_crew_id is not null and p_kind <> 'out' then
    raise exception using errcode = '22023', message = 'invalid_crew';
  end if;
  if p_expense_id is not null and p_kind <> 'in' then
    raise exception using errcode = 'ZL067', message = 'expense_not_allowed';
  end if;
  v_note := private.finance_note(p_note);
  -- The settings row first (share lock), then the item, then the record, then the expense.
  perform private.finance_check_day(p_moved_on);

  if p_id is not null then
    select m.item_id into v_old_item from public.stock_moves as m where m.id = p_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'stock_move_not_found';
    end if;
  end if;
  select * into v_item from public.stock_items as i where i.id = p_item_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'stock_item_not_found';
  end if;
  if p_id is not null then
    select * into v_old from public.stock_moves as m where m.id = p_id for update;
    if v_old.item_id <> p_item_id or v_old.kind <> p_kind then
      raise exception using errcode = '22023', message = 'invalid_target';
    end if;
    if v_old.voided_at is not null then
      raise exception using errcode = 'ZL047', message = 'record_voided';
    end if;
  elsif not v_item.active then
    raise exception using errcode = 'ZL044', message = 'item_inactive';
  end if;

  if p_crew_id is not null then
    select c.active into v_crew_active from public.crews as c where c.id = p_crew_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'crew_not_found';
    end if;
    if not v_crew_active and p_crew_id is distinct from v_old.crew_id then
      raise exception using errcode = 'ZL013', message = 'crew_inactive';
    end if;
  end if;

  if p_expense_id is not null then
    -- Share lock: a void of the expense at the same moment waits for this
    -- record and then sees it, or wins and the link is refused.
    select e.spent_on, e.voided_at, c.kind
    into v_expense
    from public.expenses as e
    join public.expense_categories as c on c.id = e.category_id
    where e.id = p_expense_id
    -- The category too (RLS audit): a move off general at the same moment
    -- waits for this record and its trigger then sees it.
    for share of e, c;
    if not found then
      raise exception using errcode = 'P0002', message = 'expense_not_found';
    end if;
    if v_expense.voided_at is not null or v_expense.kind <> 'general' or v_expense.spent_on > p_moved_on then
      raise exception using errcode = 'ZL067', message = 'expense_not_allowed';
    end if;
  end if;

  v_before := private.stock_quantity(p_item_id);
  v_new := jsonb_build_object(
    'item_id', p_item_id, 'moved_on', p_moved_on, 'kind', p_kind, 'quantity', p_quantity,
    'crew_id', p_crew_id, 'expense_id', p_expense_id, 'note', v_note
  );
  begin
    if p_id is null then
      insert into public.stock_moves (item_id, moved_on, kind, quantity, crew_id, expense_id, note, created_by)
      values (p_item_id, p_moved_on, p_kind, p_quantity, p_crew_id, p_expense_id, v_note, (select auth.uid()))
      returning id into v_id;
    else
      v_diff := private.audit_changes(
        jsonb_build_object(
          'item_id', v_old.item_id, 'moved_on', v_old.moved_on, 'kind', v_old.kind, 'quantity', v_old.quantity,
          'crew_id', v_old.crew_id, 'expense_id', v_old.expense_id, 'note', v_old.note
        ),
        v_new
      );
      if v_diff <> '{}' then
        update public.stock_moves as m
        set moved_on = p_moved_on, quantity = p_quantity, crew_id = p_crew_id, expense_id = p_expense_id, note = v_note
        where m.id = p_id;
      end if;
    end if;
  exception when unique_violation then
    raise exception using errcode = 'ZL066', message = 'count_exists';
  end;

  perform private.stock_after_change(v_item, v_before);

  if p_id is null then
    perform private.log_admin_action('stock_move.create', 'stock_moves', v_id::text, v_new);
    return v_id;
  end if;
  if v_diff <> '{}' then
    -- The item too, so the audit log names and links it.
    perform private.log_admin_action(
      'stock_move.update', 'stock_moves', p_id::text, v_diff || jsonb_build_object('item_id', v_old.item_id)
    );
  end if;
  return p_id;
end;
$$;

create function public.admin_void_stock_move(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.stock_moves;
  v_item public.stock_items;
  v_item_id uuid;
  v_before numeric;
  v_reason text;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_reason := private.void_reason(p_reason);

  perform 1 from public.finance_settings as s where s.id for share;
  select m.item_id into v_item_id from public.stock_moves as m where m.id = p_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'stock_move_not_found';
  end if;
  select * into v_item from public.stock_items as i where i.id = v_item_id for update;
  select * into v_old from public.stock_moves as m where m.id = p_id for update;
  if v_old.voided_at is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;

  v_before := private.stock_quantity(v_item.id);
  update public.stock_moves as m
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where m.id = p_id;
  perform private.stock_after_change(v_item, v_before);
  perform private.log_admin_action(
    'stock_move.void', 'stock_moves', p_id::text,
    jsonb_build_object(
      'item_id', v_old.item_id, 'moved_on', v_old.moved_on, 'kind', v_old.kind,
      'quantity', v_old.quantity, 'reason', v_reason
    )
  );
end;
$$;

-- The start day ---------------------------------------------------------------------------

-- As in finance_partners, plus: the start day doesn't move past a live stock record.
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
  ) or exists (
    select 1 from public.stock_moves as m where m.voided_at is null and m.moved_on < p_start_on
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

-- Every item with its quantity now, whether it is low, and its last record's day.
create function public.admin_stock_items()
returns table (
  id uuid,
  name text,
  unit text,
  min_quantity numeric,
  note text,
  active boolean,
  quantity numeric,
  low boolean,
  last_moved_on date
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
    i.id,
    i.name,
    i.unit,
    i.min_quantity,
    i.note,
    i.active,
    coalesce(l.quantity, 0)::numeric(12, 2),
    i.active and coalesce(l.quantity, 0) <= i.min_quantity,
    l.day
  from public.stock_items as i
  left join lateral (
    select s.quantity, s.day from public.stock_levels as s where s.item_id = i.id order by s.day desc limit 1
  ) as l on true
  order by i.name;
end;
$$;

-- Each item's month: the quantity at the end of the month before, the ins,
-- the outs, the counts' corrections and the quantity at the month's end.
create function public.admin_stock_month(p_month date)
returns table (
  item_id uuid,
  opening_quantity numeric,
  in_quantity numeric,
  out_quantity numeric,
  correction_quantity numeric,
  closing_quantity numeric
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_first date := date_trunc('month', p_month)::date;
  v_end date;
  v_start date;
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select date_trunc('month', s.start_on)::date into v_start from public.finance_settings as s where s.id;
  if v_first is null or v_first < v_start
    or v_first > date_trunc('month', (now() at time zone 'Asia/Baghdad'))::date then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  v_end := (v_first + interval '1 month')::date;
  return query
  select
    i.id,
    coalesce((
      select l.quantity from public.stock_levels as l
      where l.item_id = i.id and l.day < v_first order by l.day desc limit 1
    ), 0)::numeric(12, 2),
    coalesce(m.in_quantity, 0)::numeric(12, 2),
    coalesce(m.out_quantity, 0)::numeric(12, 2),
    coalesce(m.correction, 0)::numeric(12, 2),
    coalesce((
      select l.quantity from public.stock_levels as l
      where l.item_id = i.id and l.day < v_end order by l.day desc limit 1
    ), 0)::numeric(12, 2)
  from public.stock_items as i
  left join (
    select
      l.item_id,
      sum(l.in_quantity) as in_quantity,
      sum(l.out_quantity) as out_quantity,
      sum(l.correction) as correction
    from public.stock_levels as l
    where l.day >= v_first and l.day < v_end
    group by l.item_id
  ) as m on m.item_id = i.id
  order by i.name;
end;
$$;

-- Grants ---------------------------------------------------------------------------------

revoke execute on function public.admin_save_stock_item(uuid, text, text, numeric, text, boolean) from public, anon;
revoke execute on function public.admin_delete_stock_item(uuid) from public, anon;
revoke execute on function public.admin_save_stock_move(uuid, uuid, date, public.stock_move_kind, numeric, uuid, uuid, text)
from public, anon;
revoke execute on function public.admin_void_stock_move(uuid, text) from public, anon;
revoke execute on function public.admin_stock_items() from public, anon;
revoke execute on function public.admin_stock_month(date) from public, anon;

grant execute on function public.admin_save_stock_item(uuid, text, text, numeric, text, boolean) to authenticated;
grant execute on function public.admin_delete_stock_item(uuid) to authenticated;
grant execute on function public.admin_save_stock_move(uuid, uuid, date, public.stock_move_kind, numeric, uuid, uuid, text)
to authenticated;
grant execute on function public.admin_void_stock_move(uuid, text) to authenticated;
grant execute on function public.admin_stock_items() to authenticated;
grant execute on function public.admin_stock_month(date) to authenticated;

revoke execute on all functions in schema private from public;
