-- ticket_media (spec §5.17, §7): the files of an Issue report, written only
-- by create_ticket(). The foreign key (ticket_id, user_id) keeps a file on
-- its owner's ticket. Read by the ticket's customer and admins; crews,
-- other customers and guests never. Nobody writes the table directly.
begin;
\ir _helpers.psql

select plan(13);

select tests.create_user('+9647801111111');            -- customer A
select tests.create_user('+9647802222222');            -- customer B
select tests.create_user('+9647504444444', 'admin');
insert into tests.ids values ('crew', tests.create_crew('+9647703333333'));

create function tests.a() returns uuid language sql stable
as $$ select tests.user_id('+9647801111111') $$;
create function tests.b() returns uuid language sql stable
as $$ select tests.user_id('+9647802222222') $$;

select tests.create_object('ticket-media', tests.a() || '/a.jpg', tests.a());
select tests.authenticate_as(tests.a());
select public.create_ticket(
  gen_random_uuid(), 'leak', 'تسريب من الغطاء بعد التنظيف', null,
  jsonb_build_array(jsonb_build_object('path', tests.a() || '/a.jpg'))
);
select tests.clear_authentication();

insert into tests.ids
select 'ta', id from public.tickets where user_id = tests.a();
insert into public.tickets (user_id, source, category, description)
values (tests.b(), 'app', 'other', 'بلاغ الزبون الثاني');
insert into tests.ids
select 'tb', id from public.tickets where user_id = tests.b();

select ok(
  (select relrowsecurity from pg_class where oid = 'public.ticket_media'::regclass),
  'RLS is on for ticket_media'
);

-- Constraints ----------------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.ticket_media (ticket_id, user_id, media_type, path, bytes)
     values (tests.id('tb'), tests.a(), 'photo', tests.a() || '/x.jpg', 10) $$,
  '23503', null, 'a file can''t sit on another customer''s ticket'
);
select throws_ok(
  $$ insert into public.ticket_media (ticket_id, user_id, media_type, path, bytes)
     values (tests.id('ta'), tests.a(), 'video', tests.a() || '/x.mp4', 10) $$,
  '23514', null, 'a video needs its length'
);
select throws_ok(
  $$ insert into public.ticket_media (ticket_id, user_id, media_type, path, bytes, duration_s)
     values (tests.id('ta'), tests.a(), 'photo', tests.a() || '/x.jpg', 10, 5) $$,
  '23514', null, 'and a photo has none'
);
select throws_ok(
  $$ insert into public.ticket_media (ticket_id, user_id, media_type, path, bytes)
     values (tests.id('ta'), tests.a(), 'photo', tests.a() || '/a.jpg', 10) $$,
  '23505', null, 'a file is attached once'
);

-- Reads ------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select results_eq(
  $$ select path from public.ticket_media $$,
  $$ values (tests.a() || '/a.jpg') $$,
  'the customer reads their ticket''s files'
);
select tests.authenticate_as(tests.b());
select is_empty($$ select 1 from public.ticket_media $$, 'another customer reads none');
select tests.authenticate_as(tests.user_id('+9647703333333'));
select is_empty($$ select 1 from public.ticket_media $$, 'a crew reads none');
select tests.authenticate_as(tests.user_id('+9647504444444'));
select is((select count(*)::int from public.ticket_media), 1, 'admins read every file');
select tests.authenticate_as_anon();
select throws_ok($$ select 1 from public.ticket_media $$, '42501', null, 'guests have no access');

-- Writes ------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.a());
select throws_ok(
  $$ insert into public.ticket_media (ticket_id, user_id, media_type, path, bytes)
     values (tests.id('ta'), tests.a(), 'photo', tests.a() || '/y.jpg', 10) $$,
  '42501', null, 'the customer cannot attach a file directly'
);
select throws_ok(
  $$ delete from public.ticket_media $$,
  '42501', null, 'or remove one'
);
select tests.authenticate_as(tests.user_id('+9647504444444'));
select throws_ok(
  $$ update public.ticket_media set path = path || '.x' $$,
  '42501', null, 'nor can an admin change one'
);

select * from finish();
rollback;
