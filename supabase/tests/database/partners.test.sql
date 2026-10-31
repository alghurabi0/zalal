-- partners and admin_save_partner (spec §7, §8.3 A22; Phase 7, task 5).
--
-- A partner is a record in the books with no login: a name (unique), an
-- optional phone and note, the capital they held at the books' start
-- (opening_capital_iqd) and a switch. Admins read them; guests, customers
-- and crews none. Nobody writes the table directly.
--
-- admin_save_partner(id, name, phone, note, opening_capital_iqd, active)
-- adds or edits one: 22023 invalid_name / invalid_phone / invalid_amount,
-- ZL048 name_taken, P0002 partner_not_found. The opening capital holds
-- while a month is closed (ZL056 books_closed), like the box and worker
-- opening balances. Logs partner.create / partner.update with what changed,
-- nothing when nothing did.
begin;
\ir _helpers.psql

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;
create function tests.month(n int) returns date language sql stable
as $$ select (date_trunc('month', tests.today()) - make_interval(months => n))::date $$;

select plan(26);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

update public.finance_settings as s set start_on = tests.month(2), closed_through = null where s.id;

insert into public.partners (name) values ('أبو علي');
insert into tests.ids select name, id from public.partners;

create function tests.last_diff(p_action text) returns jsonb language sql stable security definer
as $$ select diff from public.admin_audit_log where action = p_action order by id desc limit 1 $$;
create function tests.log_count(p_action text) returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = p_action $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Structure and reads ------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.partners'::regclass), 'RLS is on for partners');
select throws_ok(
  $$ insert into public.partners (name, opening_capital_iqd) values ('كبير', 2000000000) $$,
  '23514', null, 'the opening capital is bounded'
);

select tests.authenticate_as_anon();
select throws_ok($$ select * from public.partners $$, '42501', null, 'a guest cannot read partners');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select * from public.partners $$, 'a customer reads none');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty($$ select * from public.partners $$, 'nor another customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select * from public.partners $$, 'nor a crew');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.partners), 1, 'an admin reads them');
select throws_ok(
  $$ update public.partners set opening_capital_iqd = 1 where true $$,
  '42501', null, 'but cannot write the table directly'
);

-- Refused callers ----------------------------------------------------------------------------

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_save_partner(null, 'شريك', null, null, 0, null) $$,
  '42501', null, 'a guest cannot add a partner'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_save_partner(null, 'شريك', null, null, 0, null) $$,
  '42501', 'not_allowed', 'nor a customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_save_partner(null, 'شريك', null, null, 0, null) $$,
  '42501', 'not_allowed', 'nor a crew'
);

-- Save and edit ------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.admin_save_partner(null, 'أبو حسن', '+9647701234567', null, 5000000, null) as hasan \gset
select is(
  tests.last_diff('partner.create'),
  jsonb_build_object(
    'name', 'أبو حسن', 'phone', '+9647701234567', 'note', null, 'opening_capital_iqd', 5000000, 'active', true
  ),
  'an admin adds a partner, logged as partner.create'
);
select throws_ok(
  $$ select public.admin_save_partner(null, 'ا', null, null, 0, null) $$,
  '22023', 'invalid_name', 'a name has 2–60 letters'
);
select throws_ok(
  $$ select public.admin_save_partner(null, 'شريك', '0780', null, 0, null) $$,
  '22023', 'invalid_phone', 'a phone is a mobile number'
);
select throws_ok(
  $$ select public.admin_save_partner(null, 'شريك', null, null, 2000000000, null) $$,
  '22023', 'invalid_amount', 'the opening capital is bounded'
);
select throws_ok(
  $$ select public.admin_save_partner(null, 'أبو علي', null, null, 0, null) $$,
  'ZL048', 'name_taken', 'names are unique'
);
select public.admin_save_partner(:'hasan', 'أبو حسن', '+9647701234567', 'شريك مؤسس', 5000000, false);
select is(
  tests.last_diff('partner.update'),
  jsonb_build_object(
    'note', jsonb_build_object('from', null, 'to', 'شريك مؤسس'),
    'active', jsonb_build_object('from', true, 'to', false)
  ),
  'an edit logs only what changed'
);
select public.admin_save_partner(:'hasan', 'أبو حسن', '+9647701234567', 'شريك مؤسس', 5000000, false);
select is(tests.log_count('partner.update'), 1, 'a save that changes nothing logs nothing');
-- A partner holding a share this month stays switched on until new shares.
select tests.clear_authentication();
insert into public.partner_shares (starts_on, partner_id, share_bp, created_by)
values (tests.month(1), tests.id('أبو علي'), 10000, tests.user_id('+9647504444444'));
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_save_partner(%L, 'أبو علي', null, null, 0, false) $$, tests.id('أبو علي')),
  'ZL063', 'partner_has_share', 'a partner with a share in force stays switched on'
);
select tests.clear_authentication();
delete from public.partner_shares where true;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select lives_ok(
  format($$ select public.admin_save_partner(%L, 'أبو علي', null, null, 0, false) $$, tests.id('أبو علي')),
  'and is switched off once the shares leave them out'
);
select throws_ok(
  $$ select public.admin_save_partner(gen_random_uuid(), 'شريك', null, null, 0, null) $$,
  'P0002', 'partner_not_found', 'a missing partner'
);

-- Month close ----------------------------------------------------------------------------------

select tests.clear_authentication();
update public.finance_settings as s set closed_through = tests.month(1) - 1 where s.id;
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  format($$ select public.admin_save_partner(%L, 'أبو حسن', null, null, 6000000, null) $$, :'hasan'),
  'ZL056', 'books_closed', 'the opening capital holds while a month is closed'
);
select throws_ok(
  $$ select public.admin_save_partner(null, 'شريك جديد', null, null, 1000, null) $$,
  'ZL056', 'books_closed', 'so a new partner starts with none'
);
select lives_ok(
  format($$ select public.admin_save_partner(%L, 'أبو حسن الكبير', null, null, 5000000, null) $$, :'hasan'),
  'the rest of a partner still changes'
);
select isnt(
  (select public.admin_save_partner(null, 'شريك ثاني', null, null, 0, null)), null,
  'and a partner with no opening capital is added'
);
select is(
  (select opening_capital_iqd from public.partners where id = :'hasan'), 5000000,
  'the opening capital kept its value'
);

select * from finish();
rollback;
