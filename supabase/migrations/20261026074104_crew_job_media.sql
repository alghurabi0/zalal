-- The crew app, part B (spec §6, §7, §8.1 C3b and C4).
--
-- 1. Job media. The crew uploads before/after photos and clips straight to
--    Storage (order-media, crew/<crew id>/<order id>/<file>) over TUS, then
--    attach_job_media() records each finished upload in order_media. The
--    folder is named by the crew, not the account, so a crew moved to a new
--    phone account (admin_set_crew_phone) keeps its folder. Uploads and
--    attaches are allowed while the job is arrived or in progress, and for
--    24 hours after the crew completes it, so files queued offline when the
--    crew tapped خلصنا still land (settled Oct 26, 2026). Limits per order:
--    10 before photos, 10 after photos, 4 clips of at most 60 s (ZL008).
--    remove_job_media() lets the crew take back a wrong photo while the job is
--    open; the app then deletes the file through the Storage API.
--    New error: ZL023 media_not_allowed (the job is not in a state that takes
--    media).
--
-- 2. job_reports: what the crew records on the C4 finish form until
--    certificates exist (Phase 4 copies it onto the certificate). One row per
--    order with the sterilant and the optional residual chlorine reading,
--    written only by transition_order()'s completion step. Read with its
--    order: the customer will see both on the certificate anyway. Departure
--    from §7: §7 had these columns only on certificates (Phase 4); they are
--    recorded now, at completion, and the crew's C4 note is not a column
--    here but an internal note (order_event_notes) on the completion event,
--    like every staff note, so the customer never reads it.
--
-- 3. transition_order(): when the crew completes a job, the payload carries
--    the C4 fields: sterilant (required, ZL011 sterilant_required; 2–120
--    characters), residual_chlorine_mg_l (optional JSON number 0–10, one
--    decimal) and note (optional). Everything else is unchanged.

-- job_reports -------------------------------------------------------------------------

