-- QA pass: media retention, account-deletion leftovers and the chat-media
-- swap (spec §7, §11, §13; Phase 6, task 4; settled Oct 28, 2026 with the
-- plan's recommended defaults).
--
-- 1. Media retention: private.purge_expired_media() deletes the order_media
--    rows of customer booking videos whose order closed (completed,
--    cancelled or no-show, counted from the event into its current status)
--    more than 90 days ago (spec §11). Customer photos, the crew's before and
--    after photos and clips, and certificates are kept. The files then count
--    as unattached and media-cleanup's customer folder deletes them the
--    next night (they are far over 72 hours old). pg_cron runs it nightly
--    at 00:23 UTC (03:23 Baghdad). order_media's Realtime DELETE events carry
--    only the row's uuid, and screens subscribe to inserts only.
-- 2. Account deletion leftovers (spec §13 "Personal data left after a
--    deletion"):
--    - delete_account() blanks the `note` and `reason` values in
--      admin_audit_log rows about the account's orders, tickets and
--      subscriptions (private.scrub_audit_text), and this migration does the
--      same once for accounts deleted before it;
--    - unattached_media('certificate') lists certificate PDFs no certificate
--      records and over 24 hours old, so a PDF whose delete failed after
--      delete_account() (or a failed record) goes in the nightly cleanup
--      (media-cleanup-certificate, 02:07 UTC, 05:07 Baghdad);
--    - otp_requests already go after 7 days (purge-otp-requests, migration
--      otp_requests); unchanged.
-- 3. Chat media swap (spec §13; the RLS audit of tickets_app): the same fix
--    as ticket-media. send_chat_message() locks the file while it attaches
--    it (an update of the object, not a plain read), private.chat_media_sent()
--    becomes volatile so a delete that waited re-checks with a fresh
--    snapshot, and the upload policy refuses the name of a sent file.
--
-- Departures from spec §7: none in the tables. admin_audit_log rows of a
-- deleted account lose their free text (the audit log otherwise never
-- changes).

-- 1. Media retention ---------------------------------------------------------------------------

create function private.purge_expired_media()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.order_media as m
  using public.orders as o
  where o.id = m.order_id
    and m.kind = 'customer'
    and m.media_type = 'video'
    and o.status in ('completed', 'cancelled', 'no_show')
    and (
      select max(e.created_at)
      from public.order_events as e
      where e.order_id = o.id and e.to_status = o.status
    ) < now() - interval '90 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Nightly at 00:23 UTC (03:23 Baghdad).
select cron.schedule('media-retention', '23 0 * * *', $$select private.purge_expired_media()$$);

-- 2. Account deletion leftovers ----------------------------------------------------------------

-- Blanks the free text (`note`, `reason`) in audit rows about the user's
-- orders, tickets and subscriptions. Called by delete_account().
create function private.scrub_audit_text(p_user_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.admin_audit_log as l
  set diff = (
    select jsonb_object_agg(e.key, case when e.key in ('note', 'reason') then 'null'::jsonb else e.value end)
    from jsonb_each(l.diff) as e
  )
  where (l.diff ? 'note' or l.diff ? 'reason')
    and (
      (l.entity = 'orders' and l.entity_id in (
        select o.id::text from public.orders as o where o.customer_id = p_user_id
      ))
      or (l.entity = 'tickets' and l.entity_id in (
        select t.id::text from public.tickets as t where t.user_id = p_user_id
      ))
      or (l.entity = 'subscriptions' and l.entity_id in (
        select s.id::text from public.subscriptions as s where s.user_id = p_user_id
      ))
    );
$$;

create or replace function public.delete_account()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_pdfs text[];
begin
  if v_user_id is null or (select private.current_user_role()) is distinct from 'customer' then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  -- Lock order: the addresses first, as create_order and
  -- request_subscription do (address, then the profile through the foreign
  -- key), so a booking in another tab finishes first instead of deadlocking,
  -- and the open-order check below then sees it. Then the profile, so two
  -- deletions can't interleave.
  perform 1 from public.addresses as a where a.user_id = v_user_id for update;
  perform 1 from public.profiles as p where p.id = v_user_id for update;

  if exists (
    select 1
    from public.orders as o
    where o.customer_id = v_user_id
      and o.status in ('pending_confirmation', 'confirmed', 'on_the_way', 'arrived', 'in_progress')
  ) then
    raise exception using errcode = 'ZL039', message = 'account_has_open_orders';
  end if;

  -- Free text staff wrote about the account in the audit log (a reason, a
  -- note) often holds a name, a number or directions: blanked, before the
  -- tickets go. The rest of each row stays.
  perform private.scrub_audit_text(v_user_id);

  -- Subscriptions end before the addresses move, so the pin guard lets go.
  update public.subscriptions as s
  set status = 'declined', ended_at = now()
  where s.user_id = v_user_id and s.status = 'requested';
  update public.subscriptions as s
  set status = 'cancelled', ended_at = now()
  where s.user_id = v_user_id and s.status = 'active';

  -- Staff notes are free text that often holds the customer's name, number
  -- or directions.
  delete from public.subscription_notes as n
  using public.subscriptions as s
  where s.id = n.subscription_id and s.user_id = v_user_id;
  delete from public.order_event_notes as n
  using public.orders as o
  where o.id = n.order_id and o.customer_id = v_user_id;

  -- Chat: messages (they reference tickets), then the thread.
  delete from public.chat_messages as m where m.customer_id = v_user_id;
  delete from public.chat_threads as t where t.user_id = v_user_id;

  -- Tickets; their files, notes and notifications cascade.
  update public.ratings as r
  set ticket_id = null
  where r.ticket_id in (select t.id from public.tickets as t where t.user_id = v_user_id);
  delete from public.tickets as t where t.user_id = v_user_id;

  update public.ratings as r
  set comment = null
  where r.comment is not null
    and r.order_id in (select o.id from public.orders as o where o.customer_id = v_user_id);

  select coalesce(array_agg(c.pdf_path order by c.pdf_path), '{}')
  into v_pdfs
  from public.certificates as c
  join public.orders as o on o.id = c.order_id
  where o.customer_id = v_user_id and c.pdf_path is not null;
  update public.certificates as c
  set pdf_path = null
  from public.orders as o
  where o.id = c.order_id and o.customer_id = v_user_id and c.pdf_path is not null;

  delete from public.order_media as m
  using public.orders as o
  where o.id = m.order_id and o.customer_id = v_user_id;

  update public.orders as o
  set landmark = '-deleted-',
    customer_note = null,
    lat = round(o.lat::numeric, 2)::double precision,
    lng = round(o.lng::numeric, 2)::double precision
  where o.customer_id = v_user_id;

  delete from public.tanks as t where t.user_id = v_user_id;
  update public.addresses as a
  set deleted_at = coalesce(a.deleted_at, now()),
    is_default = false,
    landmark = '-deleted-',
    lat = round(a.lat::numeric, 2)::double precision,
    lng = round(a.lng::numeric, 2)::double precision
  where a.user_id = v_user_id;

  delete from public.notifications as n where n.user_id = v_user_id;
  delete from public.push_subscriptions as s where s.user_id = v_user_id;

  update public.profiles as p
  set deleted_at = now(), full_name = null, phone = null, reminders_enabled = false
  where p.id = v_user_id;

  -- Auth: no phone (the trigger copies null to the profile), banned, and
  -- signed out everywhere.
  update auth.users as u
  set phone = null, phone_confirmed_at = null, phone_change = '', banned_until = now() + interval '100 years'
  where u.id = v_user_id;
  delete from auth.refresh_tokens as r where r.user_id = v_user_id::text;
  delete from auth.sessions as s where s.user_id = v_user_id;
  delete from auth.one_time_tokens as t where t.user_id = v_user_id;
  delete from auth.identities as i where i.user_id = v_user_id;

  return v_pdfs;
end;
$$;

-- Accounts deleted before this migration. Their tickets are gone already, so
-- only order and subscription rows can be matched.
select private.scrub_audit_text(p.id) from public.profiles as p where p.deleted_at is not null;

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
  if p_folder is null or p_folder not in ('customer', 'crew', 'chat', 'ticket', 'content', 'certificate') then
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
  elsif p_folder = 'certificate' then
    return query
    select ob.name, ob.created_at
    from storage.objects as ob
    where ob.bucket_id = 'certificates'
      -- The server records a PDF within seconds of uploading it.
      and ob.created_at < now() - interval '24 hours'
      and (p_after_created_at is null or (ob.created_at, ob.name) > (p_after_created_at, p_after_name))
      and not exists (select 1 from public.certificates as c where c.pdf_path = ob.name)
    order by ob.created_at, ob.name
    limit p_limit;
  elsif p_folder = 'content' then
    return query
    select ob.name, ob.created_at
    from storage.objects as ob
    where ob.bucket_id = 'public-content'
      and starts_with(ob.name, 'articles/')
      -- admin_save_article() takes uploads up to 48 hours old.
      and ob.created_at < now() - interval '72 hours'
      and (p_after_created_at is null or (ob.created_at, ob.name) > (p_after_created_at, p_after_name))
      and not exists (select 1 from public.articles as a where a.cover_path = ob.name)
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

create or replace function private.invoke_media_cleanup(p_folder text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_folder is null or p_folder not in ('customer', 'crew', 'chat', 'ticket', 'content', 'certificate') then
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

-- Nightly at 02:07 UTC (05:07 Baghdad).
select cron.schedule(
  'media-cleanup-certificate', '7 2 * * *', $$select private.invoke_media_cleanup('certificate')$$
);

-- 3. Chat media swap ---------------------------------------------------------------------------

-- Volatile, so a delete that waited on send_chat_message() re-checks with a
-- fresh snapshot and sees the file it sent.
alter function private.chat_media_sent(text) volatile;

drop policy "Customers and admins upload chat files to their own folder" on storage.objects;
create policy "Customers and admins upload chat files to their own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-media'
  and cardinality(storage.foldername(name)) = 1
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.current_user_role()) in ('customer', 'admin')
  -- Never under the name of a sent file that has gone missing.
  and not private.chat_media_sent(name)
);

create or replace function public.send_chat_message(
  p_client_id uuid,
  p_thread_id uuid default null,
  p_body text default null,
  p_media_path text default null,
  p_duration_s numeric default null,
  p_order_id uuid default null,
  p_topic public.chat_topic default null
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role public.app_role := (select private.current_user_role());
  v_thread public.chat_threads;
  v_body text := nullif(btrim(p_body), '');
  v_message public.chat_messages;
  v_metadata jsonb;
  v_media_type public.media_type;
  v_duration numeric(4, 1);
  v_reply text;
begin
  if v_user_id is null or v_role is null or v_role not in ('customer', 'admin') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'client_id_required';
  end if;

  -- The thread: a customer's own (made if missing), or the one an admin names.
  if v_role = 'customer' then
    -- Made first: a row inserted inside this statement's own where clause
    -- would not be visible to it.
    v_thread.id := private.ensure_chat_thread(v_user_id);
    select * into v_thread from public.chat_threads as t where t.id = v_thread.id for update;
    if p_thread_id is not null and p_thread_id <> v_thread.id then
      raise exception using errcode = 'P0002', message = 'thread_not_found';
    end if;
  else
    if p_topic is not null then
      raise exception using errcode = '22023', message = 'invalid_topic';
    end if;
    select * into v_thread from public.chat_threads as t where t.id = p_thread_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'thread_not_found';
    end if;
  end if;

  -- A retry returns the first message (the thread lock queues two at once).
  -- Only in the same thread: an admin turned customer must not read back,
  -- by client id, what they sent in a customer's thread (RLS audit).
  select * into v_message
  from public.chat_messages as m
  where m.sender_id = v_user_id and m.client_id = p_client_id and m.thread_id = v_thread.id;
  if found then
    return v_message;
  end if;
  -- The same client id from this sender in another thread is a client bug:
  -- say so rather than hit the unique key.
  if exists (
    select 1 from public.chat_messages as m
    where m.sender_id = v_user_id and m.client_id = p_client_id
  ) then
    raise exception using errcode = '22023', message = 'client_id_taken';
  end if;

  if char_length(v_body) > 2000 then
    raise exception using errcode = '22023', message = 'invalid_body';
  end if;
  if p_topic in ('reschedule', 'cancel') and p_order_id is null then
    raise exception using errcode = '22023', message = 'order_required';
  end if;
  if p_order_id is not null and not exists (
    select 1 from public.orders as o where o.id = p_order_id and o.customer_id = v_thread.user_id
  ) then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;
  if v_body is null and p_media_path is null and p_topic is null then
    raise exception using errcode = '22023', message = 'empty_message';
  end if;

  if (
    select count(*) from public.chat_messages as m
    where m.sender_id = v_user_id and m.created_at > now() - interval '1 minute'
  ) >= 20 then
    raise exception using errcode = 'ZL027', message = 'too_many_messages';
  end if;

  -- A file: finished (Storage made the object), in the sender's own folder,
  -- at most 48 hours old (the cleanup deletes unsent files after 72), not
  -- sent before. Type and size come from Storage.
  if p_media_path is not null then
    -- An update, not a select: a delete of the same file running meanwhile
    -- then waits for this transaction and checks its policy again, which now
    -- sees the file sent (the tickets_app fix, spec §13 "Chat media swap").
    update storage.objects as ob
    set metadata = ob.metadata
    where ob.bucket_id = 'chat-media'
      and ob.name = p_media_path
      and p_media_path ~ ('^' || v_user_id::text || '/[^/]+$')
      and ob.owner_id = v_user_id::text
      and ob.metadata ->> 'size' is not null
      and ob.created_at > now() - interval '48 hours'
      and not exists (select 1 from public.chat_messages as m where m.media_path = ob.name)
    returning ob.metadata into v_metadata;
    if not found then
      raise exception using errcode = 'ZL009', message = 'upload_not_found';
    end if;
    v_media_type := case when v_metadata ->> 'mimetype' like 'video/%' then 'video' else 'photo' end;
    if v_media_type = 'video' then
      if p_duration_s is null or not (p_duration_s between 0 and 60) then
        raise exception using errcode = '22023', message = 'invalid_duration';
      end if;
      v_duration := round(p_duration_s, 1);
    end if;
  end if;
  if p_duration_s is not null and v_media_type is distinct from 'video' then
    raise exception using errcode = '22023', message = 'invalid_duration';
  end if;

  insert into public.chat_messages (
    thread_id, customer_id, author, sender_id, body, media_path, media_type, duration_s, bytes,
    order_id, topic, client_id
  )
  values (
    v_thread.id, v_thread.user_id, v_role::text::public.chat_author, v_user_id, v_body,
    p_media_path, v_media_type, v_duration, (v_metadata ->> 'size')::bigint,
    p_order_id, p_topic, p_client_id
  )
  returning * into v_message;

  -- Outside working hours: one automatic reply per off-hours stretch.
  if v_role = 'customer' and not private.support_open(now()) then
    select s.support_response_text into v_reply from public.settings as s where s.id;
    if v_reply <> '' and not exists (
      select 1
      from public.chat_messages as m
      where m.thread_id = v_thread.id
        and m.kind = 'auto_reply'
        and m.created_at > coalesce(
          greatest(
            private.last_support_close(now()),
            (
              select max(a.created_at) from public.chat_messages as a
              where a.thread_id = v_thread.id and a.author = 'admin'
            )
          ),
          '-infinity'
        )
    ) then
      insert into public.chat_messages (thread_id, customer_id, author, kind, body)
      values (v_thread.id, v_thread.user_id, 'system', 'auto_reply', v_reply);
    end if;
  end if;

  return v_message;
end;
$$;

revoke execute on all functions in schema private from public;
grant execute on function private.chat_media_sent(text) to authenticated;
