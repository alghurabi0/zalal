-- The Issue report, My reports (N11), A5 tickets and A12 ratings (spec
-- §5.17, N11, §7, §8.2; Phase 5, task 2).
--
-- 1. tickets (migration certificates) gets:
--    - client_id, unique per customer, so a retried Issue report returns the
--      first ticket instead of making a second one (rating tickets have none);
--    - a place in the Realtime publication, so A1, A5 and N11 follow status
--      changes live. Its key is a uuid and tickets are never deleted, so a
--      DELETE event (sent without RLS) gives nothing away.
--
-- 2. create_ticket(client_id, category, description, order_id, media): the
--    Issue report, customers only. A category and a description of 10–1000
--    characters (trimmed). The order is optional and must be the customer's
--    own with its slot no more than 90 days ago (new error ZL028
--    ticket_order_too_old; upcoming orders count). Up to 3 files (ZL008)
--    from ticket-media/<user id>/, finished, at most 48 h old and not
--    attached before (ZL009); type and size come from Storage, videos need a
--    length of 0–60 s. 5 app tickets an hour per customer (new error ZL029
--    too_many_tickets): each one posts a chat message and, from Phase 5,
--    task 3, a push to admins. The chat message comes from the trigger
--    tickets_chat_message (migration chat).
--
-- 3. ticket_media: the report's files, written only by create_ticket.
--    Departures from §7 (ticket_id, path, media_type): an id key; user_id,
--    so the foreign key (ticket_id, user_id) keeps a file on its owner's
--    ticket; bytes and duration_s as on order_media.
--
-- 4. ticket_notes and admin_add_ticket_note(ticket_id, note): internal
--    notes (A5), admins only, kept as a list with author and time and never
--    edited. A table of its own because RLS can't hide a column of tickets
--    from the customer (as order_event_notes). New in §7.
--
-- 5. admin_set_ticket_status(ticket_id, status): any status to any other
--    (open, in progress, closed, and reopening; settled Oct 27, 2026). Both
--    admin RPCs log to admin_audit_log (ticket.status, ticket.note). A status
--    change posts nothing in Chat; Phase 5, task 3 pushes it from a trigger
--    on tickets (status and updated_at are all it needs).
--
-- 6. admin_rating_summary(): ratings per star 1–5 for A12's average and
--    filter counts.
--
-- 7. settings.ticket_response_hours (1–72, default 1): the Issue report's
--    promise "نرد عليك خلال ساعة بأوقات الدوام" (§5.17 says it is a setting;
--    settled Oct 27, 2026). The words stay in ar.json; only the number is
--    stored. Edited in A13.
--
-- 8. Storage (ticket-media): customers upload to <user id>/<file>; a file
--    is read by its uploader until attached, then by whoever reads its
--    ticket; the uploader deletes it until attached. "Attached" is checked
--    without RLS (private.ticket_media_attached), the lesson of the chat
--    RLS audit. Admins and crews don't upload. RLS audit of this migration:
--    create_ticket locks each file while attaching it, so a delete running
--    meanwhile waits and then sees it attached, and no upload may reuse the
--    name of an attached file.
--
-- 9. Media cleanup: unattached_media('ticket') lists ticket files more than
--    72 h old that no ticket attached; the nightly job media-cleanup-ticket
--    (00:57 UTC, 03:57 Baghdad) asks the media-cleanup function to delete
--    them.

-- Settings -----------------------------------------------------------------------------

alter table public.settings
add column ticket_response_hours smallint not null default 1
check (ticket_response_hours between 1 and 72);

-- tickets ------------------------------------------------------------------------------------

alter table public.tickets
add column client_id uuid;

alter table public.tickets
add constraint tickets_user_id_client_id_key unique (user_id, client_id);

alter publication supabase_realtime add table public.tickets;

-- ticket_media ---------------------------------------------------------------------------------

