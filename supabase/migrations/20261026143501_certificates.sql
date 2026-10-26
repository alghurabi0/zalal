-- Certificates, ratings and the tickets ratings open (spec §5.15, N15, §6,
-- §7, §10.1; Phase 4, task 2).
--
-- 1. certificates: one per completed order, issued by transition_order() in
--    the same transaction as the move to completed (private.issue_certificate).
--    It copies the sterilant and residual chlorine from the crew's job report;
--    an admin override with no report takes the sterilant from
--    settings.sterilant_text (none when that is empty). next_due_on is the
--    Baghdad completion date + cleaning_interval_months (the reminder cron,
--    Phase 5, reads it). Completing again after an override keeps the id and
--    the public code, so a printed QR stays valid, refreshes the data and
--    clears pdf_path so the server makes the PDF again. An order moved out of
--    completed keeps its row; customers and N15 stop seeing it.
--    The server (service role) makes the PDF from /certificates/[id]/print,
--    uploads it to certificates/<id>/<version>.pdf and records pdf_path.
--    Reads: the customer while the order is completed, admins always. Crews
--    never: the PDF carries the customer's name and masked phone, which crews
--    see only while the job is open (crew_job_contact).
--    Departures from §7:
--    - no `number` column: the certificate number is the order's (ZL-1024),
--      read from orders, so it can't drift;
--    - next_due_on is a date (a calendar day in Baghdad), not a timestamp;
--    - sterilant is nullable, for an admin override with no report and no
--      sterilant in settings (the row is then left off the certificate);
--    - public_code: 8 characters from 32 (no 0, 1, I or O, which read alike),
--      40 random bits; N15 shows nothing personal, so guessing one gains little.
--
-- 2. public_certificate(code): N15 for guests. Returns only the number, issue
--    date, district and tanks, and nothing once the order is no longer
--    completed. Guests have no access to the tables themselves.
--
-- 3. ratings and rate_order(): the customer rates their own completed order
--    once (decision 49): 1–5 stars, company tags, an optional comment. 3 stars
--    or fewer opens a ticket in the same transaction. New errors: ZL025
--    rating_not_allowed (the order isn't completed), ZL026 already_rated.
--    Departures from §7: keyed by order_id (one rating per order); ticket_id
--    links the ticket it opened (A12 links to it); tags are an enum. The tag
--    "الفيديو واضح" in Report.dc.html becomes clear_photos ("الصور واضحة"):
--    v1 has photos and clips, no video (settled Oct 26, 2026).
--
-- 4. tickets: only what ratings need now. Numbered from 1001 (ZL-T-1001);
--    order_id references the customer's own order through (order_id,
--    user_id), which adds a unique key on orders (id, customer_id). Phase 5
--    adds ticket_media, the Issue report (source 'app'), admin status
--    changes and notes, N11, A5 and the chat message a rating ticket posts.
--    Read by the customer and admins; written only through RPCs.
--    Departure from §7: category is null for rating tickets, and a check
--    makes it and the description required for app tickets.
--
-- 5. settings.certificate_text: the standard paragraph on the certificate
--    (spec §10.1 item 4), edited in A13. Seeded with a draft for the owner
--    to review.
--
-- 6. Storage: certificate PDFs are read through the current pdf_path by
--    whoever reads the certificate; only the server writes the bucket.
--
-- None of these tables is in the Realtime publication.

-- Types --------------------------------------------------------------------------------

create type public.rating_tag as enum ('on_time', 'clean_work', 'respectful', 'clear_photos');
create type public.ticket_category as enum ('leak', 'smell', 'late', 'staff', 'payment', 'other');
create type public.ticket_status as enum ('open', 'in_progress', 'closed');
create type public.ticket_source as enum ('app', 'rating');

-- settings ------------------------------------------------------------------------------

alter table public.settings
add column certificate_text text not null default 'تشمل خدمة زلال تفريغ الخزان من الماء، وإزالة الترسبات والأوساخ، وغسل الجدران والأرضية والغطاء، ثم تعقيم الخزان بمادة معقّمة وشطفه قبل إعادة ملئه.'
check (char_length(certificate_text) <= 800 and certificate_text = btrim(certificate_text));

