-- Admin settings (spec §8.2 A13, §7; Phase 3 task 1 part B).
--
-- - sterilant_text: the sterilant the crew finish form (C4) is prefilled
--   with; spec §7 places it in Phase 3. Starts empty; the owner fills it in
--   A13 before launch (spec §12.4).
-- - Length caps on terms_md and privacy_md, now that admins write them.
-- - admin_update_settings(patch): the audited admin write (42501 for
--   everyone but admins). The patch names only the settings to change, so
--   each A13 section saves on its own and later phases add settings
--   (support_response_text, subscription_plan) without a new signature. The
--   new row is built with jsonb_populate_record, so each value is cast to
--   its column's type and the table's checks apply. Logged as
--   'settings.update' with the old and new value of each changed setting;
--   a patch that changes nothing writes nothing.
--
-- Departures from spec §7: none.

alter table public.settings
add column sterilant_text text not null default '' check (
  char_length(sterilant_text) <= 100 and sterilant_text = btrim(sterilant_text)
),
add constraint settings_terms_md_length check (char_length(terms_md) <= 50000),
add constraint settings_privacy_md_length check (char_length(privacy_md) <= 50000);

create function public.admin_update_settings(p_patch jsonb)
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
    if v_key in ('id', 'updated_at') or not exists (
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

  -- Column names come from the catalog check above, quoted with %I.
  select string_agg(format('%I', k), ', ') into v_cols from jsonb_object_keys(v_diff) as k;
  execute format(
    'update public.settings as s set (%1$s) = (select %1$s from jsonb_populate_record(null::public.settings, $1))',
    v_cols
  )
  using p_patch;

  perform private.log_admin_action('settings.update', 'settings', 'settings', v_diff);
end;
$$;

revoke execute on function public.admin_update_settings(jsonb) from public, anon;
grant execute on function public.admin_update_settings(jsonb) to authenticated;
