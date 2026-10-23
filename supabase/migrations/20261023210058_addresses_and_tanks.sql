-- Addresses and tanks (spec §5.4, N2, N3, §7, decisions 16-17).
--
-- Departures from spec §7:
-- - addresses store lat/lng, and `location` is generated from them. The app
--   reads and writes plain numbers instead of PostGIS binary; spatial queries
--   use `location`.
-- - "Unique (user_id, label)" and "one default" are partial unique indexes
--   over live rows, so deleting an address frees its label.
-- - Deleting is a soft delete through delete_address(), which also moves the
--   default and removes the address's tanks. Customers can't set deleted_at
--   themselves, and their reads never see deleted rows. Orders (Phase 2)
--   snapshot the address, so history doesn't need the row to stay visible.
-- - tanks reference (address_id, user_id) together, so a tank can't sit on
--   someone else's address even if a policy were wrong.
-- - Only customers save addresses and tanks. Crews see the addresses of
--   their assigned orders through orders (Phase 2/3).

-- Addresses ------------------------------------------------------------------

create type public.address_label as enum ('home', 'family', 'work');

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  label public.address_label not null,
  -- Free text, as designed (spec §13 "Districts", settled Oct 23, 2026).
  district text not null check (char_length(district) between 2 and 60 and district = btrim(district)),
  landmark text not null check (char_length(landmark) between 2 and 120 and landmark = btrim(landmark)),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  location extensions.geography(point, 4326) generated always as (
    extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
  ) stored,
  is_default boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of the tanks (address_id, user_id) foreign key.
  unique (id, user_id)
);

alter table public.addresses enable row level security;

create index addresses_user_id_idx on public.addresses (user_id);

-- A label is used once per user (spec §5.4).
create unique index addresses_user_label_key
on public.addresses (user_id, label)
where deleted_at is null;

-- At most one default per user; the trigger below keeps it at exactly one.
create unique index addresses_user_default_key
on public.addresses (user_id)
where is_default and deleted_at is null;

create trigger addresses_set_updated_at
before update on public.addresses
for each row execute function private.set_updated_at();

-- The pin must be inside an active service area (spec §5.4). Checked only
-- when the pin moves, so a later polygon change doesn't lock old addresses.
-- The app maps SQLSTATE ZL001 to "بعد ما نخدم منطقتك".
create function private.check_address_service_area()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.in_service_area(new.lat, new.lng) then
    raise exception using errcode = 'ZL001', message = 'outside_service_area';
  end if;
  return new;
end;
$$;

create trigger addresses_check_service_area
before insert or update of lat, lng on public.addresses
for each row execute function private.check_address_service_area();

-- The first address is the default; marking one default clears the others.
-- Runs as the caller, who may update their own addresses.
create function private.manage_default_address()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and not exists (
    select 1 from public.addresses as a
    where a.user_id = new.user_id and a.deleted_at is null
  ) then
    new.is_default := true;
  end if;

  if new.is_default and (tg_op = 'INSERT' or not old.is_default) then
    update public.addresses as a
    set is_default = false
    where a.user_id = new.user_id
      and a.id <> new.id
      and a.is_default
      and a.deleted_at is null;
  end if;

  return new;
end;
$$;

create trigger addresses_manage_default
before insert or update of is_default on public.addresses
for each row execute function private.manage_default_address();

-- Trigger functions need no EXECUTE grant to fire.
revoke execute on all functions in schema private from public;

revoke all on public.addresses from anon, authenticated;
grant select on public.addresses to authenticated;
grant insert (user_id, label, district, landmark, lat, lng, is_default) on public.addresses to authenticated;
grant update (label, district, landmark, lat, lng, is_default) on public.addresses to authenticated;

create policy "Customers read their live addresses; admins read all"
on public.addresses
for select
to authenticated
using (
  (user_id = (select auth.uid()) and deleted_at is null)
  or (select private.is_admin())
);

create policy "Customers add their own addresses"
on public.addresses
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.current_user_role()) = 'customer'
);

create policy "Customers edit their live addresses"
on public.addresses
for update
to authenticated
using (
  user_id = (select auth.uid())
  and deleted_at is null
  and (select private.current_user_role()) = 'customer'
)
with check (user_id = (select auth.uid()) and deleted_at is null);

-- Tanks ------------------------------------------------------------------------

create type public.tank_type as enum ('roof', 'ground');
-- s = up to 1,000 L, m = 1,000-2,000 L, l = larger (spec §10.2).
create type public.tank_size as enum ('s', 'm', 'l');

create table public.tanks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  address_id uuid not null,
  type public.tank_type not null,
  size public.tank_size not null,
  nickname text check (
    nickname is null or (char_length(nickname) between 1 and 30 and nickname = btrim(nickname))
  ),
  -- Set when an order with this tank completes (spec §6); never by customers.
  last_cleaned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (address_id, user_id) references public.addresses (id, user_id) on delete cascade
);

alter table public.tanks enable row level security;

create index tanks_user_id_idx on public.tanks (user_id);
create index tanks_address_id_user_id_idx on public.tanks (address_id, user_id);

create trigger tanks_set_updated_at
before update on public.tanks
for each row execute function private.set_updated_at();

revoke all on public.tanks from anon, authenticated;
grant select, delete on public.tanks to authenticated;
grant insert (user_id, address_id, type, size, nickname) on public.tanks to authenticated;
grant update (type, size, nickname) on public.tanks to authenticated;

create policy "Customers read their tanks; admins read all"
on public.tanks
for select
to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy "Customers add tanks to their live addresses"
on public.tanks
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.current_user_role()) = 'customer'
  and exists (
    select 1 from public.addresses as a
    where a.id = address_id
      and a.user_id = (select auth.uid())
      and a.deleted_at is null
  )
);

create policy "Customers edit their tanks"
on public.tanks
for update
to authenticated
using (user_id = (select auth.uid()) and (select private.current_user_role()) = 'customer')
with check (user_id = (select auth.uid()));

create policy "Customers delete their tanks"
on public.tanks
for delete
to authenticated
using (user_id = (select auth.uid()) and (select private.current_user_role()) = 'customer');

-- delete_address -------------------------------------------------------------

-- Soft-deletes the caller's address, removes its tanks and, if it was the
-- default, makes the newest remaining address the default. Security definer
-- because customers can't write deleted_at; it acts only on the caller's own
-- live address. Phase 2 adds: refused while an active order uses it (N2).
create function public.delete_address(p_address_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_was_default boolean;
begin
  select a.is_default into v_was_default
  from public.addresses as a
  where a.id = p_address_id and a.user_id = v_user_id and a.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'address_not_found';
  end if;

  delete from public.tanks as t where t.address_id = p_address_id;

  update public.addresses as a
  set deleted_at = now(), is_default = false
  where a.id = p_address_id;

  if v_was_default then
    update public.addresses as a
    set is_default = true
    where a.id = (
      select b.id from public.addresses as b
      where b.user_id = v_user_id and b.deleted_at is null
      order by b.created_at desc, b.id
      limit 1
    );
  end if;
end;
$$;

revoke execute on function public.delete_address(uuid) from public, anon;
grant execute on function public.delete_address(uuid) to authenticated;
