-- A second company phone and the certificate stamp image (spec §7 settings,
-- §8.2 A13, §10.1). company_phone_2 is an optional E.164 number like
-- company_phone, never the same as it, saved through admin_update_settings.
-- certificate_stamp_path names an image in public-content/stamp/ and changes
-- only through admin_set_certificate_stamp(path), which admin_update_settings
-- refuses (22023 unknown_setting). The new image must be the admin's own
-- finished upload in stamp/, at most 48 h old (ZL009 upload_not_found). The
-- RPC returns the image it replaced or removed, which the server deletes, and
-- logs 'settings.update' only when the path changes. Admins only (42501).
begin;
\ir _helpers.psql

select plan(31);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_user('+9647505555555', 'admin');   -- another admin
select tests.create_crew('+9647703333333');

update public.settings
set company_phone = '+9647764349984', company_phone_2 = null, certificate_stamp_path = null;

create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;
create function tests.audit_rows() returns int language sql stable security definer
as $$ select count(*)::int from public.admin_audit_log where action = 'settings.update' $$;
grant execute on all functions in schema tests to anon, authenticated;

select tests.create_object('public-content', 'stamp/first.png', tests.admin(), 'image/png');
select tests.create_object('public-content', 'stamp/second.png', tests.admin(), 'image/png');
select tests.create_object('public-content', 'stamp/other-admin.png', tests.user_id('+9647505555555'), 'image/png');
select tests.create_object('public-content', 'stamp/old.png', tests.admin(), 'image/png');
update storage.objects set created_at = now() - interval '49 hours'
where bucket_id = 'public-content' and name = 'stamp/old.png';
insert into storage.objects (bucket_id, name, owner, owner_id)
values ('public-content', 'stamp/unfinished.png', tests.admin(), tests.admin()::text);
select tests.create_object('public-content', 'articles/cover.png', tests.admin(), 'image/png');

-- The second phone --------------------------------------------------------------------

select col_is_null('public', 'settings', 'company_phone_2', 'the second phone is optional');
select throws_ok(
  $$ update public.settings set company_phone_2 = '07867903703' where id $$,
  '23514', null, 'the second phone is E.164'
);
select throws_ok(
  $$ update public.settings set company_phone_2 = '+9647764349984' where id $$,
  '23514', null, 'the second phone differs from the first'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_update_settings('{"company_phone_2": "+9647867903703"}') $$,
  '42501', 'not_allowed', 'a customer cannot set the second phone'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_update_settings('{"company_phone_2": "+9647867903703"}') $$,
  '42501', 'not_allowed', 'nor can a crew'
);
select tests.authenticate_as_anon();
select is((select company_phone_2 from public.settings), null, 'a guest reads the second phone');

select tests.authenticate_as(tests.admin());
select lives_ok(
  $$ select public.admin_update_settings('{"company_phone_2": "+9647867903703"}') $$,
  'an admin sets the second phone'
);
select results_eq(
  $$ select company_phone, company_phone_2 from public.settings $$,
  $$ values ('+9647764349984'::text, '+9647867903703'::text) $$,
  'both phones are saved'
);
select is(
  (select diff from public.admin_audit_log where action = 'settings.update' order by id desc limit 1),
  '{"company_phone_2": {"from": null, "to": "+9647867903703"}}'::jsonb,
  'the change is logged'
);
select lives_ok(
  $$ select public.admin_update_settings(
       '{"company_phone": "+9647867903703", "company_phone_2": "+9647764349984"}') $$,
  'an admin swaps the two phones in one save'
);

select tests.clear_authentication();
select throws_ok(
  $$ update public.settings set certificate_stamp_path = 'stamp/a?b.png' where id $$,
  '23514', null, 'a stamp name is letters, digits, - and _ with an image extension'
);
select tests.authenticate_as(tests.admin());

-- The stamp: who may set it --------------------------------------------------------------

select throws_ok(
  $$ select public.admin_update_settings('{"certificate_stamp_path": "stamp/first.png"}') $$,
  '22023', 'unknown_setting', 'the stamp is not a plain setting'
);
select throws_ok(
  $$ update public.settings set certificate_stamp_path = 'elsewhere/first.png' where id $$,
  '42501', null, 'nobody writes the row directly'
);

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.admin_set_certificate_stamp('stamp/first.png') $$,
  '42501', null, 'a guest cannot set the stamp'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.admin_set_certificate_stamp('stamp/first.png') $$,
  '42501', 'not_allowed', 'a customer cannot set the stamp'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ select public.admin_set_certificate_stamp(null) $$,
  '42501', 'not_allowed', 'nor can another customer remove it'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ select public.admin_set_certificate_stamp('stamp/first.png') $$,
  '42501', 'not_allowed', 'nor can a crew'
);

-- The stamp: which file ----------------------------------------------------------------------

select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ select public.admin_set_certificate_stamp('stamp/missing.png') $$,
  'ZL009', 'upload_not_found', 'a file that does not exist is refused'
);
select throws_ok(
  $$ select public.admin_set_certificate_stamp('stamp/other-admin.png') $$,
  'ZL009', 'upload_not_found', 'so is another admin''s upload'
);
select throws_ok(
  $$ select public.admin_set_certificate_stamp('stamp/unfinished.png') $$,
  'ZL009', 'upload_not_found', 'and an unfinished one'
);
select throws_ok(
  $$ select public.admin_set_certificate_stamp('stamp/old.png') $$,
  'ZL009', 'upload_not_found', 'and one over 48 hours old'
);
select throws_ok(
  $$ select public.admin_set_certificate_stamp('articles/cover.png') $$,
  'ZL009', 'upload_not_found', 'and one outside stamp/'
);
select is(tests.audit_rows(), 2, 'nothing refused is logged');

select is(
  public.admin_set_certificate_stamp('stamp/first.png'), null,
  'an admin sets the stamp; nothing was replaced'
);
select is((select certificate_stamp_path from public.settings), 'stamp/first.png', 'the stamp is saved');
select is(
  public.admin_set_certificate_stamp('stamp/first.png'), null,
  'setting the same stamp again replaces nothing'
);
select is(tests.audit_rows(), 3, 'and logs once');
select is(
  public.admin_set_certificate_stamp('stamp/second.png'), 'stamp/first.png',
  'a new stamp returns the one it replaced'
);
select is(
  (select diff from public.admin_audit_log where action = 'settings.update' order by id desc limit 1),
  '{"certificate_stamp_path": {"from": "stamp/first.png", "to": "stamp/second.png"}}'::jsonb,
  'the change is logged with both paths'
);
select is(
  public.admin_set_certificate_stamp(null), 'stamp/second.png',
  'removing the stamp returns the one removed'
);
select is((select certificate_stamp_path from public.settings), null, 'the certificate has no stamp again');

select * from finish();
rollback;
