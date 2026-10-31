-- Accounting, part 4: payroll (spec §7 "Accounting", §8.3 A21; Phase 7, task
-- 4). Settled with the owner on Oct 31, 2026 with the plan's
-- recommendations (spec §13 "Payroll").
--
-- 1. workers: internal records for the books, with no login (name, optional
--    phone and note, an opening balance at the books' start, a switch).
--    Never deleted; a switched-off worker takes no new record (ZL044
--    worker_inactive) and keeps their history, but is still paid what
--    they're owed (a wage expense may name them).
--
-- 2. worker_crews: crew membership with its first and last day (to_on null
--    while current). A worker is in at most one crew on a day (ZL058
--    membership_overlap), or in none (a driver). A move ends the old row
--    the day before the new one starts (admin_move_worker), so moves stay
--    with their dates.
--
-- 3. worker_rates: pay per visit, per day, monthly or none, from
--    effective_on until the next live rate, so a raise leaves past months
--    alone. One live rate per worker and day (ZL059 rate_exists). "none"
--    pays nothing and is also how a worker who left stops earning.
--
-- 4. payroll_adjustments: bonuses and deductions, dated, with a reason.
--
-- 5. worker_days: attendance for daily pay, ticked by an admin per month;
--    A21 offers the days the worker's crew completed an order
--    (admin_worker_crew_days) to tick at once.
--
-- 6. expenses.worker_id: a wage paid to a worker. One worker per expense
--    (three workers paid = three expenses), only on a category of kind
--    wages (ZL057 worker_not_allowed), optional (casual labour stays
--    unlinked). A category paying a worker keeps the kind wages.
--
-- 7. admin_payroll(from, to, worker): per worker and month, earned against
--    paid. Earned counts days from the books' start through today, each
--    under the rate in effect that day: per visit = each completed order
--    of the crew the worker was in on its completion day, covered orders
--    included (the crew did the work), manual sales not; per day = each
--    ticked day; monthly = the salary × the month's days under the rate ÷
--    the days in the month, rounded to the dinar, so a partial month or a
--    mid-month raise is split by calendar days; plus bonuses less
--    deductions. Paid = the live wage expenses linked to the worker. The
--    balance at a month's end = the opening balance + all earned − all paid
--    since the start: above 0 owed, below 0 an advance, which comes off
--    later months by itself (nothing is deducted automatically).
--
-- 8. The reports (A20) don't change: wages count as expenses when paid.
--    Earned pay isn't accrued; a "wages owed" line waits for the balance
--    sheet (task 5).
--
-- 9. Month close: no payroll record dated in a closed month is added,
--    changed or voided. worker_rates, payroll_adjustments and worker_days
--    get the *_refuse_closed trigger (finance_refuse_closed now also checks
--    a delete, for unticking a day); worker_crews gets its own, which
--    refuses a change reaching a day in a closed month (a move on the open
--    month's first day goes through). A worker's opening balance doesn't
--    change while a month is closed (ZL056 books_closed), like the start
--    day. A covered order completed in a closed month now stays completed
--    too (orders_guard_closed_month), since it is a visit for per-visit
--    pay. The start day doesn't move past a ticked day or a live bonus or
--    deduction (ZL046); rates and memberships may start before the books.
--
-- Locks: every payroll writer share-locks the finance_settings row first,
-- then the worker (FOR UPDATE for memberships and days), then the record,
-- so a month close queued between them can't deadlock.
--
-- Access: admins read every table; guests, customers and crews nothing (a
-- crew not even its own workers). Written only by audited security definer
-- RPCs: admin_save_worker, admin_save_worker_crew, admin_move_worker,
-- admin_delete_worker_crew, admin_save_worker_rate /
-- admin_void_worker_rate, admin_save_payroll_adjustment /
-- admin_void_payroll_adjustment, admin_set_worker_days, and
-- admin_save_expense (now with the worker; its signature grows, so it is
-- dropped and made again). Reads: admin_payroll and
-- admin_worker_crew_days (security invoker, 42501 for non-admins).
--
-- New errors: ZL057 worker_not_allowed, ZL058 membership_overlap, ZL059
-- rate_exists; ZL044 also covers worker_inactive.
--
-- Departures from spec §7: none beyond the new tables, which §7 now lists.
-- The planned "earned" is computed, never stored, so it can't drift from
-- the records it comes from.

-- Types ----------------------------------------------------------------------------------

create type public.worker_pay_type as enum ('per_visit', 'per_day', 'monthly', 'none');
create type public.payroll_adjustment_kind as enum ('bonus', 'deduction');

-- workers --------------------------------------------------------------------------------

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 60 and name = btrim(name)),
  phone text check (phone ~ '^\+9647[3-9][0-9]{8}$'),
  note text check (char_length(note) between 1 and 300 and note = btrim(note)),
  -- At the books' start: above 0 the company owed the worker, below 0 the worker held an advance.
  opening_balance_iqd integer not null default 0 check (opening_balance_iqd between -1000000000 and 1000000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workers enable row level security;

create trigger workers_set_updated_at
before update on public.workers
for each row execute function private.set_updated_at();

revoke all on public.workers from anon, authenticated;
grant select on public.workers to authenticated;

create policy "Admins read the workers"
on public.workers
for select
to authenticated
using ((select private.is_admin()));

-- worker_crews ---------------------------------------------------------------------------

create table public.worker_crews (
  id bigint generated always as identity primary key,
  worker_id uuid not null references public.workers (id) on delete restrict,
  crew_id uuid not null references public.crews (id) on delete restrict,
  from_on date not null,
  -- The last day in the crew; null while current.
  to_on date,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_crews_dates_check check (to_on is null or to_on >= from_on)
);

alter table public.worker_crews enable row level security;

create index worker_crews_worker_id_idx on public.worker_crews (worker_id);
create index worker_crews_crew_id_idx on public.worker_crews (crew_id);
create index worker_crews_created_by_idx on public.worker_crews (created_by);

create trigger worker_crews_set_updated_at
before update on public.worker_crews
for each row execute function private.set_updated_at();

revoke all on public.worker_crews from anon, authenticated;
revoke all on sequence public.worker_crews_id_seq from anon, authenticated;
grant select on public.worker_crews to authenticated;

create policy "Admins read the crew memberships"
on public.worker_crews
for select
to authenticated
using ((select private.is_admin()));

-- worker_rates ---------------------------------------------------------------------------

create table public.worker_rates (
  id bigint generated always as identity primary key,
  worker_id uuid not null references public.workers (id) on delete restrict,
  -- From this day until the next live rate.
  effective_on date not null,
  pay_type public.worker_pay_type not null,
  amount_iqd integer not null check (amount_iqd between 0 and 1000000000),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text check (char_length(void_reason) between 1 and 300 and void_reason = btrim(void_reason)),
  constraint worker_rates_amount_check check ((pay_type = 'none') = (amount_iqd = 0)),
  constraint worker_rates_void_check check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

alter table public.worker_rates enable row level security;

create unique index worker_rates_worker_id_effective_on_key
on public.worker_rates (worker_id, effective_on)
where voided_at is null;
create index worker_rates_worker_id_idx on public.worker_rates (worker_id);
create index worker_rates_created_by_idx on public.worker_rates (created_by);
create index worker_rates_voided_by_idx on public.worker_rates (voided_by);

create trigger worker_rates_set_updated_at
before update on public.worker_rates
for each row execute function private.set_updated_at();

revoke all on public.worker_rates from anon, authenticated;
revoke all on sequence public.worker_rates_id_seq from anon, authenticated;
grant select on public.worker_rates to authenticated;

create policy "Admins read the worker rates"
on public.worker_rates
for select
to authenticated
using ((select private.is_admin()));

-- payroll_adjustments --------------------------------------------------------------------

create table public.payroll_adjustments (
  id bigint generated always as identity primary key,
  worker_id uuid not null references public.workers (id) on delete restrict,
  adjusted_on date not null,
  kind public.payroll_adjustment_kind not null,
  amount_iqd integer not null check (amount_iqd between 1 and 1000000000),
  reason text not null check (char_length(reason) between 1 and 300 and reason = btrim(reason)),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text check (char_length(void_reason) between 1 and 300 and void_reason = btrim(void_reason)),
  constraint payroll_adjustments_void_check check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

alter table public.payroll_adjustments enable row level security;

create index payroll_adjustments_worker_id_idx on public.payroll_adjustments (worker_id);
create index payroll_adjustments_adjusted_on_idx on public.payroll_adjustments (adjusted_on);
create index payroll_adjustments_created_by_idx on public.payroll_adjustments (created_by);
create index payroll_adjustments_voided_by_idx on public.payroll_adjustments (voided_by);

create trigger payroll_adjustments_set_updated_at
before update on public.payroll_adjustments
for each row execute function private.set_updated_at();

revoke all on public.payroll_adjustments from anon, authenticated;
revoke all on sequence public.payroll_adjustments_id_seq from anon, authenticated;
grant select on public.payroll_adjustments to authenticated;

create policy "Admins read the bonuses and deductions"
on public.payroll_adjustments
for select
to authenticated
using ((select private.is_admin()));

-- worker_days ----------------------------------------------------------------------------

create table public.worker_days (
  worker_id uuid not null references public.workers (id) on delete restrict,
  worked_on date not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (worker_id, worked_on)
);

alter table public.worker_days enable row level security;

create index worker_days_worked_on_idx on public.worker_days (worked_on);
create index worker_days_created_by_idx on public.worker_days (created_by);

revoke all on public.worker_days from anon, authenticated;
grant select on public.worker_days to authenticated;

create policy "Admins read the days worked"
on public.worker_days
for select
to authenticated
using ((select private.is_admin()));

-- expenses.worker_id ---------------------------------------------------------------------

alter table public.expenses add column worker_id uuid references public.workers (id) on delete restrict;

create index expenses_worker_id_idx on public.expenses (worker_id);

-- Month close ----------------------------------------------------------------------------

-- As in migration finance_reports, and a delete now checks the old day
-- (unticking a day worked).
create or replace function private.finance_refuse_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Account deletion blanks these (private.scrub_audit_text); updated_at follows any change.
  v_text constant text[] := array['note', 'reason', 'void_reason', 'updated_at'];
  v_new jsonb;
  v_old jsonb;
  v_new_day date;
  v_old_day date;
begin
  if tg_op = 'DELETE' then
    if private.finance_month_closed((to_jsonb(old) ->> tg_argv[0])::date) then
      raise exception using errcode = 'ZL054', message = 'month_closed';
    end if;
    return old;
  end if;
  v_new := to_jsonb(new);
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

create trigger worker_rates_refuse_closed
before insert or update on public.worker_rates
for each row execute function private.finance_refuse_closed('effective_on');

create trigger payroll_adjustments_refuse_closed
before insert or update on public.payroll_adjustments
for each row execute function private.finance_refuse_closed('adjusted_on');

create trigger worker_days_refuse_closed
before insert or delete on public.worker_days
for each row execute function private.finance_refuse_closed('worked_on');

-- A membership decides the days a worker's crew visits count, so a change
-- may not reach a day in a closed month. Closed months come before open
-- ones, so it is enough to check the earliest day the change touches: a
-- new or deleted row from its first day, a moved first day from the
-- earlier of the two, a moved last day from the day after the earlier of
-- the two (an open end counts as the far future).
create function private.worker_crews_refuse_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date;
begin
  if tg_op = 'INSERT' then
    v_day := new.from_on;
  elsif tg_op = 'DELETE' then
    v_day := old.from_on;
  elsif old.worker_id <> new.worker_id or old.crew_id <> new.crew_id then
    v_day := least(old.from_on, new.from_on);
  else
    if old.from_on <> new.from_on then
      v_day := least(old.from_on, new.from_on);
    end if;
    if old.to_on is distinct from new.to_on then
      v_day := least(
        v_day,
        least(coalesce(old.to_on, 'infinity'::date), coalesce(new.to_on, 'infinity'::date)) + 1
      );
    end if;
  end if;
  if private.finance_month_closed(v_day) then
    raise exception using errcode = 'ZL054', message = 'month_closed';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger worker_crews_refuse_closed
before insert or update or delete on public.worker_crews
for each row execute function private.worker_crews_refuse_closed();

-- As in migration finance_reports, for every order in the books: a covered
-- order has no revenue but is a visit for per-visit pay.
create or replace function private.orders_guard_closed_month()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'completed' then
    if old.completed_on >= (select s.start_on from public.finance_settings as s where s.id)
      and private.finance_month_closed(old.completed_on)
    then
      raise exception using errcode = 'ZL054', message = 'month_closed';
    end if;
    new.completed_on := null;
  elsif new.status = 'completed' and private.finance_month_closed(private.baghdad_today()) then
    raise exception using errcode = 'ZL054', message = 'month_closed';
  end if;
  return new;
end;
$$;

-- Helpers --------------------------------------------------------------------------------

-- A worker a record may use; p_new: the record takes the worker now (not
-- kept from before an edit), so they must be switched on. Share lock: a
-- switch-off running now finishes first, or waits for us.
create function private.payroll_check_worker(p_id uuid, p_new boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_active boolean;
begin
  select w.active into v_active from public.workers as w where w.id = p_id for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'worker_not_found';
  end if;
  if p_new and not v_active then
    raise exception using errcode = 'ZL044', message = 'worker_inactive';
  end if;
end;
$$;

-- A membership's days must not cross another of the worker's (the caller
-- holds the worker row FOR UPDATE, so two saves for one worker queue).
create function private.payroll_check_overlap(p_worker_id uuid, p_id bigint, p_from_on date, p_to_on date)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.worker_crews as m
    where m.worker_id = p_worker_id
      and m.id is distinct from p_id
      and daterange(m.from_on, m.to_on, '[]') && daterange(p_from_on, p_to_on, '[]')
  ) then
    raise exception using errcode = 'ZL058', message = 'membership_overlap';
  end if;
end;
$$;

-- admin_save_worker ----------------------------------------------------------------------

-- p_id null: a new worker (no opening balance and switched on unless
-- given). Otherwise every value is given (null keeps the opening balance
-- and the switch).
create function public.admin_save_worker(
  p_id uuid default null,
  p_name text default null,
  p_phone text default null,
  p_note text default null,
  p_opening_balance_iqd integer default null,
  p_active boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.workers;
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
  if p_opening_balance_iqd not between -1000000000 and 1000000000 then
    raise exception using errcode = '22023', message = 'invalid_amount';
  end if;

  -- The settings row first (share), then the worker: the order every finance
  -- writer keeps, so a month close queued between them can't deadlock (code review).
  perform 1 from public.finance_settings as s where s.id for share;
  if p_id is not null then
    select * into v_old from public.workers as w where w.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'worker_not_found';
    end if;
  end if;
  v_opening := coalesce(p_opening_balance_iqd, v_old.opening_balance_iqd, 0);
  v_active := coalesce(p_active, v_old.active, true);

  -- The opening balance holds while a month is closed, like the start day
  -- (share lock: a close running now finishes first, or waits for us).
  if v_opening <> coalesce(v_old.opening_balance_iqd, 0) then
    select s.closed_through into v_closed from public.finance_settings as s where s.id for share;
    if v_closed is not null then
      raise exception using errcode = 'ZL056', message = 'books_closed';
    end if;
  end if;

  if exists (select 1 from public.workers as w where w.name = p_name and w.id is distinct from p_id) then
    raise exception using errcode = 'ZL048', message = 'name_taken';
  end if;

  v_new := jsonb_build_object(
    'name', p_name, 'phone', v_phone, 'note', v_note, 'opening_balance_iqd', v_opening, 'active', v_active
  );
  begin
    if p_id is null then
      insert into public.workers (name, phone, note, opening_balance_iqd, active)
      values (p_name, v_phone, v_note, v_opening, v_active)
      returning id into v_id;
      perform private.log_admin_action('worker.create', 'workers', v_id::text, v_new);
      return v_id;
    end if;

    v_diff := private.audit_changes(
      jsonb_build_object(
        'name', v_old.name, 'phone', v_old.phone, 'note', v_old.note,
        'opening_balance_iqd', v_old.opening_balance_iqd, 'active', v_old.active
      ),
      v_new
    );
    if v_diff <> '{}' then
      update public.workers as w
      set name = p_name, phone = v_phone, note = v_note, opening_balance_iqd = v_opening, active = v_active
      where w.id = p_id;
      perform private.log_admin_action('worker.update', 'workers', p_id::text, v_diff);
    end if;
  exception when unique_violation then
    raise exception using errcode = 'ZL048', message = 'name_taken';
  end;
  return p_id;
end;
$$;

-- admin_save_worker_crew -----------------------------------------------------------------

-- p_id null: a new membership. Otherwise a correction of one (the worker stays).
create function public.admin_save_worker_crew(
  p_id bigint default null,
  p_worker_id uuid default null,
  p_crew_id uuid default null,
  p_from_on date default null,
  p_to_on date default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.worker_crews;
  v_active boolean;
  v_id bigint;
  v_new jsonb;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_from_on is null or p_to_on < p_from_on then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  if greatest(p_from_on, p_to_on) > private.baghdad_today() then
    raise exception using errcode = 'ZL043', message = 'date_in_future';
  end if;

  -- The settings row first (share), then the worker: the order every finance
  -- writer keeps, so a month close queued between them can't deadlock (code review).
  perform 1 from public.finance_settings as s where s.id for share;
  -- Every membership writer locks the worker, then the membership (RLS audit:
  -- the other order deadlocks with admin_move_worker). A row's worker never
  -- changes, so it can be checked before the locks.
  if p_id is not null then
    if not exists (select 1 from public.worker_crews as m where m.id = p_id) then
      raise exception using errcode = 'P0002', message = 'membership_not_found';
    end if;
    if not exists (select 1 from public.worker_crews as m where m.id = p_id and m.worker_id = p_worker_id) then
      raise exception using errcode = '22023', message = 'invalid_target';
    end if;
  end if;

  -- FOR UPDATE: two membership saves for one worker queue, so the overlap check holds.
  select w.active into v_active from public.workers as w where w.id = p_worker_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'worker_not_found';
  end if;
  if p_id is not null then
    select * into v_old from public.worker_crews as m where m.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'membership_not_found';
    end if;
  end if;
  if p_id is null and not v_active then
    raise exception using errcode = 'ZL044', message = 'worker_inactive';
  end if;
  if not exists (select 1 from public.crews as c where c.id = p_crew_id) then
    raise exception using errcode = 'P0002', message = 'crew_not_found';
  end if;
  perform private.payroll_check_overlap(p_worker_id, p_id, p_from_on, p_to_on);

  v_new := jsonb_build_object('worker_id', p_worker_id, 'crew_id', p_crew_id, 'from_on', p_from_on, 'to_on', p_to_on);
  if p_id is null then
    insert into public.worker_crews (worker_id, crew_id, from_on, to_on, created_by)
    values (p_worker_id, p_crew_id, p_from_on, p_to_on, (select auth.uid()))
    returning id into v_id;
    perform private.log_admin_action('worker_crew.create', 'worker_crews', v_id::text, v_new);
    return v_id;
  end if;

  v_diff := private.audit_changes(
    jsonb_build_object('worker_id', v_old.worker_id, 'crew_id', v_old.crew_id, 'from_on', v_old.from_on, 'to_on', v_old.to_on),
    v_new
  );
  if v_diff <> '{}' then
    update public.worker_crews as m
    set crew_id = p_crew_id, from_on = p_from_on, to_on = p_to_on
    where m.id = p_id;
    perform private.log_admin_action(
      'worker_crew.update', 'worker_crews', p_id::text, jsonb_build_object('worker_id', p_worker_id) || v_diff
    );
  end if;
  return p_id;
end;
$$;

-- admin_move_worker ----------------------------------------------------------------------

-- From p_on the worker is in p_crew_id (null: in no crew). The current
-- membership ends the day before.
create function public.admin_move_worker(p_worker_id uuid, p_crew_id uuid, p_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
  v_current public.worker_crews;
  v_id bigint;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_on is null then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  if p_on > private.baghdad_today() then
    raise exception using errcode = 'ZL043', message = 'date_in_future';
  end if;

  -- The settings row first (share), then the worker: the order every finance
  -- writer keeps, so a month close queued between them can't deadlock (code review).
  perform 1 from public.finance_settings as s where s.id for share;
  select w.active into v_active from public.workers as w where w.id = p_worker_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'worker_not_found';
  end if;
  if p_crew_id is not null then
    if not v_active then
      raise exception using errcode = 'ZL044', message = 'worker_inactive';
    end if;
    if not exists (select 1 from public.crews as c where c.id = p_crew_id) then
      raise exception using errcode = 'P0002', message = 'crew_not_found';
    end if;
  end if;

  select * into v_current from public.worker_crews as m
  where m.worker_id = p_worker_id and m.to_on is null
  for update;
  if found then
    if v_current.crew_id = p_crew_id then
      raise exception using errcode = '22023', message = 'same_crew';
    end if;
    if v_current.from_on >= p_on then
      raise exception using errcode = '22023', message = 'invalid_date';
    end if;
    update public.worker_crews as m set to_on = p_on - 1 where m.id = v_current.id;
    perform private.log_admin_action(
      'worker_crew.update', 'worker_crews', v_current.id::text,
      jsonb_build_object('worker_id', p_worker_id, 'to_on', jsonb_build_object('from', null, 'to', p_on - 1))
    );
  elsif p_crew_id is null then
    raise exception using errcode = 'P0002', message = 'membership_not_found';
  end if;

  if p_crew_id is not null then
    perform private.payroll_check_overlap(p_worker_id, null, p_on, null);
    insert into public.worker_crews (worker_id, crew_id, from_on, created_by)
    values (p_worker_id, p_crew_id, p_on, (select auth.uid()))
    returning id into v_id;
    perform private.log_admin_action(
      'worker_crew.create', 'worker_crews', v_id::text,
      jsonb_build_object('worker_id', p_worker_id, 'crew_id', p_crew_id, 'from_on', p_on, 'to_on', null)
    );
  end if;
end;
$$;

-- admin_delete_worker_crew ---------------------------------------------------------------

-- A membership entered by mistake.
create function public.admin_delete_worker_crew(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.worker_crews;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  -- The settings row first (share), then the worker: the order every finance
  -- writer keeps, so a month close queued between them can't deadlock (code review).
  perform 1 from public.finance_settings as s where s.id for share;
  -- The worker first, then the membership, as every membership writer does.
  perform 1 from public.workers as w
  where w.id = (select m.worker_id from public.worker_crews as m where m.id = p_id)
  for update;
  select * into v_old from public.worker_crews as m where m.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'membership_not_found';
  end if;
  delete from public.worker_crews as m where m.id = p_id;
  perform private.log_admin_action(
    'worker_crew.delete', 'worker_crews', p_id::text,
    jsonb_build_object('worker_id', v_old.worker_id, 'crew_id', v_old.crew_id, 'from_on', v_old.from_on, 'to_on', v_old.to_on)
  );
end;
$$;

-- admin_save_worker_rate -----------------------------------------------------------------

-- p_id null: a new rate. Otherwise a correction (the worker stays). "none" takes no amount.
create function public.admin_save_worker_rate(
  p_id bigint default null,
  p_worker_id uuid default null,
  p_effective_on date default null,
  p_pay_type public.worker_pay_type default null,
  p_amount_iqd integer default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.worker_rates;
  v_amount integer := p_amount_iqd;
  v_id bigint;
  v_new jsonb;
  v_diff jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_effective_on is null then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  if p_effective_on > private.baghdad_today() then
    raise exception using errcode = 'ZL043', message = 'date_in_future';
  end if;
  if p_pay_type is null then
    raise exception using errcode = '22023', message = 'invalid_pay_type';
  end if;
  if p_pay_type = 'none' then
    v_amount := coalesce(v_amount, 0);
    if v_amount <> 0 then
      raise exception using errcode = '22023', message = 'invalid_amount';
    end if;
  else
    perform private.finance_check_amount(v_amount);
  end if;

  -- The settings row first (share), then the worker: the order every finance
  -- writer keeps, so a month close queued between them can't deadlock (code review).
  perform 1 from public.finance_settings as s where s.id for share;
  if p_id is not null then
    select * into v_old from public.worker_rates as r where r.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'rate_not_found';
    end if;
    if v_old.voided_at is not null then
      raise exception using errcode = 'ZL047', message = 'record_voided';
    end if;
    if p_worker_id is distinct from v_old.worker_id then
      raise exception using errcode = '22023', message = 'invalid_target';
    end if;
  end if;
  perform private.payroll_check_worker(p_worker_id, p_id is null);
  if exists (
    select 1 from public.worker_rates as r
    where r.worker_id = p_worker_id and r.effective_on = p_effective_on
      and r.voided_at is null and r.id is distinct from p_id
  ) then
    raise exception using errcode = 'ZL059', message = 'rate_exists';
  end if;

  v_new := jsonb_build_object(
    'worker_id', p_worker_id, 'effective_on', p_effective_on, 'pay_type', p_pay_type, 'amount_iqd', v_amount
  );
  begin
    if p_id is null then
      insert into public.worker_rates (worker_id, effective_on, pay_type, amount_iqd, created_by)
      values (p_worker_id, p_effective_on, p_pay_type, v_amount, (select auth.uid()))
      returning id into v_id;
      perform private.log_admin_action('worker_rate.create', 'worker_rates', v_id::text, v_new);
      return v_id;
    end if;

    v_diff := private.audit_changes(
      jsonb_build_object(
        'worker_id', v_old.worker_id, 'effective_on', v_old.effective_on,
        'pay_type', v_old.pay_type, 'amount_iqd', v_old.amount_iqd
      ),
      v_new
    );
    if v_diff <> '{}' then
      update public.worker_rates as r
      set effective_on = p_effective_on, pay_type = p_pay_type, amount_iqd = v_amount
      where r.id = p_id;
      perform private.log_admin_action(
        'worker_rate.update', 'worker_rates', p_id::text, jsonb_build_object('worker_id', p_worker_id) || v_diff
      );
    end if;
  exception when unique_violation then
    -- Another rate took the day a moment ago.
    raise exception using errcode = 'ZL059', message = 'rate_exists';
  end;
  return p_id;
end;
$$;

-- admin_void_worker_rate -----------------------------------------------------------------

create function public.admin_void_worker_rate(p_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.worker_rates;
  v_reason text;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_reason := private.void_reason(p_reason);
  -- The settings row first (share), then the worker: the order every finance
  -- writer keeps, so a month close queued between them can't deadlock (code review).
  perform 1 from public.finance_settings as s where s.id for share;
  select * into v_old from public.worker_rates as r where r.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'rate_not_found';
  end if;
  if v_old.voided_at is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;
  update public.worker_rates as r
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where r.id = p_id;
  perform private.log_admin_action(
    'worker_rate.void', 'worker_rates', p_id::text,
    jsonb_build_object(
      'worker_id', v_old.worker_id, 'effective_on', v_old.effective_on,
      'amount_iqd', v_old.amount_iqd, 'reason', v_reason
    )
  );
end;
$$;

-- admin_save_payroll_adjustment ----------------------------------------------------------

-- p_id null: a new bonus or deduction. Otherwise a correction (the worker stays).
create function public.admin_save_payroll_adjustment(
  p_id bigint default null,
  p_worker_id uuid default null,
  p_adjusted_on date default null,
  p_kind public.payroll_adjustment_kind default null,
  p_amount_iqd integer default null,
  p_reason text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.payroll_adjustments;
  v_reason text;
  v_id bigint;
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
  v_reason := private.void_reason(p_reason);
  perform private.finance_check_day(p_adjusted_on);

  if p_id is not null then
    select * into v_old from public.payroll_adjustments as a where a.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'adjustment_not_found';
    end if;
    if v_old.voided_at is not null then
      raise exception using errcode = 'ZL047', message = 'record_voided';
    end if;
    if p_worker_id is distinct from v_old.worker_id then
      raise exception using errcode = '22023', message = 'invalid_target';
    end if;
  end if;
  perform private.payroll_check_worker(p_worker_id, p_id is null);

  v_new := jsonb_build_object(
    'worker_id', p_worker_id, 'adjusted_on', p_adjusted_on, 'kind', p_kind,
    'amount_iqd', p_amount_iqd, 'reason', v_reason
  );
  if p_id is null then
    insert into public.payroll_adjustments (worker_id, adjusted_on, kind, amount_iqd, reason, created_by)
    values (p_worker_id, p_adjusted_on, p_kind, p_amount_iqd, v_reason, (select auth.uid()))
    returning id into v_id;
    perform private.log_admin_action('payroll_adjustment.create', 'payroll_adjustments', v_id::text, v_new);
    return v_id;
  end if;

  v_diff := private.audit_changes(
    jsonb_build_object(
      'worker_id', v_old.worker_id, 'adjusted_on', v_old.adjusted_on, 'kind', v_old.kind,
      'amount_iqd', v_old.amount_iqd, 'reason', v_old.reason
    ),
    v_new
  );
  if v_diff <> '{}' then
    update public.payroll_adjustments as a
    set adjusted_on = p_adjusted_on, kind = p_kind, amount_iqd = p_amount_iqd, reason = v_reason
    where a.id = p_id;
    perform private.log_admin_action(
      'payroll_adjustment.update', 'payroll_adjustments', p_id::text,
      jsonb_build_object('worker_id', p_worker_id) || v_diff
    );
  end if;
  return p_id;
end;
$$;

-- admin_void_payroll_adjustment ----------------------------------------------------------

create function public.admin_void_payroll_adjustment(p_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.payroll_adjustments;
  v_reason text;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  v_reason := private.void_reason(p_reason);
  -- The settings row first (share), then the worker: the order every finance
  -- writer keeps, so a month close queued between them can't deadlock (code review).
  perform 1 from public.finance_settings as s where s.id for share;
  select * into v_old from public.payroll_adjustments as a where a.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'adjustment_not_found';
  end if;
  if v_old.voided_at is not null then
    raise exception using errcode = 'ZL047', message = 'record_voided';
  end if;
  update public.payroll_adjustments as a
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where a.id = p_id;
  perform private.log_admin_action(
    'payroll_adjustment.void', 'payroll_adjustments', p_id::text,
    jsonb_build_object(
      'worker_id', v_old.worker_id, 'adjusted_on', v_old.adjusted_on,
      'amount_iqd', v_old.amount_iqd, 'reason', v_reason
    )
  );
end;
$$;

-- admin_set_worker_days ------------------------------------------------------------------

-- The month's ticked days become exactly p_days.
create function public.admin_set_worker_days(p_worker_id uuid, p_month date, p_days date[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_days date[];
  v_day date;
  v_active boolean;
  v_added date[];
  v_removed date[];
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if v_month is null then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  -- The settings row first (share), then the worker: the order every finance
  -- writer keeps, so a month close queued between them can't deadlock (code review).
  perform 1 from public.finance_settings as s where s.id for share;
  v_days := array(select distinct d from unnest(coalesce(p_days, '{}')) as d order by d);
  foreach v_day in array v_days loop
    perform private.finance_check_day(v_day);
    if date_trunc('month', v_day)::date <> v_month then
      raise exception using errcode = '22023', message = 'invalid_date';
    end if;
  end loop;

  select w.active into v_active from public.workers as w where w.id = p_worker_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'worker_not_found';
  end if;

  v_added := array(
    select d from unnest(v_days) as d
    where not exists (select 1 from public.worker_days as x where x.worker_id = p_worker_id and x.worked_on = d)
    order by d
  );
  v_removed := array(
    select x.worked_on from public.worker_days as x
    where x.worker_id = p_worker_id
      and x.worked_on >= v_month and x.worked_on < (v_month + interval '1 month')::date
      and x.worked_on <> all (v_days)
    order by x.worked_on
  );
  if cardinality(v_added) > 0 and not v_active then
    raise exception using errcode = 'ZL044', message = 'worker_inactive';
  end if;
  if cardinality(v_added) = 0 and cardinality(v_removed) = 0 then
    return;
  end if;

  delete from public.worker_days as x where x.worker_id = p_worker_id and x.worked_on = any (v_removed);
  insert into public.worker_days (worker_id, worked_on, created_by)
  select p_worker_id, d, (select auth.uid()) from unnest(v_added) as d;
  perform private.log_admin_action(
    'worker_days.update', 'workers', p_worker_id::text,
    jsonb_build_object('month', v_month, 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed))
  );
end;
$$;

-- admin_save_expense: with the worker it pays --------------------------------------------

drop function public.admin_save_expense(uuid, date, bigint, uuid, integer, text);

-- p_id null: a new expense. Every value is given each time (the form sends
-- them all); p_worker_id only on a wages category.
create function public.admin_save_expense(
  p_id uuid default null,
  p_spent_on date default null,
  p_category_id bigint default null,
  p_account_id uuid default null,
  p_amount_iqd integer default null,
  p_note text default null,
  p_worker_id uuid default null
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
  if p_worker_id is not null then
    -- The category is share-locked above, so its kind can't change meanwhile.
    if (select c.kind from public.expense_categories as c where c.id = p_category_id) <> 'wages' then
      raise exception using errcode = 'ZL057', message = 'worker_not_allowed';
    end if;
    -- A switched-off worker is still paid what they're owed (code review): only
    -- that the worker exists is checked.
    perform private.payroll_check_worker(p_worker_id, false);
  end if;

  v_new := jsonb_build_object(
    'spent_on', p_spent_on, 'category_id', p_category_id, 'account_id', p_account_id,
    'amount_iqd', p_amount_iqd, 'note', v_note
  );

  if p_id is null then
    insert into public.expenses (spent_on, category_id, account_id, amount_iqd, note, worker_id, created_by)
    values (p_spent_on, p_category_id, p_account_id, p_amount_iqd, v_note, p_worker_id, (select auth.uid()))
    returning id into v_id;
    perform private.log_admin_action(
      'expense.create', 'expenses', v_id::text,
      v_new || case when p_worker_id is not null then jsonb_build_object('worker_id', p_worker_id) else '{}' end
    );
    return v_id;
  end if;

  v_diff := private.audit_changes(
    jsonb_build_object(
      'spent_on', v_old.spent_on, 'category_id', v_old.category_id, 'account_id', v_old.account_id,
      'amount_iqd', v_old.amount_iqd, 'note', v_old.note, 'worker_id', v_old.worker_id
    ),
    v_new || jsonb_build_object('worker_id', p_worker_id)
  );
  if v_diff <> '{}' then
    update public.expenses as e
    set spent_on = p_spent_on, category_id = p_category_id, account_id = p_account_id,
      amount_iqd = p_amount_iqd, note = v_note, worker_id = p_worker_id
    where e.id = p_id;
    perform private.log_admin_action('expense.update', 'expenses', p_id::text, v_diff);
  end if;
  return p_id;
end;
$$;

-- admin_save_expense_category: a category paying a worker stays wages ---------------------

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

-- admin_update_finance_settings: payroll records hold the start day ----------------------

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

-- Reads (admins only) --------------------------------------------------------------------

-- The days in p_month the worker's crew completed an order while the
-- worker was in it, from the books' start through today: A21 offers them
-- to tick.
create function public.admin_worker_crew_days(p_worker_id uuid, p_month date)
returns setof date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if v_month is null then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  return query
  select distinct o.completed_on
  from public.orders as o
  join public.worker_crews as m
    on m.crew_id = o.crew_id
    and o.completed_on >= m.from_on
    and (m.to_on is null or o.completed_on <= m.to_on)
  where m.worker_id = p_worker_id
    and o.status = 'completed'
    and o.completed_on >= greatest(v_month, (select s.start_on from public.finance_settings as s where s.id))
    and o.completed_on < (v_month + interval '1 month')::date
    and o.completed_on <= (now() at time zone 'Asia/Baghdad')::date
  order by 1;
end;
$$;

-- One row per worker and month from p_from's month through p_to's (at most
-- 24): what they earned and were paid, and their balance at the month's
-- end (above 0 owed, below 0 an advance). crew_id, pay_type and rate_iqd
-- are as on the month's last counted day (its end, or today); visits and
-- days are the month's activity, whatever the rate.
create function public.admin_payroll(p_from date, p_to date, p_worker_id uuid default null)
returns table (
  month date,
  worker_id uuid,
  crew_id uuid,
  pay_type public.worker_pay_type,
  rate_iqd integer,
  visits integer,
  days integer,
  base_iqd bigint,
  bonuses_iqd bigint,
  deductions_iqd bigint,
  earned_iqd bigint,
  paid_iqd bigint,
  balance_iqd bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_first date;
  v_last date;
  v_last_end date;
  v_start date;
  v_today date := (now() at time zone 'Asia/Baghdad')::date;
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
  v_last_end := (v_last + interval '1 month' - interval '1 day')::date;
  select s.start_on into v_start from public.finance_settings as s where s.id;

  return query
  with
  -- Every month from the books' start (for the running balance) through to's.
  months as (
    select g::date as m, (g + interval '1 month' - interval '1 day')::date as m_end
    from generate_series(least(v_first, date_trunc('month', v_start)::date), v_last, interval '1 month') as g
  ),
  -- The days of each month that count: from the start through today.
  spans as (
    select x.m, x.m_end, greatest(x.m, v_start) as lo, least(x.m_end, v_today) as hi
    from months as x
  ),
  ws as (
    select w.id, w.opening_balance_iqd
    from public.workers as w
    where p_worker_id is null or w.id = p_worker_id
  ),
  rates as (
    select r.worker_id, r.pay_type, r.amount_iqd, r.effective_on as r_from,
      coalesce(
        lead(r.effective_on) over (partition by r.worker_id order by r.effective_on) - 1,
        'infinity'::date
      ) as r_to
    from public.worker_rates as r
    join ws on ws.id = r.worker_id
    where r.voided_at is null
  ),
  salary as (
    select r.worker_id, s.m,
      sum(round(
        r.amount_iqd::numeric * (least(r.r_to, s.hi) - greatest(r.r_from, s.lo) + 1)
        / extract(day from s.m_end)
      )) as amount
    from rates as r
    join spans as s on s.lo <= s.hi and r.r_from <= s.hi and r.r_to >= s.lo
    where r.pay_type = 'monthly'
    group by 1, 2
  ),
  visit_rows as (
    select wc.worker_id, date_trunc('month', o.completed_on)::date as m, r.pay_type, r.amount_iqd
    from public.orders as o
    join public.worker_crews as wc
      on wc.crew_id = o.crew_id
      and o.completed_on >= wc.from_on
      and (wc.to_on is null or o.completed_on <= wc.to_on)
    join ws on ws.id = wc.worker_id
    left join rates as r on r.worker_id = wc.worker_id and o.completed_on between r.r_from and r.r_to
    where o.status = 'completed' and o.completed_on >= v_start and o.completed_on <= least(v_today, v_last_end)
  ),
  day_rows as (
    select d.worker_id, date_trunc('month', d.worked_on)::date as m, r.pay_type, r.amount_iqd
    from public.worker_days as d
    join ws on ws.id = d.worker_id
    left join rates as r on r.worker_id = d.worker_id and d.worked_on between r.r_from and r.r_to
    where d.worked_on >= v_start and d.worked_on <= least(v_today, v_last_end)
  ),
  activity as (
    select a.worker_id, a.m,
      count(*) filter (where a.src = 'visit')::int as visits,
      count(*) filter (where a.src = 'day')::int as days,
      coalesce(sum(a.amount_iqd) filter (
        where (a.src = 'visit' and a.pay_type = 'per_visit') or (a.src = 'day' and a.pay_type = 'per_day')
      ), 0) as amount
    from (
      select 'visit' as src, v.* from visit_rows as v
      union all
      select 'day' as src, d.* from day_rows as d
    ) as a
    group by 1, 2
  ),
  adjustments as (
    select a.worker_id, date_trunc('month', a.adjusted_on)::date as m,
      coalesce(sum(a.amount_iqd) filter (where a.kind = 'bonus'), 0) as bonuses,
      coalesce(sum(a.amount_iqd) filter (where a.kind = 'deduction'), 0) as deductions
    from public.payroll_adjustments as a
    join ws on ws.id = a.worker_id
    where a.voided_at is null and a.adjusted_on <= v_last_end
    group by 1, 2
  ),
  paid as (
    select e.worker_id, date_trunc('month', e.spent_on)::date as m, sum(e.amount_iqd) as total
    from public.expenses as e
    join ws on ws.id = e.worker_id
    where e.voided_at is null and e.spent_on <= v_last_end
    group by 1, 2
  ),
  grid as (
    select x.m, x.m_end, ws.id as w, ws.opening_balance_iqd as opening,
      coalesce(sa.amount, 0) + coalesce(ac.amount, 0) as base,
      coalesce(ac.visits, 0) as visits,
      coalesce(ac.days, 0) as days,
      coalesce(ad.bonuses, 0) as bonuses,
      coalesce(ad.deductions, 0) as deductions,
      coalesce(p.total, 0) as paid
    from months as x
    cross join ws
    left join salary as sa on sa.worker_id = ws.id and sa.m = x.m
    left join activity as ac on ac.worker_id = ws.id and ac.m = x.m
    left join adjustments as ad on ad.worker_id = ws.id and ad.m = x.m
    left join paid as p on p.worker_id = ws.id and p.m = x.m
  ),
  running as (
    select g.*,
      g.base + g.bonuses - g.deductions as earned,
      g.opening + sum(g.base + g.bonuses - g.deductions - g.paid) over (partition by g.w order by g.m) as balance
    from grid as g
  )
  select
    r.m,
    r.w,
    (
      select wc.crew_id from public.worker_crews as wc
      where wc.worker_id = r.w
        and wc.from_on <= least(r.m_end, v_today)
        and (wc.to_on is null or wc.to_on >= least(r.m_end, v_today))
      limit 1
    ),
    rt.pay_type,
    rt.amount_iqd,
    r.visits,
    r.days,
    r.base::bigint,
    r.bonuses::bigint,
    r.deductions::bigint,
    r.earned::bigint,
    r.paid::bigint,
    r.balance::bigint
  from running as r
  left join lateral (
    select x.pay_type, x.amount_iqd from rates as x
    where x.worker_id = r.w and least(r.m_end, v_today) between x.r_from and x.r_to
    limit 1
  ) as rt on true
  where r.m >= v_first
  order by r.m, r.w;
end;
$$;

-- Access ---------------------------------------------------------------------------------

revoke execute on function public.admin_save_worker(uuid, text, text, text, integer, boolean) from public, anon;
grant execute on function public.admin_save_worker(uuid, text, text, text, integer, boolean) to authenticated;
revoke execute on function public.admin_save_worker_crew(bigint, uuid, uuid, date, date) from public, anon;
grant execute on function public.admin_save_worker_crew(bigint, uuid, uuid, date, date) to authenticated;
revoke execute on function public.admin_move_worker(uuid, uuid, date) from public, anon;
grant execute on function public.admin_move_worker(uuid, uuid, date) to authenticated;
revoke execute on function public.admin_delete_worker_crew(bigint) from public, anon;
grant execute on function public.admin_delete_worker_crew(bigint) to authenticated;
revoke execute on function public.admin_save_worker_rate(bigint, uuid, date, public.worker_pay_type, integer)
from public, anon;
grant execute on function public.admin_save_worker_rate(bigint, uuid, date, public.worker_pay_type, integer)
to authenticated;
revoke execute on function public.admin_void_worker_rate(bigint, text) from public, anon;
grant execute on function public.admin_void_worker_rate(bigint, text) to authenticated;
revoke execute on function public.admin_save_payroll_adjustment(
  bigint, uuid, date, public.payroll_adjustment_kind, integer, text
) from public, anon;
grant execute on function public.admin_save_payroll_adjustment(
  bigint, uuid, date, public.payroll_adjustment_kind, integer, text
) to authenticated;
revoke execute on function public.admin_void_payroll_adjustment(bigint, text) from public, anon;
grant execute on function public.admin_void_payroll_adjustment(bigint, text) to authenticated;
revoke execute on function public.admin_set_worker_days(uuid, date, date[]) from public, anon;
grant execute on function public.admin_set_worker_days(uuid, date, date[]) to authenticated;
revoke execute on function public.admin_save_expense(uuid, date, bigint, uuid, integer, text, uuid) from public, anon;
grant execute on function public.admin_save_expense(uuid, date, bigint, uuid, integer, text, uuid) to authenticated;
revoke execute on function public.admin_worker_crew_days(uuid, date) from public, anon;
grant execute on function public.admin_worker_crew_days(uuid, date) to authenticated;
revoke execute on function public.admin_payroll(date, date, uuid) from public, anon;
grant execute on function public.admin_payroll(date, date, uuid) to authenticated;

revoke execute on all functions in schema private from public;
