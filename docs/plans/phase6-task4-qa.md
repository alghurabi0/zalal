# Phase 6, task 4: QA pass

Plan for spec §12.3 "QA pass: empty/error/offline states, accessibility (labels, 44 px targets, contrast), Lighthouse PWA ≥ 90, media retention job". This is the last task of Phase 6 ("Done when: the launch checklist passes", §12.4). Branch `claude/phase6-task4-qa` from `origin/main` after PR 29. This file is deleted when the task ships, and its settled answers move into the spec.

Open questions are at the end (§9). Each one lists a recommended default first. Nothing gets built until they are answered.

## 1. How the audit was done

- **Routes:** every `page.tsx` under `src/app` (56 pages, 4 route handlers). For each page I followed its imports three levels deep, looking for `<Suspense>` + `Skeleton`, `EmptyState` and `ErrorState`/`error.tsx`.
- **Accessibility:** a throwaway Playwright script (not committed) ran axe-core 4.14 against 56 URLs at 390×844 (admin at 1280×800), with tags `wcag2a/aa`, `wcag21a/aa`, `wcag22aa` and `best-practice`. The same pass measured every visible interactive element against 44×44. Data came from the e2e helpers: a signed-up customer with pending, on-the-way, in-progress and completed orders plus a certificate; an admin; a crew with a confirmed job.
- **Contrast:** every text/background token pair used in `src/**/*.tsx`, computed from `globals.css`, plus axe's rendered check.
- **Lighthouse:** 13.6 (the pre-installed Chromium, mobile preset, simulated throttling) against `pnpm build && pnpm start`. Guests got the `zl_welcomed` cookie. The customer pages used the session cookies saved by the script.
- **Installability:** CDP `Page.getInstallabilityErrors` and `Page.getAppManifest` on `/welcome` after the service worker took control.

## 2. Audit findings

Legend: ✓ present · — not applicable (a form or static page that has no list to be empty) · ✗ missing or wrong. "Offline" means the global `OfflineBanner` from the root layout (every surface) plus the service worker's `/~offline` page for a failed page load. The one gap that affects every surface is listed once, in §2.5.

### 2.1 Customer (`(customer)/`, error boundary `(customer)/error.tsx` → `ScreenError`)

| Route | Loading | Empty + CTA | Error | Offline | Findings |
| --- | --- | --- | --- | --- | --- |
| `/welcome` | — static | — | ✓ | ✓ | axe clean |
| `/` Home (guest, customer) | ✓ | ✓ | ✓ | ✓ | axe clean |
| `/login`, `/login/verify` | ✓ | — | ✓ | ✓ | The Terms/Privacy links are inline text 24 px tall (Q5) |
| `/onboarding/name` | ✓ | — | ✓ | ✓ | |
| `/addresses/new`, `/addresses/[id]/edit` | ✓ | ✓ (all labels used) | ✓ | ✓ | ✗ **no `<main>` landmark** (axe `landmark-one-main`, `region`) |
| `/tanks` | ✓ | ✓ | ✓ | ✓ | |
| `/book`, `/book/photos`, `/book/confirm` | ✓ (layout) | ✓ (no address) | ✓ | ✓ | |
| `/book/done/[id]` | ✓ | ✓ | ✓ | ✓ | |
| `/orders` | ✓ | ✓ | ✓ | ✓ | ✗ The segmented tabs الحالية / السابقة are **40 px** tall (`h-10`), with no hit strip |
| `/orders/[id]` | ✓ | ✓ | ✓ | ✓ | |
| `/orders/[id]/track` | ✓ | ✓ | ✓ | ✓ | ✗ axe `nested-interactive` (serious): the map container is `role="img"` and holds focusable children (`tracking-view.tsx:37`) |
| `/orders/[id]/live` | ✓ | ✓ | ✓ | ✓ | |
| `/orders/[id]/certificate` | ✓ | ✓ | ✓ | ✓ | |
| `/chat` | ✓ | ✓ (welcome bubble) | ✓ | ✓ | |
| `/issue` | ✓ | ✓ (no orders) | ✓ | ✓ | |
| `/notifications` | ✓ | ✓ | ✓ | ✓ | |
| `/profile`, `/profile/edit`, `/profile/phone(/verify)`, `/profile/settings` | ✓ | ✓ (subscription card) / — | ✓ | ✓ | |
| `/profile/certificates` | ✓ | ✓ | ✓ | ✓ | |
| `/reports`, `/reports/[id]` | ✓ | ✓ | ✓ | ✓ | |
| `/subscription` | ✓ | ✓ (no address) | ✓ | ✓ | |
| `/tips`, `/tips/[slug]` | ✓ | ✓ | ✓ | ✓ | Article: Lighthouse SEO 90 (no `meta description`) |
| `/terms`, `/privacy` | ✓ | ✓ (placeholder) | ✓ | ✓ | |
| `/maintenance` (N16) | ✓ | — | ✓ | ✓ | |