-- certificates -----------------------------------------------------------------------------

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  public_code text not null check (public_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  issued_at timestamptz not null default now(),
  sterilant text check (
    sterilant is null
    or (char_length(sterilant) between 2 and 120 and sterilant = btrim(sterilant))
  ),
  residual_chlorine_mg_l numeric(3, 1) check (residual_chlorine_mg_l between 0 and 10),
  next_due_on date not null,
  -- certificates/<id>/<version>.pdf, set by the server once the PDF is stored.
  pdf_path text check (pdf_path is null or pdf_path like id::text || '/%.pdf'),
  updated_at timestamptz not null default now(),
  constraint certificates_public_code_key unique (public_code),
  constraint certificates_pdf_path_key unique (pdf_path)
);

alter table public.certificates enable row level security;

create trigger certificates_set_updated_at
before update on public.certificates
for each row execute function private.set_updated_at();

revoke all on public.certificates from anon, authenticated;
grant select on public.certificates to authenticated;

create policy "Customers read the certificates of their completed orders; admins all"
on public.certificates
for select
to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.orders as o
    where o.id = order_id
      and o.customer_id = (select auth.uid())
      and o.status = 'completed'
  )
);

create policy "Certificate PDFs are read with their certificate"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'certificates'
  and exists (select 1 from public.certificates as c where c.pdf_path = objects.name)
);

-- 8 characters from 32 (no 0, 1, I, O): 40 random bits.
create function private.new_certificate_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(r.b, i.n) % 32) + 1, 1),
    '' order by i.n
  )
  from (select extensions.gen_random_bytes(8) as b) as r
  cross join generate_series(0, 7) as i (n);
$$;

-- Issues or refreshes the certificate of a completed order. Called only by
-- transition_order(), which holds the order's lock.
create function private.issue_certificate(p_order_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_settings public.settings;
  v_report public.job_reports;
  v_sterilant text;
  v_chlorine numeric;
  v_due date;
  v_tries int := 0;
begin
  select * into v_settings from public.settings;
  select * into v_report from public.job_reports as r where r.order_id = p_order_id;
  if found then
    v_sterilant := v_report.sterilant;
    v_chlorine := v_report.residual_chlorine_mg_l;
  else
    v_sterilant := nullif(v_settings.sterilant_text, '');
    if char_length(v_sterilant) < 2 then
      v_sterilant := null;
    end if;
  end if;
  v_due := (
    (now() at time zone 'Asia/Baghdad')::date
    + make_interval(months => v_settings.cleaning_interval_months)
  )::date;

  loop
    begin
      insert into public.certificates (
        order_id, public_code, issued_at, sterilant, residual_chlorine_mg_l, next_due_on
      )
      values (p_order_id, private.new_certificate_code(), now(), v_sterilant, v_chlorine, v_due)
      on conflict (order_id) do update
      set
        issued_at = excluded.issued_at,
        sterilant = excluded.sterilant,
        residual_chlorine_mg_l = excluded.residual_chlorine_mg_l,
        next_due_on = excluded.next_due_on,
        pdf_path = null;
      return;
    exception when unique_violation then
      -- A new code that is already taken: draw again.
      v_tries := v_tries + 1;
      if v_tries >= 5 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

create function public.public_certificate(p_code text)
returns table (number bigint, issued_at timestamptz, district text, items jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.number,
    c.issued_at,
    o.district,
    (
      select jsonb_agg(
        jsonb_build_object('tank_type', i.tank_type, 'size', i.size, 'qty', i.qty)
        order by i.id
      )
      from public.order_items as i
      where i.order_id = o.id
    )
  from public.certificates as c
  join public.orders as o on o.id = c.order_id
  where c.public_code = upper(btrim(p_code))
    and o.status = 'completed';
$$;

revoke execute on function public.public_certificate(text) from public;
grant execute on function public.public_certificate(text) to anon, authenticated;

-- tickets ------------------------------------------------------------------------------------

alter table public.orders
add constraint orders_id_customer_id_key unique (id, customer_id);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  -- Shown as ZL-T-1001.
  number bigint generated always as identity (start with 1001) unique,
  user_id uuid not null references public.profiles (id) on delete restrict,
  order_id uuid,
  category public.ticket_category,
  description text check (
    description is null
    or (char_length(description) between 10 and 1000 and description = btrim(description))
  ),
  status public.ticket_status not null default 'open',
  source public.ticket_source not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, user_id) references public.orders (id, customer_id),
  constraint tickets_source_fields check (
    (source = 'app' and category is not null and description is not null)
    or (source = 'rating' and order_id is not null)
  )
);

