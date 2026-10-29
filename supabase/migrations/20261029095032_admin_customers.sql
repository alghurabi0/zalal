-- A6 Customers (spec §8.2; brought into v1 by the owner on Oct 29, 2026):
-- admin_customers(search, sort, limit), the list of customer accounts with
-- how many orders each made.
--
-- One row per live customer account (role customer, not deleted), booked or
-- not, named or not. Crew and admin accounts are left out, also when an
-- admin made orders as a customer before (A14 keeps them). The order count is
-- every order ever made, in any status (settled with the owner on Oct 29,
-- 2026). The district is the default live address's, else the oldest's.
-- `total` is the number of rows matching the search, for the header and
-- "show more"; the page grows by limit, as the other admin lists do.
--
-- A function rather than a PostgREST read because the list sorts by the
-- order count. Security invoker: admins already read profiles, orders and
-- addresses through RLS; the check gives everyone else a clear error. No
-- table, policy or grant changes, so no departure from spec §7.

create function public.admin_customers(
  p_search text default null,
  p_sort text default 'newest',
  p_limit integer default 50
)
returns table (
  id uuid,
  full_name text,
  phone text,
  created_at timestamptz,
  orders_count integer,
  last_order_at timestamptz,
  district text,
  total integer
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_query text := nullif(btrim(p_search), '');
  v_digits text := regexp_replace(
    regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '^(964)?0*', ''
  );
  v_pattern text;
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_sort is null or p_sort not in ('newest', 'most_orders') then
    raise exception using errcode = '22023', message = 'invalid_sort';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'invalid_limit';
  end if;
  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with matched as (
    select p.id, p.full_name, p.phone, p.created_at
    from public.profiles as p
    where p.role = 'customer'
      and p.deleted_at is null
      and (
        v_query is null
        or p.full_name ilike v_pattern
        or (char_length(v_digits) >= 3 and p.phone like '%' || v_digits || '%')
      )
  ),
  counted as (
    select
      m.id,
      m.full_name,
      m.phone,
      m.created_at,
      coalesce(o.n, 0) as orders_count,
      o.last_at as last_order_at,
      count(*) over ()::integer as total
    from matched as m
    left join lateral (
      select count(*)::integer as n, max(r.created_at) as last_at
      from public.orders as r
      where r.customer_id = m.id
    ) as o on true
  ),
  page as (
    select c.*
    from counted as c
    order by
      case when p_sort = 'most_orders' then c.orders_count end desc nulls last,
      c.created_at desc,
      c.id
    limit p_limit
  )
  select
    pg.id,
    pg.full_name,
    pg.phone,
    pg.created_at,
    pg.orders_count,
    pg.last_order_at,
    (
      select a.district from public.addresses as a
      where a.user_id = pg.id and a.deleted_at is null
      order by a.is_default desc, a.created_at, a.id
      limit 1
    ),
    pg.total
  from page as pg
  order by
    case when p_sort = 'most_orders' then pg.orders_count end desc nulls last,
    pg.created_at desc,
    pg.id;
end;
$$;

revoke execute on function public.admin_customers(text, text, integer) from public, anon;
grant execute on function public.admin_customers(text, text, integer) to authenticated;
