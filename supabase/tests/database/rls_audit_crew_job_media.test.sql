-- RLS audit of migration crew_job_media (spec §6, §7, §8.1 C3b, C4): the
-- attempts the feature's own tests don't make.
-- - A crew removes only job media from its own folder: when an admin override
--   reopens a job and hands it to another crew, the new crew must not remove
--   the photos the first crew attached (the first crew can no longer see or
--   delete the file, so it would be left orphaned and the evidence lost).
-- - Nobody overwrites a crew upload: Storage's x-upsert is INSERT … ON
--   CONFLICT DO UPDATE, and there is no UPDATE policy.
-- - Path tricks ('..', extra folders) never land outside
--   crew/<crew id>/<order id>/<file>.
-- - A crew that lost the job, a switched-off crew, the account a crew moved
--   away from (admin_set_crew_phone) and guests get nothing.
-- - Extra payload keys on the crew's completion never reach what the
--   customer reads.
begin;
\ir _helpers.psql

select plan(20);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));
insert into tests.ids values ('crew_off', tests.create_crew('+9647703333335'));
insert into tests.ids values ('moving', tests.create_crew('+9647703333336'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.crew1_user() returns uuid language sql stable
as $$ select tests.user_id('+9647703333333') $$;
create function tests.crew2_user() returns uuid language sql stable
as $$ select tests.user_id('+9647703333334') $$;

insert into tests.ids values
  ('retaken', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('working', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('other', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew2'))),
  ('off_job', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew_off'))),
  ('moving_job', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('moving'))),
  ('finish', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1')));

create function tests.p(p_crew text, p_order text, p_file text) returns text language sql stable
as $$ select 'crew/' || tests.id(p_crew) || '/' || tests.id(p_order) || '/' || p_file $$;

create function tests.put(p_name text) returns void language sql
as $$ insert into storage.objects (bucket_id, name, owner_id) values ('order-media', p_name, auth.uid()::text) $$;

-- What the Storage API runs for an upload with x-upsert: true.
create function tests.upsert(p_name text) returns void language sql
as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('order-media', p_name, auth.uid()::text, '{"size": 1, "mimetype": "image/jpeg"}')
  on conflict (bucket_id, name collate "C") where archived_at is null do update
  set owner_id = excluded.owner_id, metadata = excluded.metadata
$$;

grant execute on all functions in schema tests to anon, authenticated;

select tests.create_object('order-media', tests.p('crew1', 'retaken', 'before.jpg'), tests.crew1_user());
select tests.create_object('order-media', tests.p('crew1', 'working', 'queued.jpg'), tests.crew1_user());
select tests.create_object('order-media', tests.p('crew1', 'working', 'attached.jpg'), tests.crew1_user());
select tests.create_object('order-media', tests.p('crew_off', 'off_job', 'x.jpg'), tests.user_id('+9647703333335'));
select tests.create_object('order-media', tests.p('moving', 'moving_job', 'm.jpg'), tests.user_id('+9647703333336'));
insert into public.order_media (order_id, kind, media_type, path, bytes, uploaded_by)
values
  (tests.id('working'), 'before', 'photo', tests.p('crew1', 'working', 'attached.jpg'), 1000, tests.crew1_user()),
  (tests.id('off_job'), 'before', 'photo', tests.p('crew_off', 'off_job', 'x.jpg'), 1000, tests.user_id('+9647703333335'));
update public.crews set active = false where id = tests.id('crew_off');

-- A job taken away after an override -------------------------------------------------

select tests.authenticate_as(tests.crew1_user());
insert into tests.ids values (
  'before_media',
  public.attach_job_media(tests.id('retaken'), 'before', tests.p('crew1', 'retaken', 'before.jpg'))
);

-- The office reopens the job and hands it to crew 2, which goes there.
select tests.authenticate_as(tests.user_id('+9647504444444'));
select public.transition_order(tests.id('retaken'), 'confirmed', '{"override": true, "reason": "طاقم ثاني"}');
select public.assign_crew(tests.id('retaken'), tests.id('crew2'));
select tests.authenticate_as(tests.crew2_user());
select public.transition_order(tests.id('retaken'), 'on_the_way');
select public.transition_order(tests.id('retaken'), 'arrived');

select throws_ok(
  $$ select public.remove_job_media(tests.id('before_media')) $$,
  'P0002', 'media_not_found',
  'the crew now on the job cannot remove the photo the first crew attached'
);

select tests.authenticate_as(tests.crew1_user());
select throws_ok(
  $$ select public.attach_job_media(tests.id('retaken'), 'after', tests.p('crew1', 'retaken', 'before.jpg')) $$,
  'P0002', 'order_not_found', 'the first crew cannot attach to the job it lost'
);
select throws_ok(
  $$ select public.remove_job_media(tests.id('before_media')) $$,
  'P0002', 'media_not_found', 'nor remove media from it'
);
select throws_ok(
  $$ select tests.put(tests.p('crew1', 'retaken', 'late.jpg')) $$,
  '42501', null, 'nor upload to it'
);
set local storage.allow_delete_query = 'true';
select is_empty(
  $$ delete from storage.objects where name = tests.p('crew1', 'retaken', 'before.jpg') returning 1 $$,
  'nor delete the attached file once the order_media row is hidden from it'
);

-- Overwrites and path tricks --------------------------------------------------------

select throws_ok(
  $$ select tests.upsert(tests.p('crew1', 'working', 'queued.jpg')) $$,
  '42501', null, 'x-upsert cannot overwrite the crew''s own queued upload'
);
select throws_ok(
  $$ select tests.upsert(tests.p('crew1', 'working', 'attached.jpg')) $$,
  '42501', null, 'nor an attached file'
);
select isnt(
  (select metadata ->> 'size' from storage.objects where name = tests.p('crew1', 'working', 'attached.jpg')),
  '1',
  'the attached file is unchanged'
);
select throws_ok(
  $$ select tests.put(tests.p('crew1', 'working', '..') || '/' || tests.id('other') || '/x.jpg') $$,
  '42501', null, 'a ".." folder is refused'
);
select throws_ok(
  $$ select tests.put(tests.p('crew1', 'working', 'extra/x.jpg')) $$,
  '42501', null, 'an extra folder is refused'
);
select throws_ok(
  $$ select tests.put('crew/' || tests.id('crew1') || '//' || tests.id('working') || '/x.jpg') $$,
  '42501', null, 'an empty folder is refused'
);
select throws_ok(
  $$ select public.attach_job_media(
       tests.id('working'), 'before',
       tests.p('crew1', 'working', '../../../crew_off/') || tests.id('off_job') || '/x.jpg'
     ) $$,
  'ZL009', 'upload_not_found', 'a ".." path cannot attach a file from elsewhere'
);

-- A switched-off crew, a moved crew's old account, guests -------------------------------

select tests.authenticate_as(tests.user_id('+9647703333335'));
select throws_ok(
  $$ select public.remove_job_media((select id from public.order_media where order_id = tests.id('off_job'))) $$,
  'P0002', 'media_not_found', 'a switched-off crew cannot remove media'
);

-- The crew moves to a new phone account, as admin_set_crew_phone does.
select tests.clear_authentication();
select tests.create_user('+9647703333337', 'crew');
update public.crews set user_id = tests.user_id('+9647703333337') where id = tests.id('moving');
update public.profiles set role = 'customer' where id = tests.user_id('+9647703333336');

select tests.authenticate_as(tests.user_id('+9647703333336'));
select is_empty(
  $$ select 1 from storage.objects where name like 'crew/%' $$,
  'the old account reads nothing in the crew folder'
);
select throws_ok(
  $$ select tests.put(tests.p('moving', 'moving_job', 'y.jpg')) $$,
  '42501', null, 'nor uploads there'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('moving_job'), 'before', tests.p('moving', 'moving_job', 'm.jpg')) $$,
  '42501', 'not_allowed', 'nor attaches its old uploads'
);

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.remove_job_media(gen_random_uuid()) $$,
  '42501', null, 'a guest cannot call remove_job_media'
);

-- Extra payload keys on completion --------------------------------------------------

select tests.authenticate_as(tests.crew1_user());
select lives_ok(
  $$ select public.transition_order(tests.id('finish'), 'completed', '{
       "cash_collected": true, "sterilant": "كلور",
       "reason": "للزبون", "details": {"note": "للزبون"}, "override": true
     }') $$,
  'the crew completes with extra keys in the payload'
);

select tests.authenticate_as(tests.a());
select results_eq(
  $$ select is_override, details from public.order_events
     where order_id = tests.id('finish') and to_status = 'completed' $$,
  $$ values (false, '{"cash_collected": true}'::jsonb) $$,
  'the customer sees no override and no text from the payload'
);
select tests.clear_authentication();
select is_empty(
  $$ select 1 from public.order_event_notes where order_id = tests.id('finish') $$,
  'and "reason" does not become a note in place of "note"'
);

select * from finish();
rollback;
