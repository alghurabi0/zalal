-- A second company phone and the certificate stamp image (spec §7 settings,
-- §8.2 A13, §10.1; the owner's answers of Oct 29, 2026 to §13 "Certificate
-- identity": the issuer stays "شركة زلال", the stamp is an A13 setting, and
-- both phones show wherever the company phone does).
--
-- 1. settings.company_phone_2: optional, E.164 like company_phone and never
--    the same number. Saved through admin_update_settings like every other
--    setting.
--
-- 2. settings.certificate_stamp_path: the stamp image, a file in
--    public-content/stamp/ (the bucket is public, so the print page loads it
--    by URL; it is printed on every certificate anyway). It changes only
--    through admin_set_certificate_stamp(path), which admin_update_settings
--    now refuses as unknown_setting, because a path needs the upload checks
--    an article cover gets: the admin's own finished upload in stamp/, at
--    most 48 h old (ZL009 upload_not_found), locked while it is attached.
--    Null removes the stamp. Returns the path it replaced or removed, which
--    the server deletes through the admin's own Storage client. Logged as
--    'settings.update' like other settings, only when the path changes.
--
-- 3. Storage: admins upload to public-content/stamp/<file> and delete a
--    stamp the settings don't use ("used" checked without RLS by
--    private.certificate_stamp_used, as article covers are); no upload takes
--    the name of the stamp in use. Admins already read the bucket (migration
--    articles). The nightly content cleanup (unattached_media('content'))
--    also lists stamps over 72 h old that the settings don't use.
--
-- Departures from spec §7: none; §7 now lists the two settings.

-- Settings ------------------------------------------------------------------------------------

alter table public.settings
  add column company_phone_2 text check (company_phone_2 ~ '^\+964[1-9][0-9]{7,9}$'),
  add column certificate_stamp_path text check (certificate_stamp_path ~ '^stamp/[A-Za-z0-9_-]+\.(webp|png|jpe?g)$'),
  add constraint settings_company_phones_differ check (company_phone_2 <> company_phone);

-- Helpers ---------------------------------------------------------------------------------------

