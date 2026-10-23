-- App settings (spec §7 settings keys, A13).
--
-- Departure from spec §7: one row with a typed column per setting, instead of
-- a key/value table with jsonb values. Each setting gets a real type, default
-- and check, and the generated TypeScript types name every field. The cost is
-- a migration for each new setting, which is how settings get added anyway.
-- Later phases add theirs: sterilant_text (Phase 3), support_response_text
-- (Phase 5), subscription_plan (Phase 6).
--
-- Nothing here is secret, so everyone can read the row; guests need
-- sms_enabled on Login and the Terms/Privacy text. Admin edits (A13) come in
-- Phase 3 as an RPC that also writes the admin audit log. Until then the
-- owner changes settings with SQL.

create table public.settings (
  -- Always true: the primary key allows exactly one row.
  id boolean primary key default true check (id),

  -- Login offers SMS only while this is on (spec §5.2, §9.1).
  sms_enabled boolean not null default true,
  -- Support phone in E.164 (N16, certificate footer). Set before launch.
  company_phone text check (company_phone ~ '^\+964[1-9][0-9]{7,9}$'),

  -- Support hours, Baghdad time; days use extract(dow): 0 = Sunday … 6 =
  -- Saturday. Seeded Saturday to Thursday, 9 AM to 9 PM (spec §13).
  working_hours_start time not null default '09:00',
  working_hours_end time not null default '21:00',
  working_days smallint[] not null default '{0,1,2,3,4,6}' check (
    working_days <@ '{0,1,2,3,4,5,6}'::smallint[]
  ),

  -- Home tank status bar and reminders (spec §5.5).
  cleaning_interval_months smallint not null default 6 check (
    cleaning_interval_months between 1 and 24
  ),
  -- Booking (spec §5.9, §6).
  booking_window_days smallint not null default 14 check (booking_window_days between 1 and 60),
  cancel_cutoff_hours smallint not null default 2 check (cancel_cutoff_hours between 0 and 48),
  max_tanks_per_order smallint not null default 6 check (max_tanks_per_order between 1 and 20),

  -- Terms and Privacy pages (N14), Markdown. Placeholder text before launch.
  terms_md text not null default '',
  privacy_md text not null default '',

  -- System states (N16): force update below this version, maintenance screen.
  min_app_version text not null default '0.0.0' check (
    min_app_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  ),
  maintenance_mode boolean not null default false,

  updated_at timestamptz not null default now(),

  constraint settings_working_hours_order check (working_hours_start < working_hours_end)
);

alter table public.settings enable row level security;

create trigger settings_set_updated_at
before update on public.settings
for each row execute function private.set_updated_at();

insert into public.settings default values;

revoke all on public.settings from anon, authenticated;
grant select on public.settings to anon, authenticated;

create policy "Everyone reads settings"
on public.settings
for select
to anon, authenticated
using (true);