create table public.job_reports (
  order_id uuid primary key references public.orders (id) on delete cascade,
  -- The crew that completed the job.
  crew_id uuid not null references public.crews (id),
  sterilant text not null check (
    char_length(sterilant) between 2 and 120 and sterilant = btrim(sterilant)
  ),
  -- Optional, and not validated as a reading (spec §1: no chlorine-reading validation).
  residual_chlorine_mg_l numeric(3, 1) check (residual_chlorine_mg_l between 0 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.job_reports enable row level security;

create index job_reports_crew_id_idx on public.job_reports (crew_id);

create trigger job_reports_set_updated_at
before update on public.job_reports
for each row execute function private.set_updated_at();

revoke all on public.job_reports from anon, authenticated;
grant select on public.job_reports to authenticated;

create policy "Job reports are read with their order"
on public.job_reports
for select
to authenticated
using (exists (select 1 from public.orders as o where o.id = order_id));

-- transition_order ------------------------------------------------------------------

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


-- Job media ---------------------------------------------------------------------------

-- Whether a job takes crew media now: arrived or in progress, or completed
-- less than 24 hours ago. Used by the RPCs below; the Storage insert policy
-- spells out the same rule, since policies can't call it.
create function private.job_takes_media(p_order_id uuid, p_status public.order_status)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status in ('arrived', 'in_progress')
    or (
      p_status = 'completed'
      and exists (
        select 1 from public.order_events as e
        where e.order_id = p_order_id
          and e.to_status = 'completed'
          and e.created_at > now() - interval '24 hours'
      )
    );
$$;

create function public.attach_job_media(
  p_order_id uuid,
  p_kind public.order_media_kind,
  p_path text,
  p_duration_s numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_crew_id uuid := private.current_crew_id();
  v_order public.orders;
  v_existing public.order_media;
  v_metadata jsonb;
  v_media_type public.media_type;
  v_limit int;
  v_id uuid;
begin
  if v_user_id is null or private.current_user_role() is distinct from 'crew' then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_kind is null or p_kind not in ('before', 'after', 'clip') then
    raise exception using errcode = '22023', message = 'invalid_kind';
  end if;

  -- Locked, so two attaches at once can't both take the last place.
  select * into v_order from public.orders as o where o.id = p_order_id for update;
  if not found or v_crew_id is null or v_order.crew_id is distinct from v_crew_id then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;

  -- A retry after a lost answer gets the row it already made.
  select * into v_existing from public.order_media as m where m.path = p_path;
  if found then
    if v_existing.order_id = v_order.id and v_existing.kind = p_kind then
      return v_existing.id;
    end if;
    raise exception using errcode = 'ZL009', message = 'upload_not_found';
  end if;

  if not private.job_takes_media(v_order.id, v_order.status) then
    raise exception using errcode = 'ZL023', message = 'media_not_allowed';
  end if;

  -- A finished upload by this account, in this crew's folder for this order.
  select ob.metadata into v_metadata
  from storage.objects as ob
  where ob.bucket_id = 'order-media'
    and ob.name = p_path
    and starts_with(ob.name, 'crew/' || v_crew_id || '/' || v_order.id || '/')
    and ob.owner_id = v_user_id::text;
  if not found or v_metadata ->> 'size' is null then
    raise exception using errcode = 'ZL009', message = 'upload_not_found';
  end if;

  v_media_type := case when v_metadata ->> 'mimetype' like 'video/%' then 'video' else 'photo' end;
  if (p_kind = 'clip') <> (v_media_type = 'video') then
    raise exception using errcode = '22023', message = 'media_type_mismatch';
  end if;
  if v_media_type = 'video' and (p_duration_s is null or p_duration_s not between 0 and 60) then
    raise exception using errcode = '22023', message = 'invalid_duration';
  end if;

  v_limit := case when p_kind = 'clip' then 4 else 10 end;
  if (select count(*) from public.order_media as m where m.order_id = v_order.id and m.kind = p_kind) >= v_limit then
    raise exception using errcode = 'ZL008', message = 'too_many_files';
  end if;

  insert into public.order_media (order_id, kind, media_type, path, bytes, duration_s, uploaded_by)
  values (
    v_order.id, p_kind, v_media_type, p_path, (v_metadata ->> 'size')::bigint,
    case when v_media_type = 'video' then round(p_duration_s, 1) end, v_user_id
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.attach_job_media(uuid, public.order_media_kind, text, numeric)
from public, anon;
grant execute on function public.attach_job_media(uuid, public.order_media_kind, text, numeric)
to authenticated;

-- Returns the file's path, which the app then deletes through the Storage API
-- (the crew's delete policy allows it once the file is no longer attached).
create function public.remove_job_media(p_media_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_status public.order_status;
begin
  if (select auth.uid()) is null or private.current_user_role() is distinct from 'crew' then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select m.path, o.status into v_path, v_status
  from public.order_media as m
  join public.orders as o on o.id = m.order_id
  where m.id = p_media_id
    and m.kind in ('before', 'after', 'clip')
    and o.crew_id = private.current_crew_id()
    -- Only its own files: a crew given a reopened job can't remove the
    -- first crew's (keyed by folder, so a crew on a new phone keeps them).
    and starts_with(m.path, 'crew/' || private.current_crew_id() || '/')
  for update of o;
  if not found then
    raise exception using errcode = 'P0002', message = 'media_not_found';
  end if;
  if v_status not in ('arrived', 'in_progress') then
    raise exception using errcode = 'ZL023', message = 'media_not_allowed';
  end if;

  delete from public.order_media as m where m.id = p_media_id;
  return v_path;
end;
$$;

revoke execute on function public.remove_job_media(uuid) from public, anon;
grant execute on function public.remove_job_media(uuid) to authenticated;

-- Storage: the crew's folder in order-media ----------------------------------------------

create policy "Crews upload job media to their open jobs"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'order-media'
  and cardinality(storage.foldername(name)) = 3
  and (storage.foldername(name))[1] = 'crew'
  and (storage.foldername(name))[2] = (select private.current_crew_id())::text
  -- The rule of private.job_takes_media(), over the orders the crew may read.
  and exists (
    select 1 from public.orders as o
    where o.id::text = (storage.foldername(objects.name))[3]
      and o.crew_id = (select private.current_crew_id())
      and (
        o.status in ('arrived', 'in_progress')
        or (
          o.status = 'completed'
          and exists (
            select 1 from public.order_events as e
            where e.order_id = o.id
              and e.to_status = 'completed'
              and e.created_at > now() - interval '24 hours'
          )
        )
      )
  )
);

create policy "Crews read their job uploads while the job is theirs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'order-media'
  and (storage.foldername(name))[1] = 'crew'
  and (storage.foldername(name))[2] = (select private.current_crew_id())::text
  and exists (
    select 1 from public.orders as o
    where o.id::text = (storage.foldername(objects.name))[3]
      and o.crew_id = (select private.current_crew_id())
  )
);

create policy "Crews delete their job uploads until they are attached"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'order-media'
  and (storage.foldername(name))[1] = 'crew'
  and (storage.foldername(name))[2] = (select private.current_crew_id())::text
  and not exists (select 1 from public.order_media as m where m.path = objects.name)
);

revoke execute on all functions in schema private from public;
