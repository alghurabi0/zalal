# Plan: Phase 6, task 1 — Tips, Article (N9), A11 content editor

Status: **waiting for the owner's answers to the questions at the end.** No code written yet. Drafted Oct 27, 2026 from spec §5.5, §5.6, N9, §7, §8.2, §10.2, §12.3 and the Tips and Home canvases. Delete this file in the PR that builds the task, once the spec holds the settled answers.

Spec task (§12.3): "Articles + categories + A11 editor + seeded articles; Tips and Article (N9)".

## Findings

- **Tips canvas** (`design/Tips.dc.html`, `design/png/Tips.png`) shows things the spec doesn't cover:
  - The top card is labelled "مقال اليوم · 3 دقائق" and shows a numbered list of the article's points (the 5 signs).
  - List items have an icon tile (drop for صحة, sun for الصيف, tank lid for نصائح), not a cover image. No cover appears anywhere.
  - In the canvas script only the list filters by category; the top card stays on every chip.
  - The canvas has 3 categories + الكل. §10.2 seeds a 4th (أسئلة شائعة), so 5 chips won't fit at 390px.
  - Back button to Home; tab bar with Home active (spec: Tips keeps Home highlighted).
- **Home canvas** tips strip: header "معلومات تهمك" + "شوف الكل" (→ Tips); two cards side by side, the first navy-2, the second white with a border, each with category label and title. The canvas says "نصيحة" (category is "نصائح") and a different title than the seed: sample data, the database wins.
- **Home quick actions** (§5.5): راسلنا → Chat and بلّغ عن مشكلة → Issue exist. اشتراك سنوي → Subscription (N8, Phase 6 task 2) and شهاداتي → Certificates (N12, Phase 6 task 3) don't exist yet. Home doesn't render the row today.
- `public-content` bucket already exists (migration `storage_buckets`: public, 5 MB, JPEG/PNG/WebP) with no policies.
- Media cleanup: `public.unattached_media(folder, …)` takes `customer | crew | chat | ticket`; a `content` case can be added in a new migration with its own cron job.
- No Markdown library is installed. `src/components/layout/legal-page.tsx` shows Terms/Privacy as plain paragraphs (N14 in task 3 will reuse the renderer from this task).

## 1. Database (one migration `articles`, pgTAP first)

**`article_categories`**: `id` (identity), `name` (2–30, trimmed, unique), `sort`, `icon`, `created_at`, `updated_at`.

- `icon` is new: an enum `droplet | sun | lid | lightbulb | help | shield`, so list items get the canvas's icon tiles.
- Read by everyone (anon included). No direct writes.

**`articles`**: `id` (uuid), `slug` (unique), `title` (5–120), `category_id` (FK, restrict), `cover_path` (nullable, an object in `public-content/articles/`), `body_md` (≤ 20,000), `read_minutes` (see Q3), `featured`, `status` (`article_status`: draft | published), `published_at` (set on first publish; check: published ⇒ not null), `created_at`, `updated_at`.

- RLS: anon and customers read `status = 'published'` only; admins read all; crews read published (public anyway). No direct writes (revoke all, grant select only).

**Audited `security definer` RPCs** (role check `42501`, `private.log_admin_action`, log only what changed; for the body log its length, not the text):

- `admin_save_article(id, slug, title, category_id, cover_path, body_md, featured, status)`: create when id is null, else update; returns the id and the old cover path so the server deletes the replaced file through the Storage API. Actions `article.create` / `article.update`.
- `admin_delete_article(id)`: returns the cover path; `article.delete`.
- `admin_save_category(id, name, icon)`, `admin_delete_category(id)`, `admin_reorder_categories(ids[])`: `category.create` / `.update` / `.delete` / `.reorder`.

**New error codes**: `ZL030` `category_in_use`, `ZL031` `slug_taken`, `ZL032` `slug_locked` (only if Q4 = a), `ZL033` `category_name_taken`. A cover that isn't a finished upload in `public-content/articles/` reuses `ZL009` `upload_not_found`.

**Storage (`public-content`)**: admins upload to and delete from `articles/`; reads need no policy (public bucket). Note: a draft's cover is fetchable by anyone who has its exact URL (random uuid name, unguessable). Covers never attached are deleted after 72 h: `content` case in `unattached_media` + a nightly job, like the other folders.

**Rows every environment needs**: the 4 categories and the 6 seeded articles go in the migration, skipping rows that already exist (by name / slug). `seed.sql` is local only.

