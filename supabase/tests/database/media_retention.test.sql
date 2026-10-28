-- Media retention (spec §7 Storage, §11, §13; Phase 6, task 4; settled Oct
-- 28, 2026). private.purge_expired_media() deletes the order_media rows of
-- customer booking videos whose order closed (completed, cancelled or
-- no-show, by the event into its current status) more than 90 days ago, and
-- returns how many. Customer photos, the crew's photos and clips, and open
-- orders keep theirs. The files then count as unattached and the nightly
-- media-cleanup deletes them. pg_cron runs it nightly at 00:23 UTC (03:23
-- Baghdad); no API role may call it.
begin;
\ir _helpers.psql

select plan(14);

select tests.create_user('+9647801111111');
select tests.create_crew('+9647802222222');
select tests.create_user('+9647803333333', 'admin');
create function tests.c() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;

-- An order in a status, closed (or moved) this long ago, with one file of
-- each kind.
create function tests.order_with_media(p_status text, p_age interval) returns uuid
language plpgsql
as $$
declare
  v_order uuid := tests.create_order(tests.c(), p_status, now() - p_age - interval '3 hours');
begin
  insert into public.order_events (order_id, from_status, to_status, actor_role, created_at)
  values
    (v_order, null, 'pending_confirmation', 'customer', now() - p_age - interval '10 days'),
    (v_order, 'pending_confirmation', p_status::public.order_status, 'admin', now() - p_age);
  insert into public.order_media (order_id, kind, media_type, path, bytes, duration_s)
  values
    (v_order, 'customer', 'video', 'customer/' || v_order || '/v.mp4', 1000, 30),
    (v_order, 'customer', 'photo', 'customer/' || v_order || '/p.jpg', 1000, null),
    (v_order, 'before', 'photo', 'crew/x/' || v_order || '/b.jpg', 1000, null),
    (v_order, 'after', 'photo', 'crew/x/' || v_order || '/a.jpg', 1000, null),
    (v_order, 'clip', 'video', 'crew/x/' || v_order || '/c.mp4', 1000, 20);
  return v_order;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

create temp table cases (name text primary key, order_id uuid);
insert into cases values
  ('completed_old', tests.order_with_media('completed', '91 days')),
  ('completed_recent', tests.order_with_media('completed', '89 days')),
  ('cancelled_old', tests.order_with_media('cancelled', '91 days')),
  ('no_show_old', tests.order_with_media('no_show', '91 days')),
  ('open_old', tests.order_with_media('confirmed', '120 days'));

-- Reopened by an override and completed again recently: the newest
-- completion counts.
insert into cases values ('recompleted', tests.order_with_media('completed', '200 days'));
insert into public.order_events (order_id, from_status, to_status, actor_role, is_override, created_at)
select order_id, 'completed', 'in_progress', 'admin', true, now() - interval '20 days'
from cases where name = 'recompleted';
insert into public.order_events (order_id, from_status, to_status, actor_role, created_at)
select order_id, 'in_progress', 'completed', 'crew', now() - interval '10 days'
from cases where name = 'recompleted';

create function tests.kinds(p_case text) returns text
language sql
as $$
  select string_agg(m.kind || '/' || m.media_type, ',' order by m.kind::text, m.media_type::text)
  from public.order_media as m
  join cases as c on c.order_id = m.order_id
  where c.name = p_case
$$;

select is(private.purge_expired_media(), 3, 'three booking videos are past 90 days');

select is(
  tests.kinds('completed_old'), 'after/photo,before/photo,clip/video,customer/photo',
  'completed 91 days ago: the booking video goes; customer photos and the crew''s files stay'
);
select is(
  tests.kinds('cancelled_old'), 'after/photo,before/photo,clip/video,customer/photo',
  'cancelled 91 days ago: the booking video goes'
);
select is(
  tests.kinds('no_show_old'), 'after/photo,before/photo,clip/video,customer/photo',
  'no-show 91 days ago: the booking video goes'
);
select is(
  tests.kinds('completed_recent'), 'after/photo,before/photo,clip/video,customer/photo,customer/video',
  'completed 89 days ago: everything stays'
);
select is(
  tests.kinds('open_old'), 'after/photo,before/photo,clip/video,customer/photo,customer/video',
  'an open order keeps its video, however old'
);
select is(
  tests.kinds('recompleted'), 'after/photo,before/photo,clip/video,customer/photo,customer/video',
  'completed again 10 days ago: counted from the newest completion'
);
select is(private.purge_expired_media(), 0, 'a second run finds nothing');

-- No API role runs it.
select tests.authenticate_as_anon();
select throws_ok($$ select private.purge_expired_media() $$, '42501', null, 'guests can''t run it');
select tests.authenticate_as(tests.c());
select throws_ok($$ select private.purge_expired_media() $$, '42501', null, 'customers can''t run it');
select tests.authenticate_as(tests.user_id('+9647802222222'));
select throws_ok($$ select private.purge_expired_media() $$, '42501', null, 'crews can''t run it');
select tests.authenticate_as(tests.user_id('+9647803333333'));
select throws_ok($$ select private.purge_expired_media() $$, '42501', null, 'admins can''t run it');
select tests.clear_authentication();

select is(
  (select schedule from cron.job where jobname = 'media-retention'),
  '23 0 * * *',
  'nightly at 00:23 UTC (03:23 Baghdad)'
);
select is(
  (select command from cron.job where jobname = 'media-retention'),
  'select private.purge_expired_media()',
  'running the purge'
);

select * from finish();
rollback;