alter table public.tickets enable row level security;

create index tickets_user_id_created_at_idx on public.tickets (user_id, created_at desc);
create index tickets_order_id_user_id_idx on public.tickets (order_id, user_id);
create index tickets_status_idx on public.tickets (status);

create trigger tickets_set_updated_at
before update on public.tickets
for each row execute function private.set_updated_at();

revoke all on public.tickets from anon, authenticated;
revoke all on sequence public.tickets_number_seq from anon, authenticated;
grant select on public.tickets to authenticated;

create policy "Customers read their tickets; admins all"
on public.tickets
for select
to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

-- ratings -------------------------------------------------------------------------------------

create table public.ratings (
  order_id uuid primary key references public.orders (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  tags public.rating_tag[] not null default '{}',
  comment text check (
    comment is null or (char_length(comment) between 1 and 500 and comment = btrim(comment))
  ),
  -- The ticket a rating of 3 stars or fewer opened.
  ticket_id uuid unique references public.tickets (id),
  created_at timestamptz not null default now()
);

alter table public.ratings enable row level security;

revoke all on public.ratings from anon, authenticated;
grant select on public.ratings to authenticated;

create policy "Customers read the ratings of their orders; admins all"
on public.ratings
for select
to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1 from public.orders as o where o.id = order_id and o.customer_id = (select auth.uid())
  )
);

