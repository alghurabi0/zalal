-- Storage rules for the chat-media bucket (spec §5.16, §7). A customer or an
-- admin uploads to their own folder, chat-media/<user id>/<file>, then
-- send_chat_message() attaches the file. Uploaders read their own folder and
-- may delete a file there until it is attached. An attached file is read by
-- whoever reads its message (the thread's customer and admins). Crews and
-- guests never.
begin;
\ir _helpers.psql

select plan(19);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.admin() returns uuid language sql stable
as $$ select tests.user_id('+9647504444444') $$;

update public.settings as s
set working_days = '{0,1,2,3,4,5,6}', working_hours_start = '00:00', working_hours_end = '24:00'
where s.id;

select tests.create_object('chat-media', tests.a() || '/sent.jpg', tests.a());
select tests.create_object('chat-media', tests.a() || '/draft.jpg', tests.a());
select tests.create_object('chat-media', tests.admin() || '/answer.jpg', tests.admin());
select tests.authenticate_as(tests.a());
select public.send_chat_message(gen_random_uuid(), p_media_path => tests.a() || '/sent.jpg');
select tests.authenticate_as(tests.admin());
select public.send_chat_message(
  gen_random_uuid(), (select id from public.chat_threads where user_id = tests.a()),
  p_media_path => tests.admin() || '/answer.jpg'
);

-- Uploads ----------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('chat-media', auth.uid() || '/new.jpg', auth.uid()::text) $$,
  'a customer uploads to their own folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('chat-media', tests.user_id('+9647802222222') || '/x.jpg', auth.uid()::text) $$,
  '42501', null, 'a customer cannot upload to someone else''s folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('chat-media', auth.uid() || '/deep/x.jpg', auth.uid()::text) $$,
  '42501', null, 'nor into a subfolder'
);

select tests.authenticate_as(tests.admin());
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('chat-media', auth.uid() || '/new.jpg', auth.uid()::text) $$,
  'an admin uploads to their own folder'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('chat-media', auth.uid() || '/x.jpg', auth.uid()::text) $$,
  '42501', null, 'a crew cannot upload chat media'
);

select tests.authenticate_as_anon();
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('chat-media', 'x/x.jpg') $$,
  '42501', null, 'a guest cannot upload'
);

-- Reads ------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select results_eq(
  $$ select name from storage.objects where bucket_id = 'chat-media' order by name $$,
  $$ select unnest(array[
       tests.a() || '/draft.jpg', tests.a() || '/new.jpg', tests.a() || '/sent.jpg',
       tests.admin() || '/answer.jpg'
     ]) order by 1 $$,
  'a customer reads their uploads and the files support sent them'
);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'chat-media' $$,
  'another customer reads none of them'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'chat-media' $$,
  'a crew reads none'
);

select tests.authenticate_as_anon();
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'chat-media' $$,
  'a guest reads none'
);

select tests.authenticate_as(tests.admin());
select results_eq(
  $$ select name from storage.objects where bucket_id = 'chat-media' order by name $$,
  $$ select unnest(array[
       tests.a() || '/sent.jpg', tests.admin() || '/answer.jpg', tests.admin() || '/new.jpg'
     ]) order by 1 $$,
  'an admin reads attached files and their own uploads, not a customer''s unsent ones'
);

-- Deletes ----------------------------------------------------------------------------

select set_config('storage.allow_delete_query', 'true', true);

select tests.authenticate_as(tests.user_id('+9647802222222'));
select is_empty(
  $$ delete from storage.objects where bucket_id = 'chat-media' returning 1 $$,
  'another customer deletes nothing'
);

select tests.authenticate_as(tests.admin());
select is_empty(
  $$ delete from storage.objects where bucket_id = 'chat-media' and name = tests.a() || '/sent.jpg' returning 1 $$,
  'an admin cannot delete a customer''s file'
);
select is_empty(
  $$ delete from storage.objects where bucket_id = 'chat-media' and name = tests.admin() || '/answer.jpg' returning 1 $$,
  'nor their own once attached'
);

select tests.authenticate_as(tests.a());
select is_empty(
  $$ delete from storage.objects where bucket_id = 'chat-media' and name = tests.a() || '/sent.jpg' returning 1 $$,
  'a customer cannot delete an attached file'
);
select results_eq(
  $$ delete from storage.objects where bucket_id = 'chat-media' and name = tests.a() || '/draft.jpg' returning 1 $$,
  $$ values (1) $$,
  'a customer deletes an unsent upload'
);

select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty(
  $$ delete from storage.objects where bucket_id = 'chat-media' returning 1 $$,
  'a crew deletes nothing'
);

select tests.authenticate_as(tests.a());
select is_empty(
  $$ update storage.objects set name = name || '.x' where bucket_id = 'chat-media' returning 1 $$,
  'nobody renames chat files'
);
select tests.authenticate_as(tests.admin());
select is_empty(
  $$ update storage.objects set name = name || '.x' where bucket_id = 'chat-media' returning 1 $$,
  'not even admins'
);

select * from finish();
rollback;
