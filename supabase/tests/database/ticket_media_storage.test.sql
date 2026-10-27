-- Storage rules for the ticket-media bucket (spec §5.17, §7). A customer
-- uploads to their own folder, ticket-media/<user id>/<file>, then
-- create_ticket() attaches the file. The uploader reads their folder and may
-- delete a file there until it is attached. An attached file is read by
-- whoever reads its ticket (the customer and admins). "Attached" is checked
-- without RLS (private.ticket_media_attached), so someone who can no longer
-- read the ticket still can't delete or replace its file. Admins, crews and
-- guests don't upload.
begin;
\ir _helpers.psql

select plan(18);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;

select tests.create_object('ticket-media', tests.a() || '/sent.jpg', tests.a());
select tests.create_object('ticket-media', tests.a() || '/draft.jpg', tests.a());
select tests.authenticate_as(tests.a());
select public.create_ticket(
  gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
  jsonb_build_array(jsonb_build_object('path', tests.a() || '/sent.jpg'))
);

-- Uploads ----------------------------------------------------------------------------

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('ticket-media', auth.uid() || '/new.jpg', auth.uid()::text) $$,
  'a customer uploads to their own folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('ticket-media', tests.user_id('+9647802222222') || '/x.jpg', auth.uid()::text) $$,
  '42501', null, 'a customer cannot upload to someone else''s folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('ticket-media', auth.uid() || '/deep/x.jpg', auth.uid()::text) $$,
  '42501', null, 'nor into a subfolder'
);

select tests.authenticate_as(tests.admin());
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('ticket-media', auth.uid() || '/x.jpg', auth.uid()::text) $$,
  '42501', null, 'an admin doesn''t upload ticket files'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('ticket-media', auth.uid() || '/x.jpg', auth.uid()::text) $$,
  '42501', null, 'nor does a crew'
);

select tests.authenticate_as_anon();
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('ticket-media', 'x/x.jpg') $$,
  '42501', null, 'nor a guest'
);

-- Reads ------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select results_eq(
  $$ select name from storage.objects where bucket_id = 'ticket-media' order by name $$,
  $$ select unnest(array[
       tests.a() || '/draft.jpg', tests.a() || '/new.jpg', tests.a() || '/sent.jpg'
     ]) order by 1 $$,
  'a customer reads their uploads and their tickets'' files'
);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'ticket-media' $$,
  'another customer reads none of them'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select 1 from storage.objects where bucket_id = 'ticket-media' $$, 'a crew reads none');

select tests.authenticate_as_anon();
select is_empty($$ select 1 from storage.objects where bucket_id = 'ticket-media' $$, 'a guest reads none');

select tests.authenticate_as(tests.admin());
select results_eq(
  $$ select name from storage.objects where bucket_id = 'ticket-media' $$,
  $$ values (tests.a() || '/sent.jpg') $$,
  'an admin reads attached files, not a customer''s unsent uploads'
);

-- Deletes and changes ------------------------------------------------------------------

select set_config('storage.allow_delete_query', 'true', true);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty(
  $$ delete from storage.objects where bucket_id = 'ticket-media' returning 1 $$,
  'another customer deletes nothing'
);

select tests.authenticate_as(tests.admin());
select is_empty(
  $$ delete from storage.objects where bucket_id = 'ticket-media' returning 1 $$,
  'an admin deletes nothing'
);

select tests.authenticate_as(tests.a());
select is_empty(
  $$ delete from storage.objects where bucket_id = 'ticket-media' and name = tests.a() || '/sent.jpg' returning 1 $$,
  'a customer cannot delete an attached file'
);
select results_eq(
  $$ delete from storage.objects where bucket_id = 'ticket-media' and name = tests.a() || '/draft.jpg' returning 1 $$,
  $$ values (1) $$,
  'a customer deletes an unattached upload'
);
select is_empty(
  $$ update storage.objects set name = name || '.x' where bucket_id = 'ticket-media' returning 1 $$,
  'nobody renames ticket files'
);

-- A deleted account keeps no way to touch its files.
select tests.clear_authentication();
update public.profiles set deleted_at = now() where id = tests.a();
select tests.authenticate_as(tests.a());
select is_empty(
  $$ delete from storage.objects where bucket_id = 'ticket-media' and name = tests.a() || '/sent.jpg' returning 1 $$,
  'a deleted account cannot delete an attached file'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('ticket-media', auth.uid() || '/later.jpg', auth.uid()::text) $$,
  '42501', null, 'or upload'
);

select * from finish();
rollback;
