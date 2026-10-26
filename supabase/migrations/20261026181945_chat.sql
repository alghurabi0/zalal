-- Support chat: the customer's Chat (spec §5.16, §5.18) and the admin inbox
-- A4 (§8.2), with the system messages §6 and §5.15 promise. Phase 5, task 1.
--
-- 1. chat_threads: one per customer, made on first use (chat_thread(), the
--    first message, or a system message). It carries what the tab badge,
--    the inbox order and A1 need, so screens listen to one row:
--    last_message_at, customer_unread (support's and the system's messages
--    the customer hasn't read) and admin_unread (the customer's messages no
--    admin has read). A trigger on chat_messages keeps them; mark_chat_read()
--    recounts.
--    Departure from §7: no assigned_admin_id. Support agents are all admins
--    in v1 and A4 has no assignment (§2, §8.2); it is one column later.
--
-- 2. chat_messages: author (customer | admin | system), sender_id (null for
--    the system), kind, body, one file (media_path, media_type, duration_s,
--    bytes), an order tag (order_id), a quick topic (§5.16), ticket_id,
--    client_id, read_at and created_at (clock time, so a message and its
--    automatic reply keep their order inside one transaction).
--    Departures from §7:
--    - kind is message | auto_reply | no_show | ticket, not text | media |
--      system | auto: a file is a field, not a kind, because a file can carry
--      a caption (Chat.dc.html); system messages name their event and the
--      app renders their words from ar.json (the order and ticket numbers
--      come from the tags), so no Arabic is stored for them. The automatic
--      reply stores its text, a copy of the setting when it was sent.
--    - customer_id (the thread's owner) on every message: foreign keys
--      (thread_id, customer_id) and (order_id, customer_id) mean a tag can
--      only name the thread customer's own order, whatever an RPC does, and
--      the read policy needs no join.
--    - topic (reschedule | cancel | price | complaint), client_id (a retry
--      returns the first message) and ticket_id are new columns.
--    Keys are uuids: Realtime sends a DELETE event's key to every subscriber
--    without RLS (supabase/CLAUDE.md), so keys say nothing. Nothing deletes
--    chat rows today.
--
-- 3. Access: the customer reads their own thread and its messages, admins
--    read all; crews and guests nothing. No table writes for anyone:
--    - send_chat_message(client_id, thread_id, body, media_path, duration_s,
--      order_id, topic): customers to their own thread, admins to any (no
--      topic). 20 messages a minute per sender (ZL027 too_many_messages). A
--      file is the sender's own finished upload in chat-media/<user id>/,
--      at most 48 hours old and not sent before (ZL009). A customer message
--      outside working hours gets one automatic reply (settings
--      support_response_text) per off-hours stretch: none if one was sent
--      since hours last closed or an admin last replied, or while the text
--      is empty.
--    - mark_chat_read(thread_id): the other side's messages; returns how
--      many.
--    - chat_thread(): the customer's thread id, made if missing.
--    - admin_chat_inbox(search, limit): A4's list.
--    - support_is_open(): Chat's header (everyone).
--    Departure from §7's access rules: admin replies are not written to
--    admin_audit_log. Each message names the admin who sent it and can't be
--    changed, so the log would only copy it.
--    The customer can read an admin's sender_id (a bare uuid; profiles RLS
--    hides who it is). RLS can't hide one column from customers while
--    admins read it, and the id gives nothing away.
--
-- 4. System messages, by trigger so transition_order and rate_order stay as
--    they are: a move to no_show posts a no_show message tagged with the
--    order (§6: the internal note stays out); a new ticket posts a ticket
--    message with the ticket and its order (today the tickets ratings of 3
--    stars or fewer open, §5.15; the Issue report's in Phase 5, task 2).
--
-- 5. Storage (chat-media): customers and admins upload to <user id>/<file>;
--    a file is read by its uploader until it is sent, then by whoever reads
--    its message; the uploader deletes it until it is sent. "Sent" is
--    checked without RLS (private.chat_media_sent), so an admin who is no
--    longer one can't delete or replace what customers were sent. The nightly media cleanup gets a
--    chat folder: unsent chat files over 72 hours old (job media-cleanup-chat,
--    00:37 UTC).
--
-- 6. settings.support_response_text: the automatic reply (≤ 300 characters,
--    empty turns it off), edited in A13. Seeded with a draft for the owner.
--
-- 7. Realtime: both tables join the publication; screens subscribe to
--    INSERT and UPDATE only.
--
-- For push (Phase 5, task 3): a trigger on chat_messages inserts has what a
-- notification needs (author, thread, body or file type, tag, created_at).

-- Types --------------------------------------------------------------------------------

create type public.chat_author as enum ('customer', 'admin', 'system');
create type public.chat_message_kind as enum ('message', 'auto_reply', 'no_show', 'ticket');
create type public.chat_topic as enum ('reschedule', 'cancel', 'price', 'complaint');

-- Settings -----------------------------------------------------------------------------

alter table public.settings
add column support_response_text text not null
default 'وصلت رسالتك. احنا هسه برا أوقات الدوام، وراح نرد عليك أول ما نرجع.'
check (char_length(support_response_text) <= 300 and support_response_text = btrim(support_response_text));

-- chat_threads ---------------------------------------------------------------------------

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete restrict,
  last_message_at timestamptz,
  customer_unread integer not null default 0 check (customer_unread >= 0),
  admin_unread integer not null default 0 check (admin_unread >= 0),
  created_at timestamptz not null default now(),
  constraint chat_threads_id_user_id_key unique (id, user_id)
);

