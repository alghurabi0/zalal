-- Notifications: the in-app list, Web Push and cleaning reminders (spec §5.7,
-- §9.2, N5's push card; §6 side effects). Phase 5, task 3.
--
-- 1. notifications: one row per event per person. The customer's list
--    (Notifications.dc.html, the Home bell) reads them; every row except
--    work_started is also sent as Web Push. Each user reads only their own
--    rows, admins too (nothing needs another user's). Nobody writes the
--    table through the API: rows come from the triggers and the reminder job
--    below. mark_notification_read(id) and mark_all_notifications_read()
--    set read_at. In the Realtime publication (uuid keys: DELETE events
--    reach every subscriber).
--    Departures from §7:
--    - type is an enum, and data (jsonb) holds only the values the words
--      need (order number, slot, district, ticket number and status, an
--      80-character chat excerpt, the reminder's kind). No title, body or
--      link: the app writes the words from ar.json, as for chat system
--      messages (no Arabic stored), and builds the link from routes, so no
--      URL is copied into SQL. order_id and ticket_id name what a row is
--      about (and go with it).
--    - Admins and crews get rows too (that's how their push is sent) but no
--      list screen in v1 (settled Oct 27, 2026).
--
-- 2. push_subscriptions: one row per browser that allowed push, keyed by its
--    endpoint. Nobody reads or writes the table through the API; the Edge
--    Function send-push reads it with the service key and deletes endpoints
--    that answer 404 or 410. save_push_subscription(endpoint, p256dh, auth,
--    user_agent) saves the browser under whoever is logged in now (a shared
--    crew phone, a new login), only for https endpoints of the known push
--    services, so send-push never calls anything else; at most 10 per user.
--    delete_push_subscription(endpoint) runs on logout.
--    Departure from §7: saved_at (clock time of the last save, for the
--    limit) and created_at instead of an updated_at trigger.
--
-- 3. Which events notify whom (the §9.2 table plus the defaults settled on
--    Oct 27, 2026), from triggers so transition_order, assign_crew,
--    send_chat_message, create_ticket, rate_order and admin_set_ticket_status
--    stay as they are:
--    - order_events: a booking → admins (new_booking); confirmed → the
--      customer (order_confirmed) and the assigned crew (new_job); a
--      reschedule or cancel by the customer → admins (customer_rescheduled,
--      customer_cancelled with the N6 reason), by staff → the customer
--      (order_rescheduled, order_cancelled); on the way, arrived, in
--      progress, completed, no-show → the customer (crew_on_the_way,
--      crew_arrived, work_started (in-app only, §6), order_completed,
--      order_no_show). A cancel or reschedule of a job the crew could see
--      tells the crew (job_changed), so it doesn't drive to a cancelled job.
--      Admin overrides notify only into completed and cancelled.
--    - orders.crew_id on a confirmed or on-the-way order: the new crew
--      (new_job), the old one (job_changed, reassigned).
--    - chat_messages (people's messages only): a customer's → admins
--      (customer_message), support's → the customer (support_message). The
--      customer reading Chat marks their support_message rows read.
--    - tickets: an Issue report → admins (new_ticket); a status change → the
--      customer (ticket_status). ratings with a ticket → admins (new_ticket,
--      with the stars). Notes notify nobody.
--    Deleted accounts and switched-off crews get nothing.
--
-- 4. Push: after each insert statement on notifications, the new ids whose
--    user has a subscription go to send-push, 200 per request, through
--    private.invoke_send_push (pg_net, Vault secrets project_url and
--    send_push_secret, header x-send-push-secret). Without the secrets it
--    sends nothing, so the migration is safe before the owner adds them
--    (docs/supabase-setup.md step 9). Push is best effort: a failed request
--    leaves the in-app row.
--
-- 5. Reminders (§9.2): private.send_cleaning_reminders(day), daily at
--    07:03 UTC (10:03 Baghdad), 7 days before certificates.next_due_on and
--    on the day, catching up within the week when a run is missed. Only
--    while reminders_enabled, for a live account and address, with no newer
--    certificate and no open order at that address. cleaning_reminders
--    (new) records each one, so none goes twice; a re-issued certificate
--    with a new date gets its own.
--
-- 6. Retention: notifications older than 90 days are deleted nightly
--    (01:07 UTC, 04:07 Baghdad; settled Oct 27, 2026).

-- Types ---------------------------------------------------------------------------------

create type public.notification_type as enum (
  -- Customers
  'order_confirmed',
  'order_rescheduled',
  'order_cancelled',
  'crew_on_the_way',
  'crew_arrived',
  'work_started',
  'order_completed',
  'order_no_show',
  'support_message',
  'ticket_status',
  'cleaning_reminder',
  -- Admins
  'new_booking',
  'customer_rescheduled',
  'customer_cancelled',
  'customer_message',
  'new_ticket',
  -- Crews
  'new_job',
  'job_changed'
);

create type public.reminder_kind as enum ('week', 'due');

-- notifications ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.notification_type not null,
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  order_id uuid references public.orders (id) on delete cascade,
  ticket_id uuid references public.tickets (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create index notifications_user_id_created_at_idx on public.notifications (user_id, created_at desc);
create index notifications_user_id_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_order_id_idx on public.notifications (order_id) where order_id is not null;
create index notifications_ticket_id_idx on public.notifications (ticket_id) where ticket_id is not null;
create index notifications_created_at_idx on public.notifications (created_at);

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

create policy "Users read their own notifications"
on public.notifications
for select
to authenticated
using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.notifications;

-- push_subscriptions ------------------------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Checked against the push services in save_push_subscription.
  endpoint text not null unique check (char_length(endpoint) between 1 and 1000),
  -- The browser's P-256 key (65 bytes) and auth secret (16 bytes), base64url.
  p256dh text not null check (p256dh ~ '^B[A-Za-z0-9_-]{86}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  user_agent text check (
    user_agent is null or (char_length(user_agent) between 1 and 300 and user_agent = btrim(user_agent))
  ),
  created_at timestamptz not null default now(),
  saved_at timestamptz not null default clock_timestamp()
);

alter table public.push_subscriptions enable row level security;

create index push_subscriptions_user_id_saved_at_idx on public.push_subscriptions (user_id, saved_at desc);

-- No API access: the RPCs below and the service key only.
revoke all on public.push_subscriptions from anon, authenticated;

-- cleaning_reminders ------------------------------------------------------------------------

create table public.cleaning_reminders (
  certificate_id uuid not null references public.certificates (id) on delete cascade,
  due_on date not null,
  kind public.reminder_kind not null,
  created_at timestamptz not null default now(),
  primary key (certificate_id, due_on, kind)
);

alter table public.cleaning_reminders enable row level security;

create index cleaning_reminders_due_on_idx on public.cleaning_reminders (due_on);

revoke all on public.cleaning_reminders from anon, authenticated;

-- Read marks --------------------------------------------------------------------------------

-- The caller's own notification; an already-read one keeps its time.
create function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or (select private.current_user_role()) is null then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  update public.notifications as n
  set read_at = coalesce(n.read_at, now())
  where n.id = p_notification_id and n.user_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'notification_not_found';
  end if;
end;
$$;

revoke execute on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- Every unread notification of the caller ("قراءة الكل"). Returns how many.
create function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count integer;
begin
  if v_user_id is null or (select private.current_user_role()) is null then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  update public.notifications as n
  set read_at = now()
  where n.user_id = v_user_id and n.read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- Push subscriptions --------------------------------------------------------------------------

-- Saves this browser's subscription for the caller. An endpoint already
-- stored moves to the caller: the browser belongs to whoever is logged in.
create function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_host text;
begin
  if v_user_id is null or (select private.current_user_role()) is null then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  -- Only the browsers' push services, so send-push never posts anywhere
  -- else: Chrome, Edge (Chromium), Opera and Samsung use FCM, Firefox
  -- Mozilla's autopush, Safari Apple's, legacy Edge Windows'.
  v_host := substring(p_endpoint from '^https://([^/?#]*)');
  if p_endpoint is null
    or char_length(p_endpoint) > 1000
    or p_endpoint ~ '\s'
    or v_host is null
    or v_host !~ '^(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$'
  then
    raise exception using errcode = '22023', message = 'invalid_endpoint';
  end if;
  if p_p256dh is null or p_p256dh !~ '^B[A-Za-z0-9_-]{86}$'
    or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$'
  then
    raise exception using errcode = '22023', message = 'invalid_keys';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, saved_at)
  values (
    v_user_id, p_endpoint, p_p256dh, p_auth,
    nullif(left(btrim(coalesce(p_user_agent, '')), 300), ''), clock_timestamp()
  )
  on conflict (endpoint) do update
  set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    saved_at = excluded.saved_at;

  -- At most 10 browsers per user: the least recently saved go.
  delete from public.push_subscriptions as s
  where s.user_id = v_user_id
    and s.id not in (
      select k.id from public.push_subscriptions as k
      where k.user_id = v_user_id
      order by k.saved_at desc
      limit 10
    );
end;
$$;

revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- Logout: forgets this browser for the caller. Someone else's endpoint is
-- left alone.
create function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  delete from public.push_subscriptions as s
  where s.endpoint = p_endpoint and s.user_id = v_user_id;
end;
$$;

revoke execute on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- Writing notifications -------------------------------------------------------------------------

-- One person, unless the account is deleted.
create function private.notify_user(
  p_user_id uuid,
  p_type public.notification_type,
  p_data jsonb,
  p_order_id uuid default null,
  p_ticket_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, data, order_id, ticket_id)
  select p.id, p_type, p_data, p_order_id, p_ticket_id
  from public.profiles as p
  where p.id = p_user_id and p.deleted_at is null;
$$;

-- Every live admin, in one statement (one push request).
create function private.notify_admins(
  p_type public.notification_type,
  p_data jsonb,
  p_order_id uuid default null,
  p_ticket_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, data, order_id, ticket_id)
  select p.id, p_type, p_data, p_order_id, p_ticket_id
  from public.profiles as p
  where p.role = 'admin' and p.deleted_at is null;
$$;

-- A crew's account, while the crew is active and the account is a crew.
create function private.notify_crew(
  p_crew_id uuid,
  p_type public.notification_type,
  p_data jsonb,
  p_order_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, data, order_id)
  select p.id, p_type, p_data, p_order_id
  from public.crews as c
  join public.profiles as p on p.id = c.user_id
  where c.id = p_crew_id and c.active and p.role = 'crew' and p.deleted_at is null;
$$;

-- What an order's notification needs: its number, day, slot and district.
create function private.order_notice(p_order public.orders)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'number', p_order.number,
    'service_date', p_order.service_date,
    'slot_start_at', p_order.slot_start_at,
    'slot_end_at', p_order.slot_end_at,
    'district', p_order.district
  );
$$;

-- Order events (§6, §9.2).
create function private.notify_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_data jsonb;
begin
  select * into v_order from public.orders as o where o.id = new.order_id;
  v_data := private.order_notice(v_order);

  -- A booking.
  if new.from_status is null then
    perform private.notify_admins('new_booking', v_data, v_order.id);
    return null;
  end if;

  -- A job the crew could see leaves its schedule.
  if v_order.crew_id is not null
    and new.from_status in ('confirmed', 'on_the_way', 'arrived', 'in_progress')
    and (
      new.to_status = 'cancelled'
      or (new.to_status = 'pending_confirmation' and not new.is_override)
    )
  then
    perform private.notify_crew(
      v_order.crew_id, 'job_changed',
      v_data || jsonb_build_object(
        'change', case when new.to_status = 'cancelled' then 'cancelled' else 'rescheduled' end
      ),
      v_order.id
    );
  end if;

  -- Overrides are corrections: only a certificate or a cancel is news.
  if new.is_override then
    if new.to_status = 'completed' then
      perform private.notify_user(v_order.customer_id, 'order_completed', v_data, v_order.id);
    elsif new.to_status = 'cancelled' then
      perform private.notify_user(v_order.customer_id, 'order_cancelled', v_data, v_order.id);
    end if;
    return null;
  end if;

  case new.to_status
    when 'confirmed' then
      perform private.notify_user(v_order.customer_id, 'order_confirmed', v_data, v_order.id);
      if v_order.crew_id is not null then
        perform private.notify_crew(v_order.crew_id, 'new_job', v_data, v_order.id);
      end if;
    when 'pending_confirmation' then
      if new.actor_role = 'customer' then
        perform private.notify_admins('customer_rescheduled', v_data, v_order.id);
      else
        perform private.notify_user(v_order.customer_id, 'order_rescheduled', v_data, v_order.id);
      end if;
    when 'cancelled' then
      if new.actor_role = 'customer' then
        perform private.notify_admins(
          'customer_cancelled',
          v_data || jsonb_strip_nulls(jsonb_build_object('cancel_reason', new.cancel_reason)),
          v_order.id
        );
      else
        perform private.notify_user(v_order.customer_id, 'order_cancelled', v_data, v_order.id);
      end if;
    when 'on_the_way' then
      perform private.notify_user(v_order.customer_id, 'crew_on_the_way', v_data, v_order.id);
    when 'arrived' then
      perform private.notify_user(v_order.customer_id, 'crew_arrived', v_data, v_order.id);
    when 'in_progress' then
      perform private.notify_user(v_order.customer_id, 'work_started', v_data, v_order.id);
    when 'completed' then
      perform private.notify_user(v_order.customer_id, 'order_completed', v_data, v_order.id);
    when 'no_show' then
      perform private.notify_user(v_order.customer_id, 'order_no_show', v_data, v_order.id);
    else
      null;
  end case;
  return null;
end;
$$;

create trigger order_events_notify
after insert on public.order_events
for each row execute function private.notify_order_event();

-- Crew changes on a job the crew can see (assign_crew).
create function private.notify_crew_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb := private.order_notice(new);
begin
  if new.status not in ('confirmed', 'on_the_way') then
    return null;
  end if;
  if old.crew_id is not null then
    perform private.notify_crew(
      old.crew_id, 'job_changed', v_data || '{"change": "reassigned"}', new.id
    );
  end if;
  if new.crew_id is not null then
    perform private.notify_crew(new.crew_id, 'new_job', v_data, new.id);
  end if;
  return null;
end;
$$;

create trigger orders_crew_notify
after update of crew_id on public.orders
for each row
when (old.crew_id is distinct from new.crew_id)
execute function private.notify_crew_change();

-- Chat: people's messages only. System messages notify nothing: the no-show
-- has its own notification, and the customer made the ticket and the
-- message the automatic reply answers.
create function private.notify_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb := jsonb_strip_nulls(jsonb_build_object(
    'excerpt', case
      when new.body is null then null
      when char_length(new.body) > 80 then left(new.body, 79) || '…'
      else new.body
    end,
    'media_type', new.media_type,
    'topic', new.topic
  ));
begin
  if new.author = 'customer' then
    perform private.notify_admins(
      'customer_message', v_data || jsonb_build_object('thread_id', new.thread_id), new.order_id
    );
  elsif new.author = 'admin' then
    perform private.notify_user(new.customer_id, 'support_message', v_data, new.order_id);
  end if;
  return null;
end;
$$;

create trigger chat_messages_notify
after insert on public.chat_messages
for each row
when (new.kind = 'message')
execute function private.notify_chat_message();

-- The customer read Chat (mark_chat_read): support's notifications are read.
create function private.read_chat_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications as n
  set read_at = now()
  where n.user_id = new.user_id and n.type = 'support_message' and n.read_at is null;
  return null;
end;
$$;

create trigger chat_threads_read_notifications
after update of customer_unread on public.chat_threads
for each row
when (new.customer_unread = 0 and old.customer_unread > 0)
execute function private.read_chat_notifications();

-- Tickets: an Issue report and a status change. A low rating's ticket is
-- told from ratings, which has its stars (the ticket is inserted first).
create function private.notify_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.notify_admins(
      'new_ticket',
      jsonb_strip_nulls(jsonb_build_object(
        'ticket_number', new.number,
        'source', new.source,
        'category', new.category,
        'order_number', (select o.number from public.orders as o where o.id = new.order_id)
      )),
      new.order_id,
      new.id
    );
  else
    perform private.notify_user(
      new.user_id, 'ticket_status',
      jsonb_build_object('ticket_number', new.number, 'status', new.status),
      null,
      new.id
    );
  end if;
  return null;
end;
$$;

create trigger tickets_notify_new
after insert on public.tickets
for each row
when (new.source = 'app')
execute function private.notify_ticket();

create trigger tickets_notify_status
after update of status on public.tickets
for each row
when (old.status is distinct from new.status)
execute function private.notify_ticket();

create function private.notify_rating_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_admins(
    'new_ticket',
    jsonb_build_object(
      'ticket_number', (select t.number from public.tickets as t where t.id = new.ticket_id),
      'source', 'rating',
      'stars', new.stars,
      'order_number', (select o.number from public.orders as o where o.id = new.order_id)
    ),
    new.order_id,
    new.ticket_id
  );
  return null;
end;
$$;

create trigger ratings_notify_ticket
after insert on public.ratings
for each row
when (new.ticket_id is not null)
execute function private.notify_rating_ticket();

-- Sending push --------------------------------------------------------------------------------

-- Posts the ids to send-push. Returns the pg_net request id, or null when
-- the Vault secrets aren't there yet.
create function private.invoke_send_push(p_ids uuid[])
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select s.decrypted_secret into v_url
  from vault.decrypted_secrets as s
  where s.name = 'project_url';
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets as s
  where s.name = 'send_push_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;

  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/send-push',
    body := jsonb_build_object('ids', to_jsonb(p_ids)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-send-push-secret', v_secret
    ),
    timeout_milliseconds := 30000
  );
end;
$$;

-- After each insert statement: the new rows that can reach a browser, 200
-- per request.
create function private.queue_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  for v_ids in
    select array_agg(r.id order by r.id)
    from (
      select n.id, (row_number() over (order by n.id) - 1) / 200 as chunk
      from new_rows as n
      where n.type <> 'work_started'
        and exists (select 1 from public.push_subscriptions as s where s.user_id = n.user_id)
    ) as r
    group by r.chunk
  loop
    perform private.invoke_send_push(v_ids);
  end loop;
  return null;
end;
$$;

create trigger notifications_queue_push
after insert on public.notifications
referencing new table as new_rows
for each statement execute function private.queue_push();

-- Reminders -----------------------------------------------------------------------------------

-- Writes the day's cleaning reminders (Baghdad day by default). Returns how
-- many.
create function private.send_cleaning_reminders(
  p_today date default (now() at time zone 'Asia/Baghdad')::date
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with candidates as (
    select
      c.id as certificate_id,
      c.next_due_on,
      case
        when c.next_due_on > p_today then 'week'
        else 'due'
      end::public.reminder_kind as kind,
      o.id as order_id,
      o.customer_id,
      a.label
    from public.certificates as c
    join public.orders as o on o.id = c.order_id and o.status = 'completed'
    join public.profiles as p
      on p.id = o.customer_id and p.role = 'customer' and p.deleted_at is null and p.reminders_enabled
    join public.addresses as a on a.id = o.address_id and a.deleted_at is null
    where c.next_due_on between p_today - 6 and p_today + 7
      -- Cleaned again since: the newer certificate is the one that counts.
      and not exists (
        select 1
        from public.certificates as c2
        join public.orders as o2 on o2.id = c2.order_id
        where o2.address_id = o.address_id
          and o2.status = 'completed'
          and c2.id <> c.id
          and c2.next_due_on > c.next_due_on
      )
      -- Already booked.
      and not exists (
        select 1 from public.orders as o3
        where o3.address_id = o.address_id
          and o3.status in ('pending_confirmation', 'confirmed', 'on_the_way', 'arrived', 'in_progress')
      )
  ),
  recorded as (
    insert into public.cleaning_reminders (certificate_id, due_on, kind)
    select cd.certificate_id, cd.next_due_on, cd.kind from candidates as cd
    on conflict do nothing
    returning certificate_id, due_on, kind
  )
  insert into public.notifications (user_id, type, data, order_id)
  select
    cd.customer_id,
    'cleaning_reminder',
    jsonb_build_object(
      'kind', r.kind,
      'due_on', r.due_on,
      'months', s.cleaning_interval_months,
      'label', cd.label
    ),
    cd.order_id
  from recorded as r
  join candidates as cd on cd.certificate_id = r.certificate_id and cd.kind = r.kind
  cross join public.settings as s;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Retention -----------------------------------------------------------------------------------

-- Notifications older than 90 days, read or not, and reminder records long
-- past their window. Returns how many notifications went.
create function private.prune_notifications()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.notifications as n where n.created_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  delete from public.cleaning_reminders as r
  where r.due_on < (now() at time zone 'Asia/Baghdad')::date - 30;
  return v_count;
end;
$$;

-- Jobs ------------------------------------------------------------------------------------

-- Daily at 07:03 UTC (10:03 Baghdad, §9.2's 10:00 moved off the hour).
select cron.schedule(
  'notifications-reminders', '3 7 * * *', $$select private.send_cleaning_reminders()$$
);
-- Nightly at 01:07 UTC (04:07 Baghdad).
select cron.schedule(
  'notifications-prune', '7 1 * * *', $$select private.prune_notifications()$$
);

revoke execute on all functions in schema private from public;