These were false positives of the 44 px measure, and I checked each one. The chips' `sr-only` inputs sit inside the kit's invisible `-inset-y-1` strip (36–40 → 44–48 px). The chat quick replies (`ChipButton`, same strip) and the whole-card links (`after:inset-0`) on Orders past, N11 and N12 are also covered.

### 2.2 Crew (`crew/`, error boundary `crew/error.tsx`)

| Route | Loading | Empty + CTA | Error | Offline | Findings |
| --- | --- | --- | --- | --- | --- |
| `/crew` (C2) | ✓ | ✓ | ✓ | ✓ (banner, list refresh) | axe clean, no small targets |
| `/crew/jobs/[id]` (C3) | ✓ | ✓ | ✓ | ✓ (media queue and GPS say "ماكو انترنيت") | axe clean |

### 2.3 Admin (`admin/`, error boundary `admin/error.tsx`, desktop 1280×800)

| Route | Loading | Empty | Error | Offline | Findings |
| --- | --- | --- | --- | --- | --- |
| `/admin` (A1) | ✓ | ✓ | ✓ | ✓ | |
| `/admin/orders` (A2) and drawer | ✓ | ✓ | ✓ | ✓ | The drawer's customer phone link is 24 px tall (Q5). Empty rating stars are drawn in `text-track` (1.39:1), `aria-hidden` |
| `/admin/orders/board` | ✓ | ✓ | ✓ | ✓ | ✗ axe `label-content-name-mismatch` ×25: a cell's `aria-label` ("الأربعاء 28: 0 من 2 محجوزة") doesn't contain its visible text |
| `/admin/live` (A3) | ✓ | ✓ | ✓ | ✓ | Order-number link 39 px wide (Q5) |
| `/admin/chat`, `/admin/chat/[threadId]` (A4) | ✓ | ✓ | ✓ | ✓ | |
| `/admin/tickets` (A5), `/admin/ratings` (A12) | ✓ | ✓ | ✓ | ✓ | ✗ Star counts are text in `text-star` (#D97706 on white **3.19:1**, below 4.5) in ratings, the tickets drawer, the order drawer and A11's "مميز" |
| `/admin/prices` (A8) | ✓ | — (6 fixed cells) | ✓ | ✓ | |
| `/admin/schedule` (A9) | ✓ | ✓ | ✓ | ✓ | ✗ axe `color-contrast` ×18: past days in `text-control-off` on `bg` (**2.22:1**) are clickable buttons, not disabled ones. ✗ `label-content-name-mismatch` ×2 |
| `/admin/subscriptions` (A7) | ✓ | ✓ | ✓ | ✓ | |
| `/admin/content`, `/new`, `/[id]`, `/categories` (A11) | ✓ | ✓ / — | ✓ | ✓ | `text-star` (above) |
| `/admin/crews` (A10) | ✓ | ✓ | ✓ | ✓ | ✗ `label-content-name-mismatch` ×1 (`.min-w-11` count badge) |
| `/admin/admins` (A14) | ✓ | — (you are always listed) | ✓ | ✓ | |
| `/admin/audit` | ✓ | ✓ | ✓ | ✓ | |
| `/admin/settings` (A13), `/admin/settings/area` | ✓ | — / ✓ | ✓ | ✓ | |

### 2.4 Public and system

| Route | Findings |
| --- | --- |
| `/c/[code]` (N15) | ✓ every state. Lighthouse SEO 60 is the intended `noindex` (`is-crawlable`) |
| `/certificates/[id]/print` | ✓ `notFound()` for anyone else. The stamp placeholder text is `text-control-off` (2.39:1) on white. It is also printed into the PDF |
| `/~offline` | ✓ axe clean |
| **Unknown URL / `notFound()`** | ✗ **There is no `not-found.tsx` anywhere.** An unknown URL shows Next's built-in English "404 · This page could not be found", outside our layout, with no `<main>` (axe) and no way back. N9's and N15's own "ما لكينا…" states are separate and fine |
| `/kit` | 404 in production (by design) |

### 2.5 Cross-cutting

- **Error state while offline (every surface):** a client navigation or Server Component fetch that fails without network lands in `error.tsx`. That shows "صار خطأ · ما كدرنا نحمّل المعلومات…". The banner above says "ماكو انترنيت", but the screen's own state never does. §5 asks for an offline state per screen. Fix: `ScreenError`/`RootError` show the offline title and icon while `useOnline()` is false, keep "اعد المحاولة", and retry once the device is back online.
- **Retry wording:** every screen-level error state uses the kit's "اعد المحاولة". The per-item retries are the canvas's or the spec's own words and stay as they are: Upload "عيد", Chat "أعد المحاولة", crew media "عيد", N16 "حاول مرة ثانية".
- **Icon-only buttons:** axe found no `button-name` or `link-name` violation on any of the 56 URLs. `IconButton` requires `label`. One manual check remains for buttons that render only after an interaction (sheets, the lightbox, the composer's attach and send buttons, the crew queue's ×). The new e2e test opens those (§6).
- **Focus:** `globals.css` has a global `:focus-visible` outline. The five `outline-none` uses each give their own focus style: `Input` (ring), the card links (`focus-visible:after:outline`), the chat composer and inbox search (border + outline), and the Google Maps search box (inside a field whose border changes). That is fine. The kit's e2e test covers keyboard and focus on the kit only.
- **Contrast of the palette (§4):** every text pair the screens use passes AA (4.5:1) except the three above (`star` text, `control-off` past days and stamp text). Measured: `muted` on bg/surface/selected/well 5.3–6.2; `teal` on bg/surface 5.4/5.8; `ok-fg` on `ok-bg` 4.57; `warn-fg` on `warn-bg` 6.37; `danger` on surface 6.57; `on-dark-muted` on navy 7.5 and on navy-2 6.3; `aqua` on navy 8.0; white on teal 5.8. Below 3:1 for non-text UI, and drawn as in the canvas: input and card borders (`border` on white 1.21), `control-off` chevrons (2.39, decorative), `dashed` add tiles (2.16), `otp-filled` (2.15), `star` icons on `bg` (2.96). Disabled controls (`disabled`, `control-off` on disabled chips) are exempt under WCAG. See Q6.
- **Lighthouse 13.6, mobile (simulated 4G, 4× CPU), one run each:**

  | Page | Perf | A11y | Best pr. | SEO |
  | --- | --- | --- | --- | --- |
  | `/welcome` | 93 | 100 | 100 | 100 |
  | `/` guest | 68 | 100 | 100 | 100 |
  | `/login` | 66 | 100 | 100 | 100 |
  | `/tips` | 74 | 100 | 100 | 100 |
  | `/tips/[slug]` | 68 | 100 | 100 | 90 |
  | `/c/[code]` | 72 | 100 | 100 | 60 (noindex) |
  | `/` customer | 66 | 100 | 100 | 100 |
  | `/orders` | 78 | 100 | 100 | 100 |
  | `/book` | 85 | 100 | 100 | 100 |
  | `/profile` | 70 | 100 | 100 | 100 |
  | `/chat` | 89 | 100 | 100 | 100 |
  | `/notifications` | 71 | 100 | 100 | 100 |

  Performance is the weak spot, and the cause is the same on every page. FCP is about 1.1 s, but LCP is simulated at 4.7–5.3 s, TBT is 450–640 ms, and CLS is 0. The LCP element is ordinary text, for example Login's intro paragraph, with only about 0.6 s of observed render delay. The simulated figure comes from about 2.6 s of main-thread work on boot: two shared chunks of 116 KB and 66 KB, with 141 KB of them unused on first load, plus 14 KB of legacy polyfills. The scores are noisy in this container. Treat them as a baseline, not a verdict (Q8).
- **PWA:** Lighthouse dropped the PWA category in v12. On `/welcome` the manifest parses with no errors, the service worker controls the page, and Chrome's installability check returns only `in-incognito`, which comes from Playwright's throwaway profile. `pwa.spec.ts` already checks the manifest link, icons, theme color and offline page.

## 3. Fixes, grouped by kind

### 3.1 States
1. `src/app/not-found.tsx`: the Arabic 404 inside the root layout (a `<main>`, the kit's `EmptyState`, title "ما لكينا هذه الصفحة", a CTA to Home). Staff on `/admin/*` and `/crew/*` also get a `not-found.tsx` each, linking to their own surface (Q9). The print page's `notFound()` uses the same page.
2. `ScreenError` and `RootError` show the offline state while offline (§2.5), with the strings in `UI` (`offlineTitle`, `offlineBody`). They keep "اعد المحاولة" and call `retry` when the `online` event fires.
3. Location (`/addresses/new`, `/addresses/[id]/edit`): wrap the screen in `<main>`, as every other screen is.

### 3.2 Accessibility
4. Orders' segmented tabs: an invisible `after:-inset-y-0.5` hit strip, the same way the kit's chips do it, so they reach 44 px without changing the 40 px drawing.
5. Tracking: move `role="img"` + `aria-label` from the container to the drawn map itself, so the focusable controls are no longer inside an image.
6. A9 board and calendar, A10's count badge: let the visible text be part of the accessible name (`aria-label` starting with the visible text, or `aria-describedby` for the extra words).
7. A9 past days: `disabled` when they can't be changed, which is exempt, or else `text-muted`.
8. Star counts written as text (A12, A5 drawer, A2 drawer, A11 "مميز"): `text-warn-icon` (#B45309, 5.02:1 on white). Star icons keep `star`.
9. The certificate's stamp placeholder: `text-muted`.
10. Login's Terms and Privacy links, and the admin inline links: per Q5.
11. Article (N9): `description` metadata from the body's first paragraph (SEO 90 → 100).

### 3.3 Performance (bounded, per Q8)
12. Look into the shared 116 KB and 66 KB chunks (`next build --debug`, or the bundle analyzer run once via `pnpm dlx`, not added). Lazy-load anything screen-specific that sits in the root layout (candidates: Sentry and PostHog init are already deferred; check `radix-ui`, `tus-js-client`, `browser-image-compression` and `react-markdown` aren't pulled into shared chunks). No new dependency.

### 3.4 Data: media retention and privacy (§4)
13. Retention job for booking videos (Q1).
14. Audit-log scrub on account deletion (Q3).
15. Leftover certificate PDFs swept nightly (Q3).
16. Chat media swap fix (Q4).

## 4. Schema and RLS

One migration, `qa_retention` (name to be confirmed when written). It needs no new table and no new error code. The next free code stays `ZL042`, unused.

### 4.1 Media retention (Q1 default)
- `private.purge_expired_media()` (`security definer`, `set search_path = ''`, not executable by `anon`/`authenticated`). It deletes the `order_media` rows with `kind = 'customer'` and `media_type = 'video'` whose order closed more than 90 days ago. "Closed" means the last `order_events` row into `completed`, `cancelled` or `no_show`. It returns the count.
- pg_cron `media-retention`, nightly at `23 0 * * *` (03:23 Baghdad), just after `media-cleanup-customer` (00:17 UTC), so the files go the following night (fine for a 90-day rule). The rows' files then count as unattached, and the existing `media-cleanup` customer rule deletes them (they are over 72 h old). The Edge Function doesn't change.
- `order_media` is in the Realtime publication. Its DELETE events carry only the row's uuid `id`, and screens subscribe to inserts only (§7), so nothing leaks.
- Screens: N4's attachments, Job progress and Report show only the files that remain. With Q2's default, N4 says "انحذفت الفيديوهات بعد 90 يوم من الطلب" when an order closed more than 90 days ago (computed from the order, no column).
- Departure from §7: none in the tables. §7 "Storage" and §11 gain the retention rule.

### 4.2 Account deletion leftovers (Q3 default)
- `otp_requests` is **already purged after 7 days** (`purge-otp-requests`, migration `otp_requests`; §7 says so). §13's "no retention job yet" is out of date. With the default, this needs no SQL change, only a §13 correction.
- New `delete_account()` (create or replace, same signature): it also blanks the free text in `admin_audit_log.diff` for the account's orders, tickets and subscriptions (the `note` and `reason` values become `null`, the rest of the row stays). A one-time update in the same migration does the same for accounts already deleted.
- `unattached_media` gains a `certificate` folder: PDFs in `certificates` that no `certificates.pdf_path` names and that are older than 24 h. `media-cleanup`'s Zod enum and `BUCKETS` gain it, plus a pg_cron job at `7 2 * * *` (05:07 Baghdad). This sweeps a PDF left behind when the server's delete after `delete_account` failed.

### 4.3 Chat media swap (Q4 default: fix now)
Same fix as `tickets_app`:
- `private.chat_media_sent` becomes `volatile`.
- `send_chat_message` locks the file (`update storage.objects … set metadata = metadata … returning metadata`) instead of a plain select.
- The chat-media upload policy refuses the name of a sent file (`and not private.chat_media_sent(name)`).
- `supabase/CLAUDE.md` loses "`send_chat_message` not yet".

### 4.4 Tests first (db-change skill)
- `purge_expired_media.test.sql`: at 89 days kept, at 91 days deleted; customer photos, crew photos and clips kept; open orders kept; cancelled and no-show orders by their closing event; `anon`, customer, crew and admin can't execute it (`42501`); the cron job exists.
- `delete_account.test.sql` additions: the audit diffs of the account's entities lose `note`/`reason`, while other accounts' rows and other keys are untouched.
- `unattached_media.test.sql` additions: the certificate folder lists only unreferenced PDFs older than 24 h, and only for `service_role`.
- `chat` storage tests: upload under a sent name refused for customer and admin; delete of a sent file refused; the uploader's own unsent file still deletable; `anon` refused.
- After the migration: `pnpm db:types`, then the `rls-auditor` subagent on the branch.

## 5. Lighthouse and PWA: method and targets

Lighthouse 12+ has no PWA category, so "PWA ≥ 90" becomes a pass/fail check of what that category used to test (Q7):
- **Automated (e2e, `pwa.spec.ts`):**
  - In a persistent Chromium context (not incognito), `Page.getInstallabilityErrors` returns none.
  - `Page.getAppManifest` has no errors.
  - The manifest has `name`, `short_name`, `start_url`, `display: standalone`, `theme_color`, 192 and 512 icons and a maskable 512 (partly covered today).
  - The service worker controls the page after a reload.
  - `/~offline` is served for a failed navigation (already covered).
  - `apple-touch-icon` and `viewport` with `viewport-fit=cover` are present.
- **Lighthouse (manual, reported in the PR):** a script `scripts/lighthouse.mjs` that runs `pnpm dlx lighthouse@13.6.0` (not a dependency) on the 12 pages above against `pnpm build && pnpm start`. It writes a table like §2.5 to `test-results/lighthouse/`. Targets: Accessibility 100, Best practices ≥ 95, SEO ≥ 90 on indexable pages (`/c/*` and the print page are `noindex` by design), Performance reported with no gate (Q8). Not in CI: the scores swing too much in CI runners.

## 6. Tests to add

- **`tests/e2e/a11y.spec.ts`** (Q10, adds `@axe-core/playwright`, dev only): axe over the route list in §2 for a guest, a customer, a crew and an admin. It sets up its own data with the existing helpers. It fails on any `serious`/`critical` WCAG 2.2 A/AA violation, with a small, commented allow-list for accepted canvas departures (Q6). The same test also does the following:
  - It runs the kit test's 44 px check on every customer and crew route. Admin uses Q5's rule. Elements whose hit area comes from a pseudo-element strip are measured with that strip.
  - It opens the sheets, the lightbox and the composer, then checks their icon buttons for names.
  - It tabs through Home, Orders and C2 and checks that each focused element has a visible outline (computed `outline-style` ≠ none, or the box-shadow ring).
- **`tests/e2e/states.spec.ts`:**
  - An unknown URL shows the Arabic 404 with a Home link (also under `/admin/x` and `/crew/x`).
  - Going offline and then client-navigating Home → Orders shows the offline state with "اعد المحاولة". Back online, it recovers.
- **`tests/e2e/pwa.spec.ts`:** the installability checks in §5.
- **Unit:** `ScreenError` renders the offline wording when `navigator.onLine` is false (`react-dom/server`, happy-dom). `tests/unit/theme-tokens.test.ts` gains a contrast table: every text/background pair in a declared list ≥ 4.5, so a token change can't silently break AA.
- **Integration:** `media-cleanup` with the `certificate` folder against local Storage.
- **pgTAP:** §4.4.

Why a library: axe-core is the standard engine (Lighthouse's accessibility category runs it too). Writing WCAG rules ourselves would be large and weaker. `@axe-core/playwright` is only a test dependency and never ships to the browser. I'll pin its latest release that is at least two weeks old when I build (4.14.0 came out Oct 27, so most likely 4.13.x), and give the reason in the PR.

## 7. Docs to update

- **spec §4:** a "Contrast" note with the measured pairs and the accepted canvas departures (Q6). The `text-warn-icon` rule for star counts.
- **spec §5:** "Global rules" adds the offline error state and the 404. N4/Report get the retention note.
- **spec §7:** retention, the certificate sweep, the audit scrub on deletion, and the chat-media lock.
- **spec §11:** "Delete customer-uploaded booking videos 90 days after completion" is built.
- **spec §12.3:** tick task 4. **§12.4:** add "three-device test of the whole path" (Phase 3, part C, still open and manual) and mark which items are the owner's.
- **spec §13:** settle Media retention, Personal data left after a deletion and Chat media swap. Record Q5–Q10.
- **CLAUDE.md:** the a11y e2e test and its allow-list, `scripts/lighthouse.mjs` in Commands, and the 44 px rule for admin (Q5).
- **supabase/CLAUDE.md:** the retention job, the `certificate` cleanup folder, the chat lock, and `delete_account` scrubbing audit diffs.
- Delete this plan.

## 8. Order of work (with /ship-task)

1. **SQL (db-change):** pgTAP first, then the migration, types, `rls-auditor`.
2. The `media-cleanup` folder, with its unit and integration tests.
3. **States:** 404 and offline error.
4. **Accessibility fixes**, then the `a11y.spec.ts` and `states.spec.ts` e2e tests.
5. **PWA checks** and the Lighthouse script, with the report.
6. Bounded performance pass.
7. Docs.

Each step gets its own commit and the full check list (`lint`, `typecheck`, `test`, `db:test`, `test:integration`, `test:e2e`).

## 9. Open questions (recommended default first)

1. **Media retention: what goes after 90 days?**
   - **(a) Default:** customer booking videos only, 90 days after the order closed (completed, cancelled or no-show), as §11 says. Customer photos, crew before/after photos, crew clips and certificates are kept.
   - (b) Also crew clips: they are the bigger storage cost (up to 4 × 100 MB per order), but Report and Job progress show them as the job's evidence.
   - (c) Something else (another period, or chat/ticket videos too). Chat and ticket files stay with their thread or ticket under (a).
2. **Tell the customer?**
   - **(a) Default:** one line on N4's attachments for orders closed more than 90 days ago, "انحذفت الفيديوهات بعد 90 يوم من الطلب".
   - (b) Say nothing.
3. **Personal data left after a deletion:**
   - **(a) Default:**
     - Keep `otp_requests` at the existing 7-day purge (it already runs; §13 is out of date).
     - On `delete_account`, blank the free-text `note`/`reason` values in audit diffs of the account's orders, tickets and subscriptions, and do the same once for accounts already deleted.
     - Add the nightly sweep of unreferenced certificate PDFs.
   - (b) Also delete the number's `otp_requests` at deletion. That resets its send limits, which a user could abuse by deleting and re-creating an account.
   - (c) Leave audit diffs untouched, as staff records.
4. **Chat media swap:**
   - **(a) Default:** fix it in this task, with a new migration doing the same fix as `tickets_app`.
   - (b) Leave it, accepted for v1 (only the customer's own message can be affected).
5. **The 44 px rule outside the customer and crew apps:**
   - **(a) Default:** customer and crew screens get 44 px everywhere. Inline links inside a sentence (Login's Terms/Privacy) are exempt, as WCAG 2.5.8 exempts them. Admin (desktop-first) gets 44 px for buttons and controls, and at least 24 px (WCAG 2.2 AA) for text links in tables and drawers.
   - (b) 44 px everywhere, admin included. Inline links get an invisible strip that may overlap the line above.
6. **Non-text contrast drawn as in the canvas:**
   - **(a) Default:** keep input and card borders (`border`, 1.21:1), the dashed add tiles, the OTP box border and the decorative chevrons as designed. Inputs and tiles all have visible labels or text, so record them as accepted departures in §4 and the axe allow-list.
   - (b) Darken `border` for inputs only (a new `input-border` token around #8A9BB0, 3:1) and leave cards alone. This visibly changes every form.
7. **"Lighthouse PWA ≥ 90":**
   - **(a) Default:** replace it with the automated installability checks in §5 (pass/fail). Add Lighthouse targets of Accessibility 100, Best practices ≥ 95 and SEO ≥ 90 on indexable pages, run by the script and reported in the PR, not in CI.
   - (b) Run Lighthouse in CI with those targets as a gate. It is slower and flaky.
8. **Performance:**
   - **(a) Default:** one bounded pass on the shared JS chunks in this task. Report before/after and set no gate. Performance tuning beyond that goes after launch.
   - (b) Set a target (for example ≥ 80 on the 12 pages) and work until it's met.
9. **404 copy:**
   - **(a) Default:** "ما لكينا هذه الصفحة" with "ارجع للرئيسية", matching N9's and N15's "ما لكينا…". Admin and crew get the same words, linking to their own home.
   - (b) Other words.
10. **Add `@axe-core/playwright`** (dev only) for the route-wide accessibility test?
    - **(a) Default:** yes.
    - (b) No, keep only the hand-written 44 px and focus checks.
11. **Other §13 and §12 items this task can't close:**
    - **(a) Default:** record them as launch-checklist items for the owner and leave them unchecked. They are certificate identity (legal name, stamp, footer phone) and the three-device test (Phase 3, part C, by hand on real phones). The QA task is then done when the code-side checks pass, and Phase 6 is ticked while §12.4 stays the owner's list.
    - (b) Keep the Phase 6 box open until the owner's items are done too.