alter table public.chat_threads enable row level security;

create index chat_threads_last_message_at_idx
on public.chat_threads (last_message_at desc)
where last_message_at is not null;

revoke all on public.chat_threads from anon, authenticated;
grant select on public.chat_threads to authenticated;

create policy "Customers read their thread; admins read all"
on public.chat_threads
for select
to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

-- chat_messages ----------------------------------------------------------------------------

alter table public.tickets
add constraint tickets_id_user_id_key unique (id, user_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  customer_id uuid not null,
  author public.chat_author not null,
  sender_id uuid references public.profiles (id) on delete restrict,
  kind public.chat_message_kind not null default 'message',
  body text check (
    body is null or (char_length(body) between 1 and 2000 and body = btrim(body))
  ),
  media_path text unique,
  media_type public.media_type,
  duration_s numeric(4, 1) check (duration_s between 0 and 60),
  bytes bigint check (bytes >= 0),
  order_id uuid,
  topic public.chat_topic,
  ticket_id uuid,
  client_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (thread_id, customer_id) references public.chat_threads (id, user_id),
  foreign key (order_id, customer_id) references public.orders (id, customer_id),
  foreign key (ticket_id, customer_id) references public.tickets (id, user_id),
  constraint chat_messages_sender_id_client_id_key unique (sender_id, client_id),
  -- People send messages; the system posts the rest.
  constraint chat_messages_sender check ((author = 'system') = (sender_id is null)),
  constraint chat_messages_client_id check ((author = 'system') = (client_id is null)),
  constraint chat_messages_kind check ((author = 'system') = (kind <> 'message')),
  constraint chat_messages_content check (
    kind <> 'message' or body is not null or media_path is not null or topic is not null
  ),
  constraint chat_messages_media check (
    (media_path is null) = (media_type is null) and (media_path is null) = (bytes is null)
  ),
  constraint chat_messages_duration check (
    (media_type is not distinct from 'video') = (duration_s is not null)
  ),
  constraint chat_messages_topic check (
    topic is null
    or (author = 'customer' and (topic not in ('reschedule', 'cancel') or order_id is not null))
  ),
  constraint chat_messages_system_fields check (
    (kind <> 'no_show' or order_id is not null)
    and (kind <> 'auto_reply' or body is not null)
    and ((kind = 'ticket') = (ticket_id is not null))
  )
);

alter table public.chat_messages enable row level security;

create index chat_messages_thread_id_created_at_idx on public.chat_messages (thread_id, created_at desc);
create index chat_messages_customer_id_idx on public.chat_messages (customer_id);
create index chat_messages_unread_idx on public.chat_messages (thread_id, author) where read_at is null;
create index chat_messages_order_id_customer_id_idx
on public.chat_messages (order_id, customer_id)
where order_id is not null;
create index chat_messages_ticket_id_customer_id_idx
on public.chat_messages (ticket_id, customer_id)
where ticket_id is not null;
create index chat_messages_sender_id_created_at_idx
on public.chat_messages (sender_id, created_at)
where sender_id is not null;

revoke all on public.chat_messages from anon, authenticated;
grant select on public.chat_messages to authenticated;

create policy "Customers read their messages; admins read all"
on public.chat_messages
for select
to authenticated
using (customer_id = (select auth.uid()) or (select private.is_admin()));

alter publication supabase_realtime add table public.chat_threads;
alter publication supabase_realtime add table public.chat_messages;

-- Thread bookkeeping -----------------------------------------------------------------------