-- Returns the number of the ticket it opened, or null.
create function public.rate_order(
  p_order_id uuid,
  p_stars integer,
  p_tags public.rating_tag[] default '{}',
  p_comment text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_order public.orders;
  v_comment text := nullif(btrim(p_comment), '');
  v_ticket public.tickets;
begin
  if v_user_id is null or (select private.current_user_role()) is distinct from 'customer' then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select * into v_order
  from public.orders as o
  where o.id = p_order_id and o.customer_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;
  if v_order.status <> 'completed' then
    raise exception using errcode = 'ZL025', message = 'rating_not_allowed';
  end if;
  if exists (select 1 from public.ratings as r where r.order_id = v_order.id) then
    raise exception using errcode = 'ZL026', message = 'already_rated';
  end if;
  if p_stars is null or p_stars not between 1 and 5 then
    raise exception using errcode = '22023', message = 'invalid_stars';
  end if;
  if char_length(v_comment) > 500 then
    raise exception using errcode = '22023', message = 'invalid_comment';
  end if;

  -- 3 stars or fewer opens a support ticket (decision 49).
  if p_stars <= 3 then
    insert into public.tickets (user_id, order_id, source)
    values (v_user_id, v_order.id, 'rating')
    returning * into v_ticket;
  end if;

  insert into public.ratings (order_id, stars, tags, comment, ticket_id)
  values (
    v_order.id,
    p_stars,
    (select coalesce(array_agg(distinct t order by t), '{}') from unnest(coalesce(p_tags, '{}')) as t),
    v_comment,
    v_ticket.id
  );

  return v_ticket.number;
end;
$$;

revoke execute on function public.rate_order(uuid, integer, public.rating_tag[], text)
from public, anon;
grant execute on function public.rate_order(uuid, integer, public.rating_tag[], text)
to authenticated;

-- transition_order ------------------------------------------------------------------------------
-- Unchanged from migration crew_job_media except the certificate step.

create or replace function public.transition_order(
  p_order_id uuid,
  p_to_status public.order_status,
  p_payload jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role public.app_role := (select private.current_user_role());
  v_payload jsonb := coalesce(p_payload, '{}');
  v_settings public.settings;
  v_order public.orders;
  v_from public.order_status;
  v_reason text;
  v_cancel_reason public.cancel_reason;
  v_override boolean := false;
  v_allowed boolean := false;
  v_reschedule boolean;
  v_new_date date;
  v_new_slot public.slots;
  v_cash boolean;
  v_details jsonb := '{}';
  v_event_id bigint;
  v_sterilant text;
  v_chlorine numeric;
begin
  if v_user_id is null or v_role is null then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_payload';
  end if;

  select * into v_order from public.orders as o where o.id = p_order_id for update;
  if not found
    or (v_role = 'customer' and v_order.customer_id <> v_user_id)
    or (v_role = 'crew' and not coalesce(v_order.crew_id = private.current_crew_id(), false))
  then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;

  select * into v_settings from public.settings;
  v_from := v_order.status;
  v_reason := nullif(btrim(v_payload ->> 'reason'), '');
  v_cash := coalesce((v_payload ->> 'cash_collected')::boolean, false);
  v_reschedule := p_to_status = 'pending_confirmation'
    and v_from in ('pending_confirmation', 'confirmed');

  if p_to_status = v_from and not v_reschedule then
    raise exception using errcode = 'ZL010', message = 'invalid_transition';
  end if;

  -- The §6 table: who may make which move.
  if v_role = 'customer' then
    v_allowed := v_from in ('pending_confirmation', 'confirmed')
      and p_to_status in ('cancelled', 'pending_confirmation');
  elsif v_role = 'crew' then
    v_allowed := (v_from = 'confirmed' and p_to_status = 'on_the_way')
      or (v_from = 'on_the_way' and p_to_status = 'arrived')
      or (v_from = 'arrived' and p_to_status = 'in_progress')
      or (v_from = 'in_progress' and p_to_status = 'completed')
      or (v_from in ('confirmed', 'on_the_way', 'arrived') and p_to_status = 'no_show');
  elsif v_role = 'admin' then
    v_allowed := (v_from = 'pending_confirmation' and p_to_status = 'confirmed')
      or (v_from in ('pending_confirmation', 'confirmed')
          and p_to_status in ('cancelled', 'pending_confirmation'))
      or (v_from in ('confirmed', 'on_the_way', 'arrived') and p_to_status = 'no_show');
    v_override := not v_allowed and coalesce((v_payload ->> 'override')::boolean, false);
  end if;

  if not v_allowed and not v_override then
    raise exception using errcode = 'ZL010', message = 'invalid_transition';
  end if;

  -- Customers change an order only until cancel_cutoff_hours before the slot.
  if v_role = 'customer'
    and now() > v_order.slot_start_at - make_interval(hours => v_settings.cancel_cutoff_hours)
  then
    raise exception using errcode = 'ZL006', message = 'change_too_late';
  end if;

  -- What each move needs.
  if v_override then
    if v_reason is null then
      raise exception using errcode = 'ZL011', message = 'reason_required';
    end if;
  elsif p_to_status = 'cancelled' then
    if v_role = 'customer' then
      if v_payload ->> 'cancel_reason' is null then
        raise exception using errcode = '22023', message = 'cancel_reason_required';
      end if;
      if not (v_payload ->> 'cancel_reason' = any (enum_range(null::public.cancel_reason)::text[])) then
        raise exception using errcode = '22023', message = 'invalid_cancel_reason';
      end if;
      v_cancel_reason := (v_payload ->> 'cancel_reason')::public.cancel_reason;
    elsif v_reason is null then
      raise exception using errcode = 'ZL011', message = 'reason_required';
    end if;
  elsif p_to_status = 'no_show' then
    if v_reason is null then
      raise exception using errcode = 'ZL011', message = 'reason_required';
    end if;
  elsif v_reschedule then
    if not (v_payload ? 'service_date' and v_payload ? 'slot_id') then
      raise exception using errcode = '22023', message = 'new_slot_required';
    end if;
    v_new_date := (v_payload ->> 'service_date')::date;
    v_new_slot := private.bookable_slot(
      v_new_date, (v_payload ->> 'slot_id')::bigint, v_role = 'customer'
    );
    if v_new_date = v_order.service_date and v_new_slot.id = v_order.slot_id then
      raise exception using errcode = '22023', message = 'same_slot';
    end if;
  elsif p_to_status = 'on_the_way' then
    if v_order.crew_id is null then
      raise exception using errcode = 'ZL011', message = 'crew_not_assigned';
    end if;
  elsif p_to_status = 'completed' then
    -- Before and after photos are optional (settled Oct 26, 2026).
    -- Phase 6: not needed for subscription orders.
    if not v_cash then
      raise exception using errcode = 'ZL011', message = 'cash_not_collected';
    end if;
    -- The C4 form (crew only; an admin override needs none of it).
    if v_role = 'crew' then
      v_sterilant := nullif(btrim(v_payload ->> 'sterilant'), '');
      if v_sterilant is null then
        raise exception using errcode = 'ZL011', message = 'sterilant_required';
      end if;
      if char_length(v_sterilant) not between 2 and 120 then
        raise exception using errcode = '22023', message = 'invalid_sterilant';
      end if;
      if coalesce(jsonb_typeof(v_payload -> 'residual_chlorine_mg_l'), 'null') <> 'null' then
        if jsonb_typeof(v_payload -> 'residual_chlorine_mg_l') <> 'number' then
          raise exception using errcode = '22023', message = 'invalid_chlorine';
        end if;
        v_chlorine := (v_payload -> 'residual_chlorine_mg_l')::numeric;
        if v_chlorine not between 0 and 10 or v_chlorine <> round(v_chlorine, 1) then
          raise exception using errcode = '22023', message = 'invalid_chlorine';
        end if;
      end if;
      -- The crew's note is internal, like every staff note (settled Oct 26, 2026).
      v_reason := nullif(btrim(v_payload ->> 'note'), '');
    end if;
  end if;

  -- Places.
  if v_reschedule and not v_override then
    perform private.release_seat(v_order.id);
    perform private.reserve_seat(v_order.id, v_new_date, v_new_slot.id);
    v_details := jsonb_build_object(
      'from_service_date', v_order.service_date,
      'from_slot_id', v_order.slot_id,
      'to_service_date', v_new_date,
      'to_slot_id', v_new_slot.id
    );
    update public.orders as o
    set
      service_date = v_new_date,
      slot_id = v_new_slot.id,
      slot_start_at = (v_new_date + v_new_slot.start_time) at time zone 'Asia/Baghdad',
      slot_end_at = (v_new_date + v_new_slot.end_time) at time zone 'Asia/Baghdad'
    where o.id = v_order.id;
  elsif p_to_status = 'cancelled' then
    perform private.release_seat(v_order.id);
  elsif v_from = 'cancelled' then
    -- An override brings a cancelled order back: it needs its place again.
    perform private.reserve_seat(v_order.id, v_order.service_date, v_order.slot_id);
  end if;

  if p_to_status = 'completed' then
    v_details := v_details || jsonb_build_object('cash_collected', v_cash);
    update public.tanks as t
    set last_cleaned_at = now()
    where t.id in (select i.tank_id from public.order_items as i where i.order_id = v_order.id);
  end if;

  update public.orders as o
  set
    status = p_to_status,
    cash_collected = o.cash_collected or (p_to_status = 'completed' and v_cash)
  where o.id = v_order.id;

  if p_to_status = 'completed' and v_role = 'crew' then
    -- One report per order: completing again after an override replaces it.
    insert into public.job_reports (order_id, crew_id, sterilant, residual_chlorine_mg_l)
    values (v_order.id, v_order.crew_id, v_sterilant, v_chlorine)
    on conflict (order_id) do update
    set
      crew_id = excluded.crew_id,
      sterilant = excluded.sterilant,
      residual_chlorine_mg_l = excluded.residual_chlorine_mg_l;
  end if;

  -- Every move to completed issues (or refreshes) the certificate, after the
  -- report it copies (spec §6).
  if p_to_status = 'completed' then
    perform private.issue_certificate(v_order.id);
  end if;

  insert into public.order_events (
    order_id, from_status, to_status, actor_id, actor_role, cancel_reason, is_override, details
  )
  values (
    v_order.id, v_from, p_to_status, v_user_id, v_role, v_cancel_reason, v_override, v_details
  )
  returning id into v_event_id;

  -- Staff reasons are internal notes; customers send no free text here.
  if v_reason is not null and v_role <> 'customer' then
    insert into public.order_event_notes (event_id, order_id, note)
    values (v_event_id, v_order.id, v_reason);
  end if;

  if v_role = 'admin' then
    perform private.log_admin_action(
      'order.transition', 'orders', v_order.id::text,
      jsonb_build_object('from', v_from, 'to', p_to_status, 'override', v_override, 'reason', v_reason)
        || v_details
    );
  end if;
end;
$$;


revoke execute on all functions in schema private from public;
