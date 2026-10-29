-- Storage rules for the certificate stamp in the public-content bucket (spec
-- §7, §8.2 A13, §10.1). The bucket is public, so the certificate's print page
-- loads the stamp by URL. Through the API only admins touch stamp/: they
-- upload to public-content/stamp/<file>, read the bucket and delete a stamp
-- the settings don't use. "Used" is checked without RLS
-- (private.certificate_stamp_used), and no upload takes the stamp's name.
-- The nightly cleanup (unattached_media('content')) also lists stamps over
-- 72 h old that the settings don't use.
begin;
\ir _helpers.psql

select plan(19);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
select tests.create_crew('+9647703333333');

create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;

select set_config('storage.allow_delete_query', 'true', true);
update public.settings set certificate_stamp_path = null;
delete from storage.objects where bucket_id = 'public-content';
select tests.create_object('public-content', 'stamp/used.png', tests.admin(), 'image/png');
select tests.create_object('public-content', 'stamp/spare.png', tests.admin(), 'image/png');
select tests.authenticate_as(tests.admin());
select public.admin_set_certificate_stamp('stamp/used.png');

-- Uploads ------------------------------------------------------------------------------

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'stamp/new.png', auth.uid()::text) $$,
  'an admin uploads a stamp to stamp/'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'stamp/deep/x.png', auth.uid()::text) $$,
  '42501', null, 'not into a subfolder'
);

select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'stamp/c.png', auth.uid()::text) $$,
  '42501', null, 'a customer cannot upload a stamp'
);
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'stamp/c2.png', auth.uid()::text) $$,
  '42501', null, 'nor can another customer'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'stamp/crew.png', auth.uid()::text) $$,
  '42501', null, 'nor a crew'
);
select tests.authenticate_as_anon();
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('public-content', 'stamp/anon.png') $$,
  '42501', null, 'nor a guest'
);

-- Reads -----------------------------------------------------------------------------------

select is_empty($$ select 1 from storage.objects where name like 'stamp/%' $$, 'a guest lists no stamps');
select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty($$ select 1 from storage.objects where name like 'stamp/%' $$, 'nor does a customer');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select 1 from storage.objects where name like 'stamp/%' $$, 'nor a crew');
select tests.authenticate_as(tests.admin());
select results_eq(
  $$ select name from storage.objects where bucket_id = 'public-content' order by name $$,
  $$ values ('stamp/new.png'), ('stamp/spare.png'), ('stamp/used.png') $$,
  'an admin lists the stamps'
);

-- Deletes ------------------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647801111111'));
select is_empty(
  $$ delete from storage.objects where name like 'stamp/%' returning 1 $$,
  'a customer deletes no stamp'
);
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty(
  $$ delete from storage.objects where name like 'stamp/%' returning 1 $$,
  'nor does a crew'
);
select tests.authenticate_as(tests.admin());
select is_empty(
  $$ delete from storage.objects where name = 'stamp/used.png' returning 1 $$,
  'an admin cannot delete the stamp in use'
);
select results_eq(
  $$ delete from storage.objects where name = 'stamp/spare.png' returning 1 $$,
  $$ values (1) $$,
  'an admin deletes a stamp nothing uses'
);

-- The stamp in use went missing: nothing may take its name.
select tests.clear_authentication();
delete from storage.objects where name = 'stamp/used.png';
select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'stamp/used.png', auth.uid()::text) $$,
  '42501', null, 'no upload takes the name of the stamp in use'
);

-- An admin who is no longer one can't touch stamps.
select tests.clear_authentication();
update public.profiles set role = 'customer' where id = tests.admin();
select tests.authenticate_as(tests.admin());
select is_empty(
  $$ delete from storage.objects where name = 'stamp/new.png' returning 1 $$,
  'a removed admin deletes nothing'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('public-content', 'stamp/later.png', auth.uid()::text) $$,
  '42501', null, 'nor uploads'
);

-- The nightly cleanup -------------------------------------------------------------------------

select tests.clear_authentication();
update public.profiles set role = 'admin' where id = tests.admin();
select tests.create_object('public-content', 'stamp/used.png', tests.admin(), 'image/png');
select tests.create_object('public-content', 'stamp/stale.png', tests.admin(), 'image/png');
update storage.objects set created_at = now() - interval '73 hours'
where bucket_id = 'public-content' and name in ('stamp/used.png', 'stamp/stale.png');

select tests.authenticate_as_service_role();
select results_eq(
  $$ select name from public.unattached_media('content') $$,
  $$ values ('stamp/stale.png') $$,
  'the cleanup lists an old stamp nothing uses, not the stamp in use nor a new upload'
);
select tests.authenticate_as(tests.user_id('+9647801111111'));
select throws_ok(
  $$ select public.unattached_media('content') $$,
  '42501', null, 'only the server lists unattached files'
);

select * from finish();
rollback;