-- The customer's thread, made if missing. Returns its id.
create function private.ensure_chat_thread(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.chat_threads (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select t.id into v_id from public.chat_threads as t where t.user_id = p_user_id;
  return v_id;
end;
$$;

-- Each new message moves the thread and counts as unread for the other side.
create function private.chat_message_posted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_threads as t
  set
    last_message_at = greatest(t.last_message_at, new.created_at),
    admin_unread = t.admin_unread + (new.author = 'customer')::integer,
    customer_unread = t.customer_unread + (new.author <> 'customer')::integer
  where t.id = new.thread_id;
  return null;
end;
$$;

create trigger chat_messages_posted
after insert on public.chat_messages
for each row execute function private.chat_message_posted();

-- Working hours ------------------------------------------------------------------------

-- Whether `p_at` is inside support hours: a working day and from the start
-- up to (not including) the end, Baghdad time.
create function private.support_open(p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select extract(dow from l.local)::smallint = any(s.working_days)
      and l.local::time >= s.working_hours_start
      and l.local::time < s.working_hours_end
    from public.settings as s,
      lateral (select p_at at time zone 'Asia/Baghdad' as local) as l
    where s.id
  ), false);
$$;

-- When support hours last closed at or before `p_at` (null with no working
-- days). A week back always finds one when there are working days.
create function private.last_support_close(p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select max(c.closed_at)
  from public.settings as s,
    lateral generate_series(0, 7) as g (n),
    lateral (
      select ((p_at at time zone 'Asia/Baghdad')::date - g.n) as day
    ) as d,
    lateral (
      select (d.day + s.working_hours_end) at time zone 'Asia/Baghdad' as closed_at
    ) as c
  where s.id
    and extract(dow from d.day)::smallint = any(s.working_days)
    and c.closed_at <= p_at;
$$;

-- Chat's header: inside hours now? Everyone may ask.
create function public.support_is_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.support_open(now());
$$;

revoke execute on function public.support_is_open() from public;
grant execute on function public.support_is_open() to anon, authenticated;

-- chat_thread ------------------------------------------------------------------------------

-- The customer's thread id, made if missing, so Chat can listen to it before
-- the first message.
create function public.chat_thread()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or (select private.current_user_role()) is distinct from 'customer' then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  return private.ensure_chat_thread(v_user_id);
end;
$$;

revoke execute on function public.chat_thread() from public, anon;
grant execute on function public.chat_thread() to authenticated;

-- send_chat_message ------------------------------------------------------------------------

create function public.send_chat_message(
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
    select ob.metadata into v_metadata
    from storage.objects as ob
    where ob.bucket_id = 'chat-media'
      and ob.name = p_media_path
      and p_media_path ~ ('^' || v_user_id::text || '/[^/]+$')
      and ob.owner_id = v_user_id::text
      and ob.metadata ->> 'size' is not null
      and ob.created_at > now() - interval '48 hours'
      and not exists (select 1 from public.chat_messages as m where m.media_path = ob.name);
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

revoke execute on function public.send_chat_message(uuid, uuid, text, text, numeric, uuid, public.chat_topic)
from public, anon;
grant execute on function public.send_chat_message(uuid, uuid, text, text, numeric, uuid, public.chat_topic)
to authenticated;

-- mark_chat_read -----------------------------------------------------------------------------

-- Marks the other side's unread messages read and recounts. The thread lock
-- makes a message posted meanwhile wait, so its count is never lost.
create function public.mark_chat_read(p_thread_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role public.app_role := (select private.current_user_role());
  v_thread public.chat_threads;
  v_marked integer;
  v_unread integer;
begin
  if v_user_id is null or v_role is null or v_role not in ('customer', 'admin') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select * into v_thread
  from public.chat_threads as t
  where t.id = p_thread_id and (v_role = 'admin' or t.user_id = v_user_id)
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'thread_not_found';
  end if;

  if v_role = 'customer' then
    update public.chat_messages as m
    set read_at = now()
    where m.thread_id = v_thread.id and m.author <> 'customer' and m.read_at is null;
    get diagnostics v_marked = row_count;

    select count(*) into v_unread
    from public.chat_messages as m
    where m.thread_id = v_thread.id and m.author <> 'customer' and m.read_at is null;
    update public.chat_threads as t
    set customer_unread = v_unread
    where t.id = v_thread.id and t.customer_unread <> v_unread;
  else
    update public.chat_messages as m
    set read_at = now()
    where m.thread_id = v_thread.id and m.author = 'customer' and m.read_at is null;
    get diagnostics v_marked = row_count;

    select count(*) into v_unread
    from public.chat_messages as m
    where m.thread_id = v_thread.id and m.author = 'customer' and m.read_at is null;
    update public.chat_threads as t
    set admin_unread = v_unread
    where t.id = v_thread.id and t.admin_unread <> v_unread;
  end if;

  return v_marked;
end;
$$;

revoke execute on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- admin_chat_inbox ---------------------------------------------------------------------------

-- A4's list: threads with messages, unread first, then newest. Search by name
-- or by phone digits (07…, 7…, +9647… all match).
create function public.admin_chat_inbox(p_search text default null, p_limit integer default 30)
returns table (
  thread_id uuid,
  user_id uuid,
  full_name text,
  phone text,
  last_message_at timestamptz,
  admin_unread integer,
  customer_unread integer,
  last_author public.chat_author,
  last_kind public.chat_message_kind,
  last_body text,
  last_media_type public.media_type,
  last_topic public.chat_topic,
  last_order_id uuid
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_query text := nullif(btrim(p_search), '');
  v_digits text := regexp_replace(
    regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '^0+', ''
  );
  v_pattern text;
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid_limit';
  end if;
  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select
    t.id, t.user_id, p.full_name, p.phone, t.last_message_at, t.admin_unread, t.customer_unread,
    m.author, m.kind, left(m.body, 160), m.media_type, m.topic, m.order_id
  from public.chat_threads as t
  join public.profiles as p on p.id = t.user_id
  left join lateral (
    select l.author, l.kind, l.body, l.media_type, l.topic, l.order_id
    from public.chat_messages as l
    where l.thread_id = t.id
    order by l.created_at desc
    limit 1
  ) as m on true
  where t.last_message_at is not null
    and (
      v_query is null
      or p.full_name ilike v_pattern
      or (char_length(v_digits) >= 3 and p.phone like '%' || v_digits || '%')
    )
  order by (t.admin_unread > 0) desc, t.last_message_at desc, t.id
  limit p_limit;
end;
$$;

revoke execute on function public.admin_chat_inbox(text, integer) from public, anon;
grant execute on function public.admin_chat_inbox(text, integer) to authenticated;

-- System messages ----------------------------------------------------------------------------

-- §6: a no-show posts a message to the customer, tagged with the order. The
-- staff note stays internal.
create function private.post_no_show_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
begin
  select o.customer_id into v_customer_id from public.orders as o where o.id = new.order_id;
  insert into public.chat_messages (thread_id, customer_id, author, kind, order_id)
  values (private.ensure_chat_thread(v_customer_id), v_customer_id, 'system', 'no_show', new.order_id);
  return null;
end;
$$;

create trigger order_events_no_show_message
after insert on public.order_events
for each row
when (new.to_status = 'no_show')
execute function private.post_no_show_message();

-- §5.15, §5.17: a new ticket posts a message with its number and order.
create function private.post_ticket_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.chat_messages (thread_id, customer_id, author, kind, order_id, ticket_id)
  values (private.ensure_chat_thread(new.user_id), new.user_id, 'system', 'ticket', new.order_id, new.id);
  return null;
end;
$$;

create trigger tickets_chat_message
after insert on public.tickets
for each row execute function private.post_ticket_message();

-- Storage: chat-media ------------------------------------------------------------------------

-- Whether a message has sent the file, whoever may read that message. The
-- storage policies need it without RLS: an admin turned customer (or a
-- deleted admin) can no longer read the messages that carry their files, so
-- an RLS-bound check would let them delete a file customers were sent and
-- upload something else under its name (RLS audit).
create function private.chat_media_sent(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.chat_messages as m where m.media_path = p_name);
$$;

create policy "Customers and admins upload chat files to their own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-media'
  and cardinality(storage.foldername(name)) = 1
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.current_user_role()) in ('customer', 'admin')
);

create policy "Chat files are read by their uploader and with their message"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-media'
  and (
    (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and not private.chat_media_sent(objects.name)
    )
    or exists (select 1 from public.chat_messages as m where m.media_path = objects.name)
  )
);

create policy "Uploaders delete chat files until they are sent"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not private.chat_media_sent(objects.name)
);

-- Media cleanup: the chat folder ---------------------------------------------------------------
-- Unchanged from migration media_cleanup except the chat branch.

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
  if p_folder is null or p_folder not in ('customer', 'crew', 'chat') then
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

-- Unchanged from migration media_cleanup except the chat folder.
create or replace function private.invoke_media_cleanup(p_folder text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_folder is null or p_folder not in ('customer', 'crew', 'chat') then
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

-- Daily at 00:37 UTC (03:37 Baghdad), between the other two folders.
select cron.schedule(
  'media-cleanup-chat', '37 0 * * *', $$select private.invoke_media_cleanup('chat')$$
);

revoke execute on all functions in schema private from public;
grant execute on function private.chat_media_sent(text) to authenticated;
