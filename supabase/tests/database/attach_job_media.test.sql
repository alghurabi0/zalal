-- attach_job_media(order_id, kind, path, duration_s) and
-- remove_job_media(media_id) (spec §7, §8.1 C3b).
-- attach: the assigned, active crew attaches a finished upload from its own
-- folder for that order (crew/<crew id>/<order id>/…, uploaded by this
-- account) as a before or after photo or a clip. The order must be arrived
-- or in progress, or completed less than 24 hours ago (ZL023
-- media_not_allowed). Type and size come from Storage; photos go in
-- before/after, videos in clip with a duration of at most 60 s. Up to 10
-- before photos, 10 after photos and 4 clips (ZL008). Attaching the same file
-- again returns the same row, so a retry after a lost answer is safe.
-- remove: the assigned crew removes its own before/after/clip row while the
-- job is open (arrived, in progress) and gets the path back to delete the
-- file. Other roles get 42501; another crew's or a missing row P0002.
begin;
\ir _helpers.psql

select plan(36);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew1', tests.create_crew('+9647703333333'));
insert into tests.ids values ('crew2', tests.create_crew('+9647703333334'));
insert into tests.ids values ('crew_off', tests.create_crew('+9647703333335'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.crew1_user() returns uuid language sql stable
as $$ select tests.user_id('+9647703333333') $$;

insert into tests.ids values
  ('arrived', tests.create_order(tests.a(), 'arrived', p_crew_id => tests.id('crew1'))),
  ('working', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('full', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew1'))),
  ('confirmed', tests.create_order(tests.a(), 'confirmed', p_crew_id => tests.id('crew1'))),
  ('done_recent', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('done_old', tests.create_order(tests.a(), 'completed', p_crew_id => tests.id('crew1'))),
  ('other', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew2'))),
  ('off_job', tests.create_order(tests.a(), 'in_progress', p_crew_id => tests.id('crew_off')));
insert into public.order_events (order_id, from_status, to_status, actor_role, created_at)
values
  (tests.id('done_recent'), 'in_progress', 'completed', 'crew', now() - interval '23 hours'),
  (tests.id('done_old'), 'in_progress', 'completed', 'crew', now() - interval '25 hours');
update public.crews set active = false where id = tests.id('crew_off');

create function tests.p(p_crew text, p_order text, p_file text) returns text language sql stable
as $$ select 'crew/' || tests.id(p_crew) || '/' || tests.id(p_order) || '/' || p_file $$;

-- Finished uploads, as the Storage API leaves them.
select tests.create_object('order-media', tests.p('crew1', 'arrived', 'b1.jpg'), tests.crew1_user(), 'image/jpeg', 2345);
select tests.create_object('order-media', tests.p('crew1', 'arrived', 'clip.webm'), tests.crew1_user(), 'video/webm', 900000);
select tests.create_object('order-media', tests.p('crew1', 'arrived', 'long.webm'), tests.crew1_user(), 'video/webm', 900000);
select tests.create_object('order-media', tests.p('crew1', 'arrived', 'by_other.jpg'), tests.user_id('+9647703333334'));
select tests.create_object('order-media', tests.p('crew1', 'working', 'w.jpg'), tests.crew1_user());
select tests.create_object('order-media', tests.p('crew1', 'confirmed', 'c.jpg'), tests.crew1_user());
select tests.create_object('order-media', tests.p('crew1', 'done_recent', 'd.jpg'), tests.crew1_user());
select tests.create_object('order-media', tests.p('crew1', 'done_old', 'o.jpg'), tests.crew1_user());
select tests.create_object('order-media', tests.p('crew1', 'full', 'b11.jpg'), tests.crew1_user());
select tests.create_object('order-media', tests.p('crew1', 'full', 'c5.webm'), tests.crew1_user(), 'video/webm');
select tests.create_object('order-media', tests.p('crew2', 'other', 'x.jpg'), tests.user_id('+9647703333334'));
select tests.create_object('order-media', tests.p('crew_off', 'off_job', 'x.jpg'), tests.user_id('+9647703333335'));

-- The "full" job already has 10 before photos and 4 clips.
insert into public.order_media (order_id, kind, media_type, path, bytes, duration_s, uploaded_by)
select tests.id('full'), 'before'::public.order_media_kind, 'photo'::public.media_type, tests.p('crew1', 'full', 'b' || n || '.jpg'), 1000, null::numeric, tests.crew1_user()
from generate_series(1, 10) as n
union all
select tests.id('full'), 'clip', 'video', tests.p('crew1', 'full', 'c' || n || '.webm'), 1000, 10, tests.crew1_user()
from generate_series(1, 4) as n;
-- And a customer photo, which the crew can't remove.
insert into public.order_media (order_id, kind, media_type, path, bytes, uploaded_by)
values (tests.id('working'), 'customer', 'photo', 'customer/' || tests.a() || '/k.jpg', 1000, tests.a());

grant execute on all functions in schema tests to anon, authenticated;

-- attach: the crew ---------------------------------------------------------------

select tests.authenticate_as(tests.crew1_user());

select lives_ok(
  $$ insert into tests.ids
     select 'm_before', public.attach_job_media(tests.id('arrived'), 'before', tests.p('crew1', 'arrived', 'b1.jpg')) $$,
  'the crew attaches a before photo on arrival'
);
select results_eq(
  $$ select order_id, kind::text, media_type::text, bytes, duration_s, uploaded_by
     from public.order_media where id = tests.id('m_before') $$,
  $$ values (tests.id('arrived'), 'before', 'photo', 2345::bigint, null::numeric, tests.crew1_user()) $$,
  'type and size come from Storage'
);
select is(
  public.attach_job_media(tests.id('arrived'), 'before', tests.p('crew1', 'arrived', 'b1.jpg')),
  tests.id('m_before'),
  'attaching the same file again returns the same row'
);
select is(
  (select count(*)::int from public.order_media where path = tests.p('crew1', 'arrived', 'b1.jpg')),
  1,
  'and adds nothing'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('arrived'), 'after', tests.p('crew1', 'arrived', 'b1.jpg')) $$,
  'ZL009', 'upload_not_found', 'an attached file cannot be attached again as another kind'
);
select lives_ok(
  $$ select public.attach_job_media(tests.id('arrived'), 'clip', tests.p('crew1', 'arrived', 'clip.webm'), 30.2) $$,
  'the crew attaches a clip with its length'
);
select results_eq(
  $$ select kind::text, media_type::text, duration_s from public.order_media
     where path = tests.p('crew1', 'arrived', 'clip.webm') $$,
  $$ values ('clip', 'video', 30.2::numeric) $$,
  'the clip is a video with its duration'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('arrived'), 'clip', tests.p('crew1', 'arrived', 'long.webm'), 61) $$,
  '22023', 'invalid_duration', 'a clip is at most 60 s'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('arrived'), 'clip', tests.p('crew1', 'arrived', 'long.webm')) $$,
  '22023', 'invalid_duration', 'a clip needs its length'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('arrived'), 'before', tests.p('crew1', 'arrived', 'long.webm'), 10) $$,
  '22023', 'media_type_mismatch', 'a before photo must be a photo'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('working'), 'clip', tests.p('crew1', 'working', 'w.jpg'), 10) $$,
  '22023', 'media_type_mismatch', 'a clip must be a video'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('arrived'), 'customer', tests.p('crew1', 'arrived', 'long.webm')) $$,
  '22023', 'invalid_kind', 'the crew cannot add customer media'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('arrived'), 'after', tests.p('crew1', 'working', 'w.jpg')) $$,
  'ZL009', 'upload_not_found', 'a file from another order''s folder is refused'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('arrived'), 'after', tests.p('crew1', 'arrived', 'missing.jpg')) $$,
  'ZL009', 'upload_not_found', 'an unfinished or missing upload is refused'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('arrived'), 'after', tests.p('crew1', 'arrived', 'by_other.jpg')) $$,
  'ZL009', 'upload_not_found', 'a file another account uploaded is refused'
);
select lives_ok(
  $$ select public.attach_job_media(tests.id('working'), 'after', tests.p('crew1', 'working', 'w.jpg')) $$,
  'the crew attaches an after photo while working'
);
select lives_ok(
  $$ select public.attach_job_media(tests.id('done_recent'), 'after', tests.p('crew1', 'done_recent', 'd.jpg')) $$,
  'an upload still lands up to 24 hours after completion'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('done_old'), 'after', tests.p('crew1', 'done_old', 'o.jpg')) $$,
  'ZL023', 'media_not_allowed', 'not 24 hours after completion'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('confirmed'), 'before', tests.p('crew1', 'confirmed', 'c.jpg')) $$,
  'ZL023', 'media_not_allowed', 'not before the crew arrives'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('full'), 'before', tests.p('crew1', 'full', 'b11.jpg')) $$,
  'ZL008', 'too_many_files', 'at most 10 before photos'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('full'), 'clip', tests.p('crew1', 'full', 'c5.webm'), 5) $$,
  'ZL008', 'too_many_files', 'at most 4 clips'
);
select lives_ok(
  $$ select public.attach_job_media(tests.id('full'), 'after', tests.p('crew1', 'full', 'b11.jpg')) $$,
  'each kind has its own limit'
);
select throws_ok(
  $$ select public.attach_job_media(tests.id('other'), 'before', tests.p('crew2', 'other', 'x.jpg')) $$,
  'P0002', 'order_not_found', 'not on another crew''s order'
);

