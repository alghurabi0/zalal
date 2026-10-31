-- partner_shares and admin_set_partner_shares (spec §7, §8.3 A22; Phase 7,
-- task 5).
--
-- Each partner's share of the profit, in hundredths of a percent (share_bp,
-- 1–10000), from a month's first day (starts_on) until the next month that
-- has shares. A month's shares total 100% (10000). Admins read them;
-- guests, customers and crews none. Nobody writes the table directly.
--
-- admin_set_partner_shares(month, shares) makes the month's shares exactly
-- shares, a JSON object {partner_id: share_bp}; {} removes the month's set,
-- so the one before applies. Any day names its month. 22023 invalid_shares
-- for a malformed object or a share outside 1–10000, ZL061 shares_total
-- when they don't total 10000, P0002 partner_not_found, ZL044
-- partner_inactive for a switched-off partner, ZL042 before the books'
-- month, ZL043 after this month, ZL054 in a closed month. Logs
-- partner.shares (entity partner_shares, the month) with the set before
-- and after; nothing when nothing changed. The start day doesn't move past
-- a month with shares (ZL046).
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(29);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.month(2) + 4, closed_through = null where s.id;

insert into public.partners (name) values ('أبو علي'), ('أبو حسن'), ('موقوف');
update public.partners set active = false where name = 'موقوف';
insert into tests.ids select name, id from public.partners;

create function tests.shares(p_a int, p_b int) returns jsonb language sql stable
as $$ select jsonb_strip_nulls(jsonb_build_object(tests.id('أبو علي'), p_a, tests.id('أبو حسن'), p_b)) $$;
create function tests.month_set(p_month date) returns jsonb language sql stable security definer
as $$
  select coalesce(jsonb_object_agg(s.partner_id, s.share_bp), '{}')
  from public.partner_shares as s where s.starts_on = p_month
$$;
create function tests.last_log() returns jsonb language sql stable security definer
as $$
  select jsonb_build_object('entity', entity, 'entity_id', entity_id, 'diff', diff)
  from public.admin_audit_log where action = 'partner.shares' order by id desc limit 1
$$;
create function tests.log_count() returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = 'partner.shares' $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.partner_shares'::regclass), 'RLS is on for partner_shares');
select throws_ok(
  format(
    $$ insert into public.partner_shares (starts_on, partner_id, share_bp, created_by) values (%L, %L, 5000, %L) $$,
    tests.month(1) + 3, tests.id('أبو علي'), tests.user_id('+9647504444444')
  ),
  '23514', null, 'shares start on a month''s first day'
);
select throws_ok(
  format(
    $$ insert into public.partner_shares (starts_on, partner_id, share_bp, created_by) values (%L, %L, 10001, %L) $$,
    tests.month(1), tests.id('أبو علي'), tests.user_id('+9647504444444')
  ),
  '23514', null, 'a share is at most 100%'
);

insert into public.partner_shares (starts_on, partner_id, share_bp, created_by)
values (tests.month(2), tests.id('أبو علي'), 10000, tests.user_id('+9647504444444'));

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.partner_shares $$, '42501', null, 'a guest cannot read shares');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.partner_shares $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.partner_shares $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.partner_shares $$, 'nor a crew');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.partner_shares), 1, 'an admin reads them');
select throws_ok(
  $$ delete from public.partner_shares where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, %L) $$, tests.month(1), tests.shares(5000, 5000)),
  '42501', null, 'a guest cannot set shares'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, %L) $$, tests.month(1), tests.shares(5000, 5000)),
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, %L) $$, tests.month(1), tests.shares(5000, 5000)),
  '42501', 'not_allowed', 'nor a crew'
);

-- Set, replace, remove -----------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_set_partner_shares(tests.month(1) + 9, tests.shares(6667, 3333));
select is(tests.month_set(tests.month(1)), tests.shares(6667, 3333), 'an admin sets a month''s shares; any day names its month');
select is(
  tests.last_log(),
  jsonb_build_object(
    'entity', 'partner_shares', 'entity_id', tests.month(1)::text,
    'diff', jsonb_build_object('shares', jsonb_build_object('from', '{}'::jsonb, 'to', tests.shares(6667, 3333)))
  ),
  'logged as partner.shares with the month and the set before and after'
);
select public.admin_set_partner_shares(tests.month(1), tests.shares(5000, 5000));
select is(tests.month_set(tests.month(1)), tests.shares(5000, 5000), 'setting the month again replaces its shares');
select public.admin_set_partner_shares(tests.month(1), tests.shares(5000, 5000));
select is(tests.log_count(), 2, 'a save that changes nothing logs nothing');
select public.admin_set_partner_shares(tests.month(0), tests.shares(10000, null));
select is(tests.month_set(tests.month(0)), tests.shares(10000, null), 'a partner may hold all of it');
select public.admin_set_partner_shares(tests.month(0), '{}');
select is(tests.month_set(tests.month(0)), '{}'::jsonb, 'an empty set removes the month''s shares');

-- Refused sets -------------------------------------------------------------------------------

select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, %L) $$, tests.month(0), tests.shares(6000, 3000)),
  'ZL061', 'shares_total', 'the shares total 100%'
);
select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, %L) $$, tests.month(0), tests.shares(10000, 0)),
  '22023', 'invalid_shares', 'each share is above 0'
);
select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, '{"x": 10000}') $$, tests.month(0)),
  '22023', 'invalid_shares', 'keys are partners'
);
select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, '[10000]') $$, tests.month(0)),
  '22023', 'invalid_shares', 'the set is an object'
);
select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, jsonb_build_object(%L, 10000)) $$, tests.month(0), gen_random_uuid()),
  'P0002', 'partner_not_found', 'a missing partner'
);
select throws_ok(
  format(
    $$ select public.admin_set_partner_shares(%L, jsonb_build_object(%L, 5000, %L, 5000)) $$,
    tests.month(0), tests.id('أبو علي'), tests.id('موقوف')
  ),
  'ZL044', 'partner_inactive', 'a switched-off partner takes no share'
);
select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, %L) $$, tests.month(3), tests.shares(5000, 5000)),
  'ZL042', 'before_finance_start', 'not before the books'' month'
);
select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, %L) $$, (tests.month(0) + interval '1 month')::date, tests.shares(5000, 5000)),
  'ZL043', 'date_in_future', 'nor after this month'
);

-- Month close and the start day ----------------------------------------------------------------

select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(1) - 1 where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_set_partner_shares(%L, %L) $$, tests.month(2), tests.shares(5000, 5000)),
  'ZL054', 'month_closed', 'a closed month''s shares hold'
);
select lives_ok(
  format($$ select public.admin_set_partner_shares(%L, %L) $$, tests.month(1), tests.shares(4000, 6000)),
  'an open month''s shares change'
);

select tests.clear_authentication();
update public.finance_settings as s set closed_through = null where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_update_finance_settings(%L) $$, tests.month(0)),
  'ZL046', 'records_before_start', 'the start day doesn''t move past a month with shares'
);

select * from finish();
rollback;
