-- Tips articles and their categories, managed in A11 (spec §5.5 tips strip,
-- §5.6 Tips, N9 Article, §7, §8.2 A11, §10.2; Phase 6, task 1).
--
-- 1. article_categories: name (2–30, unique), icon, sort. Read by everyone,
--    guests included. Departure from §7: icon is new (category_icon enum),
--    so list items get the canvas's icon tiles (drop for صحة, sun for الصيف,
--    tank lid for نصائح); covers stay optional.
--
-- 2. articles: Read by guests, customers and crews while published; admins
--    read drafts too. Nobody writes the tables directly. Departures from §7:
--    - slug is Latin (a-z, 0-9, single hyphens, 3–80), typed by the admin,
--      and fixed once the article has been published (ZL032 slug_locked), so
--      shared links keep working (settled Oct 28, 2026);
--    - read_minutes is generated from the body (words ÷ 150, rounded, at
--      least 1) instead of typed, so it can't drift from the text;
--    - published_at is set on the first publish and kept when the article
--      goes back to draft (it also locks the slug); a published article
--      needs a published_at and a body (check);
--    - created_at and updated_at.
--
-- 3. Audited admin RPCs (security definer, private.log_admin_action):
--    - admin_save_article(id, slug, title, category_id, cover_path, body_md,
--      featured, status): create (id null) or update. Returns the id and the
--      cover it replaced or removed, which the server then deletes through
--      the Storage API. A new cover must be the admin's finished upload in
--      public-content/articles/, at most 48 h old, that no other article uses
--      (ZL009 upload_not_found); the file is locked while it is attached.
--      ZL031 slug_taken, ZL032 slug_locked, P0002 category_not_found and
--      article_not_found. Logs article.create / article.update (only what
--      changed; the body as its length, not its text).
--    - admin_delete_article(id): returns the cover path; article.delete.
--    - admin_save_category(id, name, icon): ZL033 category_name_taken;
--      category.create / category.update.
--    - admin_delete_category(id): refused while any article uses it (ZL030
--      category_in_use); category.delete.
--    - admin_reorder_categories(ids): every id once, in the new order
--      (22023 invalid_order); category.reorder with the old and new order.
--
-- 4. Storage (public-content, public): anyone with a cover's URL loads it.
--    Through the API only admins touch it: upload to articles/<file>, read
--    the bucket, delete a cover no article uses. "Used" is checked without
--    RLS (private.article_cover_used, as ticket-media's helper), and no
--    upload takes the name of a used cover. A draft's cover can be fetched
--    by anyone who has its exact URL (a random name, never listed).
--
-- 5. Media cleanup: unattached_media('content') lists covers in articles/
--    more than 72 h old that no article uses; the nightly job
--    media-cleanup-content (01:17 UTC, 04:17 Baghdad) has the media-cleanup
--    Edge Function delete them.
--
-- 6. Rows every project needs (§10.2): the four categories and the six
--    articles, skipped when a row with the same name or slug exists. The
--    articles are drafts here, so the owner reviews them in A11 before they
--    show on prod (settled Oct 28, 2026); seed.sql publishes them locally.

-- Types ----------------------------------------------------------------------------------

create type public.article_status as enum ('draft', 'published');
create type public.category_icon as enum ('droplet', 'sun', 'lid', 'lightbulb', 'help', 'shield');

-- article_categories -------------------------------------------------------------------------

create table public.article_categories (
  id bigint generated always as identity primary key,
  name text not null
    constraint article_categories_name_key unique
    check (char_length(name) between 2 and 30 and name = btrim(name)),
  icon public.category_icon not null default 'lightbulb',
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger article_categories_set_updated_at
before update on public.article_categories
for each row execute function private.set_updated_at();

alter table public.article_categories enable row level security;
revoke all on public.article_categories from anon, authenticated;
revoke all on sequence public.article_categories_id_seq from anon, authenticated;
grant select on public.article_categories to anon, authenticated;

create policy "Everyone reads article categories"
on public.article_categories
for select
to anon, authenticated
using (true);

-- articles -------------------------------------------------------------------------------------

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null
    constraint articles_slug_key unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  title text not null check (char_length(title) between 5 and 120 and title = btrim(title)),
  category_id bigint not null references public.article_categories (id) on delete restrict,
  cover_path text
    constraint articles_cover_path_key unique
    check (cover_path ~ '^articles/[^/]+$'),
  body_md text not null default '' check (char_length(body_md) <= 20000),
  -- Words ÷ 150, rounded, at least 1 (src/lib/articles/read-time.ts matches it).
  read_minutes smallint generated always as (
    greatest(1, round(regexp_count(body_md, '\S+') / 150.0))::smallint
  ) stored,
  featured boolean not null default false,
  status public.article_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint articles_published_check
    check (status = 'draft' or (published_at is not null and body_md ~ '\S'))
);

create index articles_category_id_idx on public.articles (category_id);
create index articles_status_published_at_idx on public.articles (status, published_at desc);

create trigger articles_set_updated_at
before update on public.articles
for each row execute function private.set_updated_at();

alter table public.articles enable row level security;
revoke all on public.articles from anon, authenticated;
grant select on public.articles to anon, authenticated;

create policy "Guests read published articles"
on public.articles
for select
to anon
using (status = 'published');

create policy "Users read published articles; admins read all"
on public.articles
for select
to authenticated
using (status = 'published' or (select private.is_admin()));

-- Helpers ------------------------------------------------------------------------------------

-- True when an article uses the file as its cover. Security definer, so the
-- storage policies ask it without RLS; volatile, so a delete that waited on
-- admin_save_article re-checks with a fresh snapshot and sees the cover it
-- attached (the ticket-media lesson, migration tickets_app).
create function private.article_cover_used(p_name text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (select 1 from public.articles as a where a.cover_path = p_name);
$$;

-- admin_save_article -------------------------------------------------------------------------

create function public.admin_save_article(
  p_id uuid,
  p_slug text,
  p_title text,
  p_category_id bigint,
  p_cover_path text,
  p_body_md text,
  p_featured boolean,
  p_status public.article_status
)
returns table (article_id uuid, replaced_cover text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.articles;
  v_id uuid;
  v_published_at timestamptz;
  v_diff jsonb := '{}';
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  if p_id is not null then
    select * into v_old from public.articles as a where a.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'article_not_found';
    end if;
    if v_old.published_at is not null and p_slug is distinct from v_old.slug then
      raise exception using errcode = 'ZL032', message = 'slug_locked';
    end if;
  end if;

  if not exists (select 1 from public.article_categories as c where c.id = p_category_id) then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;
  if exists (
    select 1 from public.articles as a
    where a.slug = p_slug and a.id is distinct from p_id
  ) then
    raise exception using errcode = 'ZL031', message = 'slug_taken';
  end if;

  -- A new cover: the admin's finished upload, recent, used by no article.
  -- An update, not a select, so a delete of the same file running meanwhile
  -- waits and then sees it used (RLS audit of migration tickets_app).
  if p_cover_path is not null and p_cover_path is distinct from v_old.cover_path then
    update storage.objects as ob
    set metadata = ob.metadata
    where ob.bucket_id = 'public-content'
      and ob.name = p_cover_path
      and ob.name ~ '^articles/[^/]+$'
      -- The cleanup deletes unused covers after 72 hours.
      and ob.created_at > now() - interval '48 hours'
      and not private.article_cover_used(ob.name);
    if not found then
      raise exception using errcode = 'ZL009', message = 'upload_not_found';
    end if;
  end if;

  v_published_at := case
    when p_status = 'published' then coalesce(v_old.published_at, now())
    else v_old.published_at
  end;

  begin
    if p_id is null then
      insert into public.articles (
        slug, title, category_id, cover_path, body_md, featured, status, published_at
      )
      values (
        p_slug, p_title, p_category_id, p_cover_path, p_body_md, p_featured, p_status, v_published_at
      )
      returning id into v_id;

      perform private.log_admin_action(
        'article.create', 'articles', v_id::text,
        jsonb_build_object(
          'slug', p_slug, 'title', p_title, 'category_id', p_category_id,
          'cover', p_cover_path, 'body_length', char_length(p_body_md),
          'featured', p_featured, 'status', p_status
        )
      );
      return query select v_id, null::text;
      return;
    end if;

    if v_old.slug is distinct from p_slug then
      v_diff := v_diff || jsonb_build_object('slug', jsonb_build_object('from', v_old.slug, 'to', p_slug));
    end if;
    if v_old.title is distinct from p_title then
      v_diff := v_diff || jsonb_build_object('title', jsonb_build_object('from', v_old.title, 'to', p_title));
    end if;
    if v_old.category_id is distinct from p_category_id then
      v_diff := v_diff || jsonb_build_object(
        'category_id', jsonb_build_object('from', v_old.category_id, 'to', p_category_id)
      );
    end if;
    if v_old.cover_path is distinct from p_cover_path then
      v_diff := v_diff || jsonb_build_object('cover', jsonb_build_object('from', v_old.cover_path, 'to', p_cover_path));
    end if;
    if v_old.body_md is distinct from p_body_md then
      v_diff := v_diff || jsonb_build_object(
        'body_length',
        jsonb_build_object('from', char_length(v_old.body_md), 'to', char_length(p_body_md))
      );
    end if;
    if v_old.featured is distinct from p_featured then
      v_diff := v_diff || jsonb_build_object('featured', jsonb_build_object('from', v_old.featured, 'to', p_featured));
    end if;
    if v_old.status is distinct from p_status then
      v_diff := v_diff || jsonb_build_object('status', jsonb_build_object('from', v_old.status, 'to', p_status));
    end if;

    if v_diff <> '{}' then
      update public.articles as a
      set slug = p_slug,
        title = p_title,
        category_id = p_category_id,
        cover_path = p_cover_path,
        body_md = p_body_md,
        featured = p_featured,
        status = p_status,
        published_at = v_published_at
      where a.id = p_id;
      perform private.log_admin_action('article.update', 'articles', p_id::text, v_diff);
    end if;
  exception when unique_violation then
    -- Another admin took the slug or the cover a moment ago.
    if sqlerrm like '%articles_slug_key%' then
      raise exception using errcode = 'ZL031', message = 'slug_taken';
    end if;
    raise exception using errcode = 'ZL009', message = 'upload_not_found';
  end;

  return query select p_id,
    case when v_old.cover_path is distinct from p_cover_path then v_old.cover_path end;
end;
$$;

-- admin_delete_article -----------------------------------------------------------------------

create function public.admin_delete_article(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.articles;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  delete from public.articles as a where a.id = p_id returning * into v_old;
  if not found then
    raise exception using errcode = 'P0002', message = 'article_not_found';
  end if;

  perform private.log_admin_action(
    'article.delete', 'articles', p_id::text,
    jsonb_build_object('slug', v_old.slug, 'title', v_old.title, 'status', v_old.status)
  );
  return v_old.cover_path;
end;
$$;

-- admin_save_category ------------------------------------------------------------------------

create function public.admin_save_category(p_id bigint, p_name text, p_icon public.category_icon)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.article_categories;
  v_id bigint;
  v_diff jsonb := '{}';
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  if exists (
    select 1 from public.article_categories as c
    where c.name = p_name and c.id is distinct from p_id
  ) then
    raise exception using errcode = 'ZL033', message = 'category_name_taken';
  end if;

  begin
    if p_id is null then
      -- At the end of the order; the lock makes two adds take turns.
      perform 1 from public.article_categories as c order by c.id for update;
      insert into public.article_categories (name, icon, sort)
      select p_name, p_icon, coalesce(max(c.sort), 0) + 1
      from public.article_categories as c
      returning id into v_id;
      perform private.log_admin_action(
        'category.create', 'article_categories', v_id::text,
        jsonb_build_object('name', p_name, 'icon', p_icon)
      );
      return v_id;
    end if;

    select * into v_old from public.article_categories as c where c.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'category_not_found';
    end if;
    if v_old.name is distinct from p_name then
      v_diff := v_diff || jsonb_build_object('name', jsonb_build_object('from', v_old.name, 'to', p_name));
    end if;
    if v_old.icon is distinct from p_icon then
      v_diff := v_diff || jsonb_build_object('icon', jsonb_build_object('from', v_old.icon, 'to', p_icon));
    end if;
    if v_diff <> '{}' then
      update public.article_categories as c set name = p_name, icon = p_icon where c.id = p_id;
      perform private.log_admin_action('category.update', 'article_categories', p_id::text, v_diff);
    end if;
  exception when unique_violation then
    raise exception using errcode = 'ZL033', message = 'category_name_taken';
  end;
  return p_id;
end;
$$;

-- admin_delete_category ----------------------------------------------------------------------

create function public.admin_delete_category(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.article_categories;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select * into v_old from public.article_categories as c where c.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;
  if exists (select 1 from public.articles as a where a.category_id = p_id) then
    raise exception using errcode = 'ZL030', message = 'category_in_use';
  end if;

  begin
    delete from public.article_categories as c where c.id = p_id;
  exception when foreign_key_violation then
    -- An article took the category a moment ago.
    raise exception using errcode = 'ZL030', message = 'category_in_use';
  end;

  perform private.log_admin_action(
    'category.delete', 'article_categories', p_id::text, jsonb_build_object('name', v_old.name)
  );
end;
$$;

-- admin_reorder_categories -------------------------------------------------------------------

create function public.admin_reorder_categories(p_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from jsonb;
  v_to jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  perform 1 from public.article_categories as c order by c.id for update;
  if p_ids is null
    or cardinality(p_ids) <> (select count(*) from public.article_categories)
    or cardinality(p_ids) <> (select count(distinct i) from unnest(p_ids) as i)
    or exists (
      select 1 from unnest(p_ids) as i
      where not exists (select 1 from public.article_categories as c where c.id = i)
    )
  then
    raise exception using errcode = '22023', message = 'invalid_order';
  end if;

  select jsonb_agg(c.name order by c.sort, c.id) into v_from from public.article_categories as c;
  select jsonb_agg(c.name order by o.n) into v_to
  from unnest(p_ids) with ordinality as o (id, n)
  join public.article_categories as c on c.id = o.id;

  if v_from is distinct from v_to then
    update public.article_categories as c
    set sort = o.n
    from unnest(p_ids) with ordinality as o (id, n)
    where c.id = o.id;
    perform private.log_admin_action(
      'category.reorder', 'article_categories', 'all',
      jsonb_build_object('order', jsonb_build_object('from', v_from, 'to', v_to))
    );
  end if;
end;
$$;

revoke execute on function public.admin_save_article(uuid, text, text, bigint, text, text, boolean, public.article_status)
from public, anon;
grant execute on function public.admin_save_article(uuid, text, text, bigint, text, text, boolean, public.article_status)
to authenticated;
revoke execute on function public.admin_delete_article(uuid) from public, anon;
grant execute on function public.admin_delete_article(uuid) to authenticated;
revoke execute on function public.admin_save_category(bigint, text, public.category_icon) from public, anon;
grant execute on function public.admin_save_category(bigint, text, public.category_icon) to authenticated;
revoke execute on function public.admin_delete_category(bigint) from public, anon;
grant execute on function public.admin_delete_category(bigint) to authenticated;
revoke execute on function public.admin_reorder_categories(bigint[]) from public, anon;
grant execute on function public.admin_reorder_categories(bigint[]) to authenticated;

-- Storage: article covers in public-content --------------------------------------------------

create policy "Admins upload article covers"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'public-content'
  and cardinality(storage.foldername(name)) = 1
  and (storage.foldername(name))[1] = 'articles'
  and (select private.is_admin())
  -- Never under the name of a used cover that has gone missing.
  and not private.article_cover_used(name)
);

create policy "Admins read article covers"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'public-content'
  and (select private.is_admin())
);

create policy "Admins delete article covers no article uses"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'public-content'
  and (storage.foldername(name))[1] = 'articles'
  and (select private.is_admin())
  and not private.article_cover_used(objects.name)
);

-- Media cleanup: the content folder ------------------------------------------------------------
-- Unchanged from migration tickets_app except the content branch.

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
  if p_folder is null or p_folder not in ('customer', 'crew', 'chat', 'ticket', 'content') then
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

-- Unchanged from migration tickets_app except the content folder.
create or replace function private.invoke_media_cleanup(p_folder text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_folder is null or p_folder not in ('customer', 'crew', 'chat', 'ticket', 'content') then
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

-- Daily at 01:17 UTC (04:17 Baghdad), after the other folders.
select cron.schedule(
  'media-cleanup-content', '17 1 * * *', $$select private.invoke_media_cleanup('content')$$
);

revoke execute on all functions in schema private from public;
grant execute on function private.article_cover_used(text) to authenticated;

-- Starting content (spec §10.2) ----------------------------------------------------------------
-- Skipped when a row with the same name or slug exists. Drafts: the owner
-- reviews them in A11 before publishing (settled Oct 28, 2026). Health
-- statements stay general on purpose.

insert into public.article_categories (name, icon, sort)
values ('صحة', 'droplet', 1), ('نصائح', 'lid', 2), ('الصيف', 'sun', 3), ('أسئلة شائعة', 'help', 4)
on conflict (name) do nothing;

insert into public.articles (slug, title, category_id, featured, body_md)
select v.slug, v.title, c.id, v.featured, v.body_md
from (
  values
    ('tank-cleaning-signs', '5 علامات تكول خزانك يحتاج تنظيف', 'نصائح', true, $md$خزان الماي فوق السطح أو بالحديقة ما نشوفه كل يوم، وهذا يخلي الوسخ يتجمع بيه بهدوء بدون ما ننتبه. بس أكو علامات واضحة تكلك إن الخزان صار يحتاج تنظيف، وإذا انتبهت إلها من وقت تحمي بيتك وعائلتك من مشاكل أكبر.

## العلامات الخمس

1. ريحة غريبة أو طعم مو طبيعي بالماي
2. لون الماي مصفر أو عكر
3. رواسب أو رمل بقاع الكاسة
4. طبقة لزجة على جدار الخزان
5. مرت أكثر من 6 أشهر على آخر تنظيف

## شنو تعني كل علامة؟

**الريحة والطعم:** الماي النظيف ما إله ريحة. إذا شميت ريحة عفونة أو حسيت بطعم مر أو معدني، فهذا غالباً معناه أكو مواد عضوية أو طحالب بدت تتجمع داخل الخزان، خصوصاً إذا الغطاء مو محكم.

**اللون العكر:** املي كاسة شفافة من حنفية المطبخ وخليها جنب الشباك. إذا شفت الماي مصفر أو بيه غبشة، فالسبب ممكن يكون طين أو صدأ أو ترسبات من الأنابيب والخزان. مرات اللون يتغير بس بعد ما ينكطع الماي ويرجع، وهذا هم علامة إن قاع الخزان بيه ترسبات تتحرك.

**الرواسب بقاع الكاسة:** إذا خليت الكاسة شوية وشفت رمل ناعم أو حبيبات نازلة لجوه، معناها قاع الخزان تجمع بيه طين وتراب من شبكة الماي. هالرواسب ما تطلع وحدها، تبقى تتراكم لحد ما ينظف الخزان.

**الطبقة اللزجة:** إذا فتحت الغطاء ومسحت جدار الخزان من جوه بإيدك (وانت لابس كفوف) وحسيت بشي لزج أو زلق، فهاي طبقة من البكتريا والطحالب تتكون على الجدران. ما تروح بالشطف بالماي، تحتاج فرك وتعقيم.

**مرور 6 أشهر:** حتى لو الماي يبين نظيف، ننصح بتنظيف الخزان كل 6 أشهر. الوسخ يبدأ قليل وما ينشاف، وكل ما طالت المدة صار التنظيف أصعب والترسبات أكثر.

## شتسوي إذا شفت وحدة منها؟

- لا تستعمل ماي الخزان للشرب أو الطبخ إذا الريحة أو اللون واضحين، واعتمد على ماي معبأ لحد ما ينظف.
- تأكد إن غطاء الخزان مسدود زين وما بيه فتحات.
- احجز تنظيف وتعقيم من التطبيق، وفريقنا يفرغ الخزان وينظف الجدران والقاع ويعقمه، وتوصلك شهادة بعد الشغل بيها موعد التنظيف الجاي.

الانتباه لهالعلامات ما ياخذ منك غير دقيقتين بالشهر، بس يفرق هواية بنظافة الماي اللي تستعمله عائلتك كل يوم.$md$),
    ('clean-every-six-months', 'ليش لازم تنظف الخزان كل 6 أشهر؟', 'صحة', true, $md$هواية ناس تسأل: إذا الماي يجي من الإسالة وهو أصلاً معقم، ليش أحتاج أنظف الخزان؟ والجواب بسيط: الماي ممكن يوصل نظيف، بس الخزان نفسه هو المكان اللي يبقى بيه الماي أيام، وهناك تبدأ المشكلة.

## شنو يصير داخل الخزان مع الوقت؟

الخزان مكان مسدود ومظلم، وبالصيف يصير حار. هالظروف تساعد على تجمع أشياء ما نحبها بالماي:

- **ترسبات وطين:** شبكة الماي تجيب وياها ذرات تراب ورمل ناعمة، تنزل لقاع الخزان وتتراكم شهر بعد شهر.
- **طبقة بكتريا على الجدران:** على جدران الخزان تتكون طبقة رقيقة ولزجة، تحمي البكتريا وتخليها تعيش حتى لو الماي بيه كلور قليل.
- **طحالب:** إذا يدخل ضوء من فتحة أو غطاء مكسور، تبدأ الطحالب الخضراء تنمو.
- **حشرات وغبار:** أي فتحة صغيرة بالغطاء تخلي الغبار والحشرات توصل للماي.

هاي الأشياء ما تنشاف من الحنفية بالبداية، لأن الماي يطلع من فوك القاع. بس كل ما زادت، صار احتمال توصل للماي اللي تستعمله أكبر، خصوصاً من ينكطع الماي ويرجع بقوة ويحرك الترسبات.

## ليش 6 أشهر بالذات؟

المدة هاي توازن بين النظافة والكلفة. خلال 6 أشهر تكون الترسبات بعدها قليلة والطبقة على الجدران سهلة الإزالة، فالتنظيف يكون سريع وفعال. إذا طولت سنة أو أكثر، الترسبات تصير أثقل والتنظيف ياخذ وقت أكثر، ويمكن تحتاج تبديل بعض الأجزاء مثل الطوافة أو الحنفيات.

بالعراق عدنا موسمين واضحين: الصيف الحار والشتاء. تنظيف قبل الصيف وتنظيف بعده يخلي خزانك نظيف بأصعب فترة بالسنة.

## شنو يشمل التنظيف الصحيح؟

التنظيف مو بس شطف بالماي. بزيارة زلال يسوي الفريق هالخطوات:

1. تفريغ الخزان من الماي القديم.
2. إزالة الطين والترسبات من القاع.
3. فرك الجدران والسقف من الداخل.
4. تعقيم الخزان بمادة معقمة مناسبة لخزانات ماي الشرب.
5. شطف الخزان وإعادة تعبئته.
6. فحص الغطاء والطوافة والانتباه لأي تسريب.

## التطبيق يذكرك

ما تحتاج تحفظ الموعد. بعد كل تنظيف تطلعلك شهادة بيها تاريخ التنظيف الجاي، والتطبيق يذكرك قبل الموعد بأسبوع حتى تحجز براحتك.

خزان نظيف يعني ماي أنظف لغسل الخضرة والطبخ والاستحمام، وراحة بال إلك ولعائلتك. خليها عادة كل 6 أشهر، مثل ما تبدل فلتر المكيف أو تفحص السيارة.$md$),
    ('summer-heat-bacteria', 'الحر يكثّر البكتريا بالخزان: شلون تحمي عائلتك', 'الصيف', false, $md$بالصيف العراقي الحرارة توصل لفوك الخمسين، والخزانات اللي فوق السطوح تكعد تحت الشمس طول النهار. هالحرارة ما تأثر بس على راحتنا، تأثر هم على الماي اللي بالخزان.

## ليش الحر يسوي فرق؟

البكتريا والطحالب تحب الدفو. بالشتاء الماي البارد يبطئ نموها، بس بالصيف الماي بالخزان يصير دافي وأحياناً حار، وهذا الجو المناسب حتى تتكاثر بسرعة أكبر.

وفوق هذا، الكلور اللي يجي ويا ماي الإسالة يقل تأثيره أسرع بالحرارة. يعني الماي يوصل للخزان بيه حماية، بس هالحماية تخلص أسرع بالصيف، خصوصاً إذا الماي يبقى بالخزان أيام.

وانقطاع الماي يزيد بالصيف بسبب كثرة الاستهلاك، فالماي يبقى بالخزان مدة أطول بدون ما يتجدد، وهذا يعطي البكتريا وقت أكثر.

## شلون تحمي عائلتك؟

### نظف الخزان قبل الصيف

أحسن وقت للتنظيف هو قبل ما يبدي الحر الشديد، بشهر نيسان أو أيار. هيج تدخل الصيف بخزان نظيف ومعقم، بدون ترسبات تساعد البكتريا تعيش.

### تأكد من الغطاء

الغطاء المكسور أو المفتوح يخلي الغبار والحشرات والطيور توصل للماي، وبالصيف الحشرات أكثر. افحص الغطاء وتأكد إنه مسدود زين ومربوط حتى ما يطيره الهوا.

### ظلل الخزان إذا تكدر

إذا الخزان بلاستك ومكشوف للشمس، مظلة بسيطة أو سقف خفيف فوقه يقلل حرارة الماي، ويطول عمر الخزان نفسه لأن الشمس تضعف البلاستك.

### خلي الماي يتجدد

الماي اللي يبقى واقف أيام بالخزان هو الأكثر عرضة للمشاكل. إذا عندك خزان كبير وما تستعمل هواية ماي، حاول ما تخليه يبقى ماي قديم طويل.

### انتبه للعلامات

إذا لاحظت ريحة غريبة أو لون عكر أو طبقة لزجة على الجدران، لا تنتظر الموعد. هاي علامات إن الخزان يحتاج تنظيف هسه.

## للشرب والطبخ

كثير عوائل تعتمد على ماي معبأ أو فلتر للشرب، وهذا شي زين. بس تذكر إن ماي الخزان نستعمله لغسل الخضرة والمواعين والاستحمام، فنظافته تهم حتى لو ما نشربه مباشرة.

## خلاصة

الصيف موسم يحتاج انتباه أكثر للخزان. تنظيف قبل الحر، غطاء محكم، وظل إذا تكدر، هاي الخطوات البسيطة تخلي الماي بخزانك أنظف بأصعب أشهر السنة. وإذا تحتاج تنظيف، احجز من التطبيق وفريقنا يوصلك بالموعد اللي يناسبك.$md$),
    ('tank-lid', 'غطاء الخزان: أبسط خطوة تمنع الوسخ والحشرات', 'نصائح', false, $md$من نحجي عن نظافة الخزان، أغلب الناس تفكر بالتنظيف والتعقيم. بس أكو خطوة أبسط بهواية وتسوي فرق كبير: الغطاء. خزان مسدود زين يبقى نظيف لمدة أطول، وخزان غطاه مكسور يتوسخ بسرعة حتى لو تنظف قبل شهر.

## شنو يدخل من غطاء مفتوح؟

- **الغبار والتراب:** العواصف الترابية عدنا مو قليلة، وكل عاصفة تنزل طبقة تراب على السطوح. إذا الغطاء مو محكم، جزء من هالتراب يوصل للماي ويترسب بالقاع.
- **الحشرات:** البعوض يحب الماي الواقف حتى يبيض بيه، والصراصر والنمل يدخلون من أصغر فتحة.
- **الطيور والحيوانات الصغيرة:** مرات تلكى ريش أو فضلات طيور داخل خزانات مفتوحة، ومرات أسوأ من هيج.
- **ضوء الشمس:** الضوء يساعد الطحالب الخضراء تنمو على الجدران وبالماي.

## افحص غطاءك بخمس دقايق

1. اصعد للسطح بوقت آمن، مو بعز الظهر بالصيف.
2. شوف الغطاء: بيه شقوق؟ حافته مكسورة؟ يتحرك بسهولة إذا دفعته؟
3. تأكد إن الغطاء يركب على فتحة الخزان كله، بدون فراغات على الأطراف.
4. شوف إذا مربوط أو مثبت، حتى ما يطيره الهوا القوي.
5. افحص فتحة التهوية إذا موجودة، لازم تكون مغطاة بشبك ناعم.

## إذا الغطاء خربان

لا تحط عليه طابوقة أو قطعة خشب أو نايلون وتكول خلص. هالحلول المؤقتة ما تسد الفتحات زين، والنايلون يتمزق بالشمس بسرعة. الأحسن تبدل الغطاء بغطاء مخصص لنفس نوع الخزان وحجمه. أغطية الخزانات البلاستك متوفرة بمحلات المواد الصحية وأسعارها مو غالية.

إذا الخزان كونكريت أو حديد، ممكن الغطاء يحتاج حداد أو بناء حتى يصلحه، والمهم يكون محكم وما يدخل منه ضوء أو حشرات.

## الغطاء والتنظيف وحدة تكمل الثانية

الغطاء المحكم ما يغني عن التنظيف، لأن الترسبات تجي وياها من شبكة الماي نفسها. بس يخلي الخزان يبقى نظيف أطول بين تنظيف وتنظيف. وبزيارة زلال، الفريق يفحص الغطاء ويكلك إذا يحتاج تبديل أو تصليح.

## ذكّر أهل البيت

إذا أحد يصعد للسطح ويفتح الخزان حتى يشوف مستوى الماي، ذكره يرجع الغطاء زين. هواية خزانات تتوسخ بس لأن أحد نسى الغطاء مفتوح يوم واحد بعاصفة ترابية.

خطوة بسيطة، كلفتها قليلة، وفايدتها كل يوم.$md$),
    ('cleaning-visit', 'شنو يصير بزيارة التنظيف؟', 'أسئلة شائعة', false, $md$إذا هاي أول مرة تحجز تنظيف خزان، أكيد عندك أسئلة: شكد ياخذ وقت؟ أحتاج أكون بالبيت؟ شنو لازم أحضر؟ هنا نشرحلك الزيارة خطوة بخطوة.

## قبل الزيارة

بعد ما تحجز من التطبيق، طلبك يوصل للإدارة وتأكده. من يتأكد، يوصلك إشعار، وبيوم الموعد يوصلك إشعار ثاني من يطلع الفريق إلك، وتكدر تتابع مكانه على الخريطة.

حتى تسهل الشغل:

- خلي الطريق للسطح أو لمكان الخزان مفتوح وواضح.
- إذا تكدر، قلل استعمال الماي قبل الموعد بكم ساعة، حتى يكون الخزان مو مليان.
- خزن شوية ماي بقناني أو سطول للاستعمال وقت الشغل، لأن الماي راح ينكطع عن البيت لحد ما يخلص التنظيف.

## خطوات الشغل

1. **الفحص:** الفريق يشوف الخزان والغطاء والطوافة والأنابيب ويكلك إذا لاحظ شي يحتاج انتباه.
2. **التفريغ:** يفرغون الماي القديم من الخزان.
3. **إزالة الترسبات:** يشيلون الطين والرمل من القاع.
4. **الفرك:** ينظفون الجدران والسقف من الداخل حتى تروح الطبقة اللزجة.
5. **التعقيم:** يستعملون مادة معقمة مخصصة لخزانات ماي الشرب.
6. **الشطف والتعبئة:** يشطفون الخزان ويرجعون يعبونه.

الفريق ممكن يصور الخزان قبل وبعد الشغل، والصور توصلك بالتطبيق وتكدر تتابعها وقت الشغل.

## شكد ياخذ وقت؟

خزان واحد بالحجم العادي ياخذ تقريباً ساعة لساعة ونص، حسب حجمه وكمية الترسبات بيه. إذا عندك أكثر من خزان، الوقت يزيد.

## أحتاج أكون بالبيت؟

لازم يكون أحد من أهل البيت موجود حتى يفتح للفريق ويدلهم على الخزان، ويستلم الشغل بعد ما يخلص. ما يشترط يكون صاحب الحساب نفسه، المهم يكون موجود أحد يعرف مكان الخزان والسطح.

## بعد الزيارة

- راح تشم ريحة كلور خفيفة بالماي أول فترة، وهذا طبيعي بعد التعقيم ويخف وحده.
- تطلعلك بالتطبيق شهادة تنظيف وتعقيم بيها تفاصيل الشغل وموعد التنظيف الجاي.
- تكدر تقيّم الزيارة، ورأيك يساعدنا نحسن الخدمة.

## الدفع

الدفع نقداً للفريق بعد ما يخلص الشغل، بنفس السعر اللي شفته بالتطبيق قبل الحجز. ما أكو أجور إضافية مخفية.

## إذا تغير برنامجك

تكدر تلغي أو تغير الموعد من التطبيق لحد قبل الموعد بساعتين. وإذا عندك أي سؤال، راسلنا من المحادثة بالتطبيق.$md$),
    ('chlorine-smell', 'ريحة الكلور بعد التعقيم: طبيعية لو لا؟', 'صحة', false, $md$بعد ما ننظف الخزان ونعقمه، هواية ناس تلاحظ ريحة كلور بالماي وتسأل: هل هذا طبيعي؟ وهل الماي صالح للاستعمال؟ خلي نوضحلك الموضوع.

## ليش أكو ريحة كلور؟

التعقيم خطوة أساسية بتنظيف الخزان، لأن الفرك وحده يشيل الوسخ الظاهر، بس التعقيم يقضي على البكتريا اللي تبقى على الجدران. المواد المستعملة بتعقيم خزانات الماي أغلبها تعتمد على الكلور، وبعد الشطف تبقى كمية قليلة منه بالخزان، وهي اللي تعطي الريحة.

حتى ماي الإسالة نفسه يجي بيه كلور، لأن هيج تتعقم شبكات الماي بكل مكان. فالريحة الخفيفة مو شي غريب.

## شكد تبقى الريحة؟

بالعادة الريحة تكون أوضح بأول يوم بعد التنظيف، وتخف تدريجياً خلال يوم أو يومين مع استعمال الماي ودخول ماي جديد للخزان. الكلور يتطاير وحده مع الوقت، خصوصاً بالحر.

## إمتى تكون الريحة طبيعية؟

- ريحة خفيفة تشبه ريحة المسابح، وتخف يوم بعد يوم.
- ما يرافقها لون غريب أو رغوة بالماي.
- الماي صافي وما بيه رواسب.

## إمتى لازم تتواصل ويانا؟

- إذا الريحة قوية هواية لدرجة تزعج، أو تحرق العين أو الخشم.
- إذا بقت قوية بنفس الدرجة بعد يومين أو ثلاثة.
- إذا تغير لون الماي أو صار بيه طعم غريب غير الكلور.

بهاي الحالات راسلنا من المحادثة بالتطبيق، أو بلغ عن مشكلة على الطلب نفسه، وفريقنا يتابع وياك.

## نصائح لأول يومين

- إذا الريحة تزعجك، افتح الحنفيات شوية حتى يتجدد الماي بالخزان أسرع.
- للشرب، كثير عوائل تعتمد على ماي معبأ أو فلتر، وتكدر تكمل على هالعادة.
- إذا تحط ماي بإبريق مفتوح بالثلاجة كم ساعة، الريحة تخف بشكل واضح.

## ليش ما نشطف أكثر حتى ما تبقى ريحة؟

الفريق يشطف الخزان بعد التعقيم، بس الهدف مو إزالة كل أثر للكلور، لأن الكمية القليلة اللي تبقى تساعد تحمي الماي بالأيام الأولى. المهم إنها تكون خفيفة وتخف وحدها.

## الخلاصة

ريحة كلور خفيفة بعد التعقيم علامة إن الخزان تعقم، وتروح خلال يوم أو يومين. إذا كانت قوية أو طولت، أو صار شي غريب بالماي، كلنا ونتابع وياك.$md$)
) as v (slug, title, category, featured, body_md)
join public.article_categories as c on c.name = v.category
on conflict (slug) do nothing;