**Tests**: pgTAP allowed and denied for anon, customer, other customer, crew, admin on every policy and RPC, plus the storage policies (add to `storage_buckets.test.sql`'s `policies_are` list). Then `pnpm db:types` and the `rls-auditor` subagent.

## 2. Markdown rendering

- **`react-markdown` 10.1.0** (current stable, Mar 2025; peer `react >= 18`, works in Server Components). It builds React elements, so no `dangerouslySetInnerHTML`; the same component renders N9 on the server and the A11 preview in the browser, and later N14 Terms/Privacy. Alternatives `marked` 18.1.2 and `markdown-it` 15.0.3 return an HTML string that needs a sanitizer on top.
- **Safety**: no `rehype-raw` and `skipHtml` on, so raw HTML is dropped; `allowedElements` = `p h2 h3 ul ol li strong em a blockquote hr br` with `unwrapDisallowed` (text kept); `#` headings mapped to the h2 style; no images in the body (covers are the only images); `urlTransform` allows only `https:`, `http:`, `tel:` and same-site paths starting with `/`; external links get `target="_blank" rel="noopener noreferrer nofollow"`. Styles from theme tokens.
- **Unit tests**: `<script>`, `<img onerror>`, `javascript:` / `data:` links, entity-encoded schemes, autolinks.

## 3. Screens

- **Tips** `/tips` (`/build-screen Tips`; guests allowed, not in `loginRequiredPrefixes`): header with back button and "معلومات تهمك"; chips "الكل" + categories that have published articles, in a horizontally scrolling row; the featured card (Q5); article cards (category · read time, title, icon tile); tab bar with Home active; skeleton, empty, error, offline. Screenshot at 390×844 vs `design/png/Tips.png`.
- **Article (N9)** `/tips/[slug]`: back button; cover, or a soft aqua block with the category icon when there is none; category · read time; title; publish date; rendered body; fixed footer "احجز تنظيف" → `routes.book` (guests go through login). No tab bar (§5 rule). Page title = article title. Shows published only (admins included).
- **Home**: the tips strip ("معلومات تهمك" + "شوف الكل" → Tips; two cards → N9), guests too (Q6). Quick actions: Q7.
- **A11** `/admin/content` + "المحتوى" in the admin nav:
  - List: title, category, status, featured, updated; status filter; "مقال جديد".
  - Editor `/admin/content/new` and `/admin/content/[id]`: title, slug, category, featured switch; cover upload (scaled to WebP with `browser-image-compression`, preview, remove); body textarea with "تعديل / معاينة" tabs and a live read time; "احفظ مسودة", "انشر", "رجّعه مسودة", "احذف" (confirm).
  - Categories `/admin/content/categories`: name, icon, article count, move up/down, add, rename, delete (refused while in use, ZL030).
  - The audit log screen learns the new actions.
- **Read time copy** (ICU plural, matches the canvas "2 دقيقة", "3 دقائق", "4 دقائق"): one/two/many/other "# دقيقة", few "# دقائق".
- **e2e**: guest browses Tips, filters, opens an article, CTA → login; drafts never shown to guests; Home strip; admin creates an article with a cover, previews, publishes, finds it in Tips; categories add / reorder / refused delete. New helpers `createArticle()` and `createCategory()` in `tests/e2e/helpers/`.

## 4. Seed articles

Six bodies in Iraqi Arabic, 300–500 words each, with the §10.2 titles, categories and featured flags. Health statements stay general (clean every 6 months, chlorine smell after sterilizing, heat and bacteria), no disease or medical claims; the PR lists the sentences the owner should check first. "5 علامات تكول خزانك يحتاج تنظيف" uses the canvas's five signs as its numbered list.

## 5. Docs

Spec §3 (new library), §5.5, §5.6, N9, §7 (tables, storage policies, error codes, departures), §8.2 (A11 as built), §10.2, §12.3 (tick), §13; `supabase/CLAUDE.md` (error codes, RPCs).

## Questions for the owner (recommended default first)

1. **Seeded articles on prod: draft or published?** Default: **drafts** in every hosted project, so the owner reviews them first; local `seed.sql` publishes them. Until published in A11, Tips shows its empty state and Home hides the strip.
2. **Seed covers** (none exist; migrations can't upload files): default **no covers**. N9 shows the category-icon block; list items always use icon tiles (uniform look). Alternative: the list shows the cover as the thumbnail when there is one.
3. **Read time**: default **computed** from the body at about 150 words a minute, at least 1 (300–500 words → 2–4 min, as in the canvas). Alternative: entered by the admin.
4. **Slugs for Arabic titles**: default **(a)** a Latin slug the admin types (`^[a-z0-9]+(-[a-z0-9]+)*$`, e.g. `tank-cleaning-signs`), editable until first publish, then fixed so shared links keep working (ZL032). (b) Arabic slug (shows as `%D8%B4…` in many share previews). (c) No slug: the id in the URL.
5. **Top card "مقال اليوم"**: default: the **newest featured** published article (the other featured one stays in the list); keep the canvas copy "مقال اليوم" (alternative "مقال مميز", since it doesn't change daily); its numbered list comes **automatically** from the body's first ordered list (≤ 5 items, one line each), otherwise the first paragraph clamped to 3 lines, so the admin fills no extra field; with a category chip selected, the card shows only if it is in that category.
6. **Home strip with fewer than 2 featured**: default: fill with the newest published; hide the strip when none are published.
7. **Quick actions**: default: **add the whole row in task 3**, when N12 lands (N8 lands in task 2), so there is no half row or dead link. Alternative: add it now with Chat and Issue only.
8. **Article cards**: whole cards are links (≥ 44px, accessible name from the title); no departure from the canvas.