-- attach: everyone else ------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333334'));
select throws_ok(
  $$ select public.attach_job_media(tests.id('working'), 'before', tests.p('crew1', 'working', 'w.jpg')) $$,
  'P0002', 'order_not_found', 'another crew cannot attach to crew 1''s job'
);

select tests.authenticate_as(tests.user_id('+9647703333335'));
select throws_ok(
  $$ select public.attach_job_media(tests.id('off_job'), 'before', tests.p('crew_off', 'off_job', 'x.jpg')) $$,
  'P0002', 'order_not_found', 'a switched-off crew cannot attach'
);

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.attach_job_media(tests.id('working'), 'before', tests.p('crew1', 'working', 'w.jpg')) $$,
  '42501', 'not_allowed', 'the customer cannot attach job media'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.attach_job_media(tests.id('working'), 'before', tests.p('crew1', 'working', 'w.jpg')) $$,
  '42501', 'not_allowed', 'an admin cannot attach job media'
);

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.attach_job_media(tests.id('working'), 'before', tests.p('crew1', 'working', 'w.jpg')) $$,
  '42501', null, 'a guest cannot call it'
);

-- remove ------------------------------------------------------------------------

select tests.authenticate_as(tests.user_id('+9647703333334'));
select throws_ok(
  $$ select public.remove_job_media(tests.id('m_before')) $$,
  'P0002', 'media_not_found', 'another crew cannot remove crew 1''s photo'
);

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ select public.remove_job_media(tests.id('m_before')) $$,
  '42501', 'not_allowed', 'the customer cannot remove job media'
);

select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ select public.remove_job_media(tests.id('m_before')) $$,
  '42501', 'not_allowed', 'an admin cannot remove it through this RPC'
);

select tests.authenticate_as(tests.crew1_user());
select is(
  public.remove_job_media(tests.id('m_before')),
  tests.p('crew1', 'arrived', 'b1.jpg'),
  'the crew removes its photo and gets the path to delete'
);
select is_empty(
  $$ select 1 from public.order_media where id = tests.id('m_before') $$,
  'the row is gone'
);
select throws_ok(
  $$ select public.remove_job_media(
       (select id from public.order_media where order_id = tests.id('working') and kind = 'customer')) $$,
  'P0002', 'media_not_found', 'the crew cannot remove the customer''s files'
);
select throws_ok(
  $$ select public.remove_job_media(
       (select id from public.order_media where path = tests.p('crew1', 'done_recent', 'd.jpg'))) $$,
  'ZL023', 'media_not_allowed', 'not after the job is completed'
);
select throws_ok(
  $$ select public.remove_job_media(gen_random_uuid()) $$,
  'P0002', 'media_not_found', 'a missing row'
);

select * from finish();
rollback;
