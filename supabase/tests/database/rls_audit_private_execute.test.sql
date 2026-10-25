-- RLS audit: EXECUTE on functions in `private`, and leftover default grants.
--
-- Postgres makes every new function executable by PUBLIC, and a per-schema
-- `alter default privileges … revoke` can't remove that. So each migration
-- that adds private functions revokes them from PUBLIC and grants back only
-- the role helpers policies call. This test fails as soon as a migration
-- forgets, because then any logged-in user (authenticated has USAGE on
-- `private`) could run the function, security definer ones included.
begin;
\ir _helpers.psql

select plan(4);

select is(
  (
    select array_agg(p.proname::text order by p.proname)
    from pg_proc as p
    where p.pronamespace = 'private'::regnamespace
      and has_function_privilege('public', p.oid, 'execute')
  ),
  null::text[],
  'no private function is executable by PUBLIC'
);

select ok(
  not has_function_privilege('authenticated', 'private.handle_new_user()', 'execute'),
  'authenticated cannot execute the security definer signup trigger function'
);

select is(
  (
    select array_agg(p.proname::text order by p.proname)
    from pg_proc as p
    where p.pronamespace = 'private'::regnamespace
      and has_function_privilege('authenticated', p.oid, 'execute')
  ),
  array['current_crew_id', 'current_user_role', 'is_admin'],
  'authenticated can execute only the role helpers'
);

-- Supabase also grants anon and authenticated every privilege on new
-- sequences, including setval.
select is(
  (
    select array_agg(c.relname::text order by c.relname)
    from pg_class as c
    where c.relkind = 'S'
      and c.relnamespace = 'public'::regnamespace
      and (
        has_sequence_privilege('anon', c.oid, 'usage, select, update')
        or has_sequence_privilege('authenticated', c.oid, 'usage, select, update')
      )
  ),
  null::text[],
  'anon and authenticated have no privileges on public sequences'
);

select * from finish();
rollback;