-- True when the settings use the file as the certificate stamp. Security
-- definer and volatile for the same reasons as private.article_cover_used.
create function private.certificate_stamp_used(p_name text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (select 1 from public.settings as s where s.certificate_stamp_path = p_name);
$$;

-- admin_update_settings -------------------------------------------------------------------------
-- Unchanged from migration admin_settings except that certificate_stamp_path
-- is refused like the server-owned columns.

create or replace function public.admin_update_settings(p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_cols text;
  v_old jsonb;
  v_new jsonb;
  v_diff jsonb := '{}';
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_settings';
  end if;

  for v_key in select k from jsonb_object_keys(p_patch) as k loop
    if v_key in ('id', 'updated_at', 'certificate_stamp_path') or not exists (
      select 1
      from pg_catalog.pg_attribute as a
      where a.attrelid = 'public.settings'::regclass
        and a.attname = v_key
        and a.attnum > 0
        and not a.attisdropped
    ) then
      raise exception using errcode = '22023', message = 'unknown_setting';
    end if;
  end loop;

  select to_jsonb(s), to_jsonb(jsonb_populate_record(s, p_patch))
  into v_old, v_new
  from public.settings as s
  for update;

  for v_key in select k from jsonb_object_keys(p_patch) as k loop
    if v_old -> v_key is distinct from v_new -> v_key then
      v_diff := v_diff || jsonb_build_object(
        v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key)
      );
    end if;
  end loop;

  if v_diff = '{}' then
    return;
  end if;

  -- Column names come from the catalog check above, quoted with %I. The
  -- where clause is for pg-safeupdate, which PostgREST loads: it refuses an
  -- update without one, even on this one-row table.
  select string_agg(format('%I', k), ', ') into v_cols from jsonb_object_keys(v_diff) as k;
  execute format(
    'update public.settings as s set (%1$s) = (select %1$s from jsonb_populate_record(null::public.settings, $1)) where s.id',
    v_cols
  )
  using p_patch;

  perform private.log_admin_action('settings.update', 'settings', 'settings', v_diff);
end;
$$;

-- admin_set_certificate_stamp -------------------------------------------------------------------

create function public.admin_set_certificate_stamp(p_path text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select s.certificate_stamp_path into v_old from public.settings as s where s.id for update;
  if p_path is not distinct from v_old then
    return null;
  end if;

  -- A new stamp: the admin's own finished upload in stamp/, recent. An
  -- update, not a select, so a delete of the same file running meanwhile
  -- waits and then sees it used (as admin_save_article).
  if p_path is not null then
    update storage.objects as ob
    set metadata = ob.metadata
    where ob.bucket_id = 'public-content'
      and ob.name = p_path
      and ob.name ~ '^stamp/[A-Za-z0-9_-]+\.(webp|png|jpe?g)$'
      and ob.owner_id = (select auth.uid())::text
      and ob.metadata ->> 'size' is not null
      -- The cleanup deletes unused stamps after 72 hours.
      and ob.created_at > now() - interval '48 hours';
    if not found then
      raise exception using errcode = 'ZL009', message = 'upload_not_found';
    end if;
  end if;

  update public.settings as s set certificate_stamp_path = p_path where s.id;

  perform private.log_admin_action(
    'settings.update', 'settings', 'settings',
    jsonb_build_object('certificate_stamp_path', jsonb_build_object('from', v_old, 'to', p_path))
  );
  return v_old;
end;
$$;

revoke execute on function public.admin_set_certificate_stamp(text) from public, anon;
grant execute on function public.admin_set_certificate_stamp(text) to authenticated;

-- Storage: the stamp in public-content ----------------------------------------------------------

create policy "Admins upload the certificate stamp"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'public-content'
  and cardinality(storage.foldername(name)) = 1
  and (storage.foldername(name))[1] = 'stamp'
  and (select private.is_admin())
  -- Never under the name of the stamp in use, should its file go missing.
  and not private.certificate_stamp_used(name)
);

create policy "Admins delete certificate stamps not in use"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'public-content'
  and (storage.foldername(name))[1] = 'stamp'
  and (select private.is_admin())
  and not private.certificate_stamp_used(objects.name)
);

-- Media cleanup: stamps in the content folder ---------------------------------------------------
-- Unchanged from migration qa_retention except the content branch.

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
      -- The server records a PDF within seconds of uploading it. An upsert
      -- of the same version keeps created_at but moves updated_at (RLS audit
      -- of this migration), so both must be old.
      and ob.created_at < now() - interval '24 hours'
      and coalesce(ob.updated_at, ob.created_at) < now() - interval '24 hours'
      and (p_after_created_at is null or (ob.created_at, ob.name) > (p_after_created_at, p_after_name))
      and not exists (select 1 from public.certificates as c where c.pdf_path = ob.name)
    order by ob.created_at, ob.name
    limit p_limit;
  elsif p_folder = 'content' then
    return query
    select ob.name, ob.created_at
    from storage.objects as ob
    where ob.bucket_id = 'public-content'
      and (starts_with(ob.name, 'articles/') or starts_with(ob.name, 'stamp/'))
      -- admin_save_article() and admin_set_certificate_stamp() take uploads
      -- up to 48 hours old.
      and ob.created_at < now() - interval '72 hours'
      and (p_after_created_at is null or (ob.created_at, ob.name) > (p_after_created_at, p_after_name))
      and not exists (select 1 from public.articles as a where a.cover_path = ob.name)
      and not exists (select 1 from public.settings as s where s.certificate_stamp_path = ob.name)
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


revoke execute on all functions in schema private from public;
grant execute on function private.certificate_stamp_used(text) to authenticated;