create table public.ticket_media (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null,
  user_id uuid not null,
  media_type public.media_type not null,
  -- Object name in the ticket-media bucket.
  path text not null unique check (char_length(path) between 1 and 300),
  bytes bigint not null check (bytes between 1 and 104857600),
  -- Videos only, 60 s at most (Upload's limits, §5.10).
  duration_s numeric(4, 1) check (duration_s between 0 and 60),
  created_at timestamptz not null default now(),
  foreign key (ticket_id, user_id) references public.tickets (id, user_id) on delete cascade,
  constraint ticket_media_duration_for_video check ((media_type = 'video') = (duration_s is not null))
);

alter table public.ticket_media enable row level security;

create index ticket_media_ticket_id_user_id_idx on public.ticket_media (ticket_id, user_id);

revoke all on public.ticket_media from anon, authenticated;
grant select on public.ticket_media to authenticated;

create policy "Customers read their tickets' files; admins all"
on public.ticket_media
for select
to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

-- ticket_notes ---------------------------------------------------------------------------------

create table public.ticket_notes (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  note text not null check (char_length(note) between 1 and 1000 and note = btrim(note)),
  created_at timestamptz not null default now()
);

alter table public.ticket_notes enable row level security;

create index ticket_notes_ticket_id_idx on public.ticket_notes (ticket_id);
create index ticket_notes_author_id_idx on public.ticket_notes (author_id);

revoke all on public.ticket_notes from anon, authenticated;
revoke all on sequence public.ticket_notes_id_seq from anon, authenticated;
grant select on public.ticket_notes to authenticated;

create policy "Admins read ticket notes"
on public.ticket_notes
for select
to authenticated
using ((select private.is_admin()));

-- create_ticket ----------------------------------------------------------------------------------

-- p_media lists finished uploads: {"path": "<user id>/<file>", "duration_s": 12.5}.
create function public.create_ticket(
  p_client_id uuid,
  p_category public.ticket_category,
  p_description text,
  p_order_id uuid default null,
  p_media jsonb default '[]'
)
returns table (ticket_id uuid, ticket_number bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_description text := btrim(p_description);
  v_ticket public.tickets;
  v_slot_start_at timestamptz;
  v_file jsonb;
  v_metadata jsonb;
  v_media_type public.media_type;
  v_duration numeric;
begin
  if v_user_id is null or (select private.current_user_role()) is distinct from 'customer' then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'client_id_required';
  end if;

  -- One report at a time per customer, so the retry and the hourly limit
  -- below can't be raced.
  perform 1 from public.profiles as p where p.id = v_user_id for update;

  select * into v_ticket
  from public.tickets as t
  where t.user_id = v_user_id and t.client_id = p_client_id;
  if found then
    ticket_id := v_ticket.id;
    ticket_number := v_ticket.number;
    return next;
    return;
  end if;

  if p_category is null then
    raise exception using errcode = '22023', message = 'invalid_category';
  end if;
  if v_description is null or char_length(v_description) not between 10 and 1000 then
    raise exception using errcode = '22023', message = 'invalid_description';
  end if;

  if p_order_id is not null then
    select o.slot_start_at into v_slot_start_at
    from public.orders as o
    where o.id = p_order_id and o.customer_id = v_user_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'order_not_found';
    end if;
    if v_slot_start_at < now() - interval '90 days' then
      raise exception using errcode = 'ZL028', message = 'ticket_order_too_old';
    end if;
  end if;

  p_media := coalesce(p_media, '[]');
  if jsonb_typeof(p_media) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_media';
  end if;
  if jsonb_array_length(p_media) > 3 then
    raise exception using errcode = 'ZL008', message = 'too_many_files';
  end if;

  if (
    select count(*) from public.tickets as t
    where t.user_id = v_user_id and t.source = 'app' and t.created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception using errcode = 'ZL029', message = 'too_many_tickets';
  end if;

  insert into public.tickets (user_id, order_id, category, description, source, client_id)
  values (v_user_id, p_order_id, p_category, v_description, 'app', p_client_id)
  returning * into v_ticket;

  -- Uploads: finished (Storage made the object), in the caller's own folder,
  -- recent, and not attached before. Type and size come from Storage.
  for v_file in select e.value from jsonb_array_elements(p_media) as e loop
    if jsonb_typeof(v_file) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid_media';
    end if;
    -- An update, not a select: a delete of the same file running meanwhile
    -- then waits for this transaction and checks its policy again, which
    -- now sees the file attached (RLS audit: a plain read let the customer
    -- delete the file while it was being attached).
    update storage.objects as ob
    set metadata = ob.metadata
    where ob.bucket_id = 'ticket-media'
      and ob.name = v_file ->> 'path'
      and ob.name like v_user_id || '/%'
      and ob.owner_id = v_user_id::text
      -- Within 48 hours of the upload: the cleanup deletes unattached files
      -- after 72, so it never deletes one that can still be attached.
      and ob.created_at > now() - interval '48 hours'
      and not exists (select 1 from public.ticket_media as m where m.path = ob.name)
    returning ob.metadata into v_metadata;
    if not found then
      raise exception using errcode = 'ZL009', message = 'upload_not_found';
    end if;

    v_media_type := case when v_metadata ->> 'mimetype' like 'video/%' then 'video' else 'photo' end;
    v_duration := null;
    if v_media_type = 'video' then
      if coalesce(v_file ->> 'duration_s', '') !~ '^[0-9]{1,3}(\.[0-9]+)?$' then
        raise exception using errcode = '22023', message = 'invalid_duration';
      end if;
      v_duration := round((v_file ->> 'duration_s')::numeric, 1);
      if v_duration > 60 then
        raise exception using errcode = '22023', message = 'invalid_duration';
      end if;
    end if;

    insert into public.ticket_media (ticket_id, user_id, media_type, path, bytes, duration_s)
    values (
      v_ticket.id, v_user_id, v_media_type, v_file ->> 'path', (v_metadata ->> 'size')::bigint, v_duration
    );
  end loop;

  ticket_id := v_ticket.id;
  ticket_number := v_ticket.number;
  return next;
end;
$$;

revoke execute on function public.create_ticket(uuid, public.ticket_category, text, uuid, jsonb)
from public, anon;
grant execute on function public.create_ticket(uuid, public.ticket_category, text, uuid, jsonb)
to authenticated;

-- Admin RPCs ---------------------------------------------------------------------------------------

create function public.admin_set_ticket_status(p_ticket_id uuid, p_status public.ticket_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.ticket_status;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_status is null then
    raise exception using errcode = '22023', message = 'invalid_status';
  end if;

  select t.status into v_old from public.tickets as t where t.id = p_ticket_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ticket_not_found';
  end if;
  if v_old = p_status then
    return;
  end if;

  update public.tickets as t set status = p_status where t.id = p_ticket_id;

  perform private.log_admin_action(
    'ticket.status', 'tickets', p_ticket_id::text,
    jsonb_build_object('from', v_old, 'to', p_status)
  );
end;
$$;

revoke execute on function public.admin_set_ticket_status(uuid, public.ticket_status) from public, anon;
grant execute on function public.admin_set_ticket_status(uuid, public.ticket_status) to authenticated;

-- Returns the new note's id.
create function public.admin_add_ticket_note(p_ticket_id uuid, p_note text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := btrim(p_note);
  v_id bigint;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if v_note is null or char_length(v_note) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'invalid_note';
  end if;
  if not exists (select 1 from public.tickets as t where t.id = p_ticket_id) then
    raise exception using errcode = 'P0002', message = 'ticket_not_found';
  end if;

  insert into public.ticket_notes (ticket_id, author_id, note)
  values (p_ticket_id, (select auth.uid()), v_note)
  returning id into v_id;

  perform private.log_admin_action(
    'ticket.note', 'tickets', p_ticket_id::text, jsonb_build_object('note', v_note)
  );
  return v_id;
end;
$$;

revoke execute on function public.admin_add_ticket_note(uuid, text) from public, anon;
grant execute on function public.admin_add_ticket_note(uuid, text) to authenticated;

-- A12: ratings per star, every star listed.
create function public.admin_rating_summary()
returns table (stars integer, ratings bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  return query
  select s.n, count(r.order_id)
  from generate_series(1, 5) as s (n)
  left join public.ratings as r on r.stars = s.n
  group by s.n
  order by s.n;
end;
$$;

revoke execute on function public.admin_rating_summary() from public, anon;
grant execute on function public.admin_rating_summary() to authenticated;

-- Storage: ticket-media ------------------------------------------------------------------------

-- Whether a ticket has attached the file, whoever may read that ticket. The
-- storage policies need it without RLS, so a caller who can't read the
-- ticket still can't delete its file and upload something else under its
-- name (the chat-media lesson, migration chat).
-- Volatile, so a delete that waited on create_ticket re-checks with a fresh
-- snapshot and sees the file it attached.
create function private.ticket_media_attached(p_name text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (select 1 from public.ticket_media as m where m.path = p_name);
$$;

create policy "Customers upload ticket files to their own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'ticket-media'
  and cardinality(storage.foldername(name)) = 1
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.current_user_role()) = 'customer'
  -- Never under the name of an attached file that has gone missing (RLS audit).
  and not private.ticket_media_attached(name)
);

create policy "Ticket files are read by their uploader and with their ticket"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'ticket-media'
  and (
    (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and not private.ticket_media_attached(objects.name)
    )
    or exists (select 1 from public.ticket_media as m where m.path = objects.name)
  )
);

create policy "Customers delete ticket files until they are attached"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'ticket-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not private.ticket_media_attached(objects.name)
);

-- Media cleanup: the ticket folder --------------------------------------------------------------
-- Unchanged from migration chat except the ticket branch.

create or replace function public.unattached_media(
  p_folder text,
  p_limit integer default 500,
  p_after_created_at timestamptz default null,
  p_after_name text default null
)
returns table (name text, created_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_folder is null or p_folder not in ('customer', 'crew', 'chat', 'ticket') then
    raise exception using errcode = '22023', message = 'invalid_folder';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'invalid_limit';
  end if;
  if (p_after_created_at is null) <> (p_after_name is null) then
    raise exception using errcode = '22023', message = 'invalid_cursor';
  end if;

  if p_folder = 'customer' then
    return query
    select ob.name, ob.created_at
    from storage.objects as ob
    where ob.bucket_id = 'order-media'
      and starts_with(ob.name, 'customer/')
      -- create_order() takes uploads up to 48 hours old.
      and ob.created_at < now() - interval '72 hours'
      and (p_after_created_at is null or (ob.created_at, ob.name) > (p_after_created_at, p_after_name))
      and not exists (select 1 from public.order_media as m where m.path = ob.name)
    order by ob.created_at, ob.name
    limit p_limit;
  elsif p_folder = 'chat' then
    return query
    select ob.name, ob.created_at
    from storage.objects as ob
    where ob.bucket_id = 'chat-media'
      -- send_chat_message() takes uploads up to 48 hours old.
      and ob.created_at < now() - interval '72 hours'
      and (p_after_created_at is null or (ob.created_at, ob.name) > (p_after_created_at, p_after_name))
      and not exists (select 1 from public.chat_messages as m where m.media_path = ob.name)
    order by ob.created_at, ob.name
    limit p_limit;
  elsif p_folder = 'ticket' then
    return query
    select ob.name, ob.created_at
    from storage.objects as ob
    where ob.bucket_id = 'ticket-media'
      -- create_ticket() takes uploads up to 48 hours old.
      and ob.created_at < now() - interval '72 hours'
      and (p_after_created_at is null or (ob.created_at, ob.name) > (p_after_created_at, p_after_name))
      and not exists (select 1 from public.ticket_media as m where m.path = ob.name)
    order by ob.created_at, ob.name
    limit p_limit;
  else
    return query
    select ob.name, ob.created_at
    from storage.objects as ob
    where ob.bucket_id = 'order-media'
      and starts_with(ob.name, 'crew/')
      and ob.created_at < now() - interval '48 hours'
      and (p_after_created_at is null or (ob.created_at, ob.name) > (p_after_created_at, p_after_name))
      and not exists (select 1 from public.order_media as m where m.path = ob.name)
      -- The order still takes media from this crew: the rule of
      -- private.job_takes_media() (attach_job_media), with 48 hours after
      -- completion instead of 24 as a margin. unattached_media.test.sql checks
      -- that no file it would accept is listed, should either window change.
      and not exists (
        select 1
        from public.orders as o
        where o.id = case
            when split_part(ob.name, '/', 3) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then split_part(ob.name, '/', 3)::uuid
          end
          and o.crew_id::text = split_part(ob.name, '/', 2)
          and (
            o.status in ('arrived', 'in_progress')
            or (
              o.status = 'completed'
              and exists (
                select 1 from public.order_events as e
                where e.order_id = o.id
                  and e.to_status = 'completed'
                  and e.created_at > now() - interval '48 hours'
              )
            )
          )
      )
    order by ob.created_at, ob.name
    limit p_limit;
  end if;
end;
$$;

-- Unchanged from migration chat except the ticket folder.
create or replace function private.invoke_media_cleanup(p_folder text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_folder is null or p_folder not in ('customer', 'crew', 'chat', 'ticket') then
    raise exception using errcode = '22023', message = 'invalid_folder';
  end if;

  select s.decrypted_secret into v_url
  from vault.decrypted_secrets as s
  where s.name = 'project_url';
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets as s
  where s.name = 'media_cleanup_secret';
  if v_url is null or v_secret is null then
    raise notice 'media cleanup skipped: add the Vault secrets project_url and media_cleanup_secret';
    return null;
  end if;

  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/media-cleanup',
    body := jsonb_build_object('folder', p_folder),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-media-cleanup-secret', v_secret
    ),
    -- The function stops itself after about 50 seconds.
    timeout_milliseconds := 60000
  );
end;
$$;

-- Daily at 00:57 UTC (03:57 Baghdad), after the other folders.
select cron.schedule(
  'media-cleanup-ticket', '57 0 * * *', $$select private.invoke_media_cleanup('ticket')$$
);

revoke execute on all functions in schema private from public;
grant execute on function private.ticket_media_attached(text) to authenticated;
