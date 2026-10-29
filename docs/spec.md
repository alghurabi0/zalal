# Zalal v1 — Dev Spec & Build Playbook

Oct 22, 2026 · @Alghurabi

## 1. Overview

Zalal (زلال) v1 is an Arabic, mobile-first PWA for booking water-tank cleaning and sterilization in Karbala, run by one company with its own crews. It ships as one codebase with three surfaces: the customer app (designed), a crew app and an admin dashboard (specified here, not yet designed).

Design source: [Zalal canvas](https://claude.ai/artifact/6oMMA7Tb5eo2KttDmmB1Bb) (17 screens + TabBar, 390×844, RTL, Cairo font). The spec refers to each screen by its artboard file, e.g. `Booking.dc.html`. Each artboard also has an exported image at `design/png/<Name>.png` for visual comparison.

### In scope for v1

- Phone login with OTP over WhatsApp, with SMS fallback that admins can switch on or off
- Saved addresses (map pin + district + landmark) and saved tanks
- Booking: tank type × size × count, date and slot, optional photos/videos, note, cash payment
- Admin confirms every booking; manual crew assignment
- Simple live tracking: crew pin on the map while on the way
- Job progress by status, with optional before and after photos and clips
- Company-issued sterilization certificate (web + PDF) and a skippable company rating
- Support chat (one thread per user), issue reports, push + in-app notifications
- Tips articles managed from the dashboard (seeded)
- Annual subscription in a simple, manually run form
- Cancel and reschedule in-app, blocked within 2 hours of the slot

### Out of scope for v1

- ZainCash and card payments (shown as "coming soon"); online payment timing and refunds
- Price re-quotes, promo codes, referrals
- Crew profiles, crew cards and crew ratings
- Chlorine-reading validation, official health-authority certification
- Live video streaming, routing-based ETA
- WhatsApp notifications (other than OTP), languages other than Arabic

### Decisions log

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Platform | PWA first, mobile-first; on desktop a centered phone-width column |
| 3 | Business model | One company, its own crews |
| 4 | Surfaces | Customer app, crew app, admin dashboard (support inbox inside admin) |
| 6–7 | Language, area | Arabic (Iraqi dialect), i18n-ready; Karbala service polygon, addresses outside are blocked |
| 8 | Name | New users enter their name after OTP |
| 9 | OTP channel | WhatsApp first; SMS fallback, admin toggle. Both through OTPIQ (settled Oct 23, 2026). Our server makes, sends and checks the code; Supabase Auth only holds the session (settled Oct 24, 2026, section 9.1) |
| 10 | OTP rules | 6 digits, 5 min expiry, 45 s resend, 5 attempts then lockout, 07X numbers only |
| 11 | Guests | Can browse tips and prices; login required at Book |
| 12 | Profile | Edit name only; phone change = a code to the current number, then one to the new number (settled Oct 28, 2026: a new-number code alone would let a stolen session move the account); account deletion available, which anonymizes the account (§7 "Account deletion") |
| 13 | Legal pages | Placeholder Terms and Privacy pages |
| 14 | Maps | Google Maps |
| 16 | Address fields | Pin + district + landmark, all required; block/alley/house field removed |
| 17 | Tanks | Saved per address and reused in booking |
| 21–22 | Pricing | Fixed flat price per tank type × size, editable in the dashboard; no re-quotes |
| 23 | Mixed tanks | One order can hold several tanks of different types and sizes |
| 24 | Scheduling | 14 days ahead, admin-defined slots with capacity, admin-blocked dates |
| 27 | Confirmation | Every booking waits for admin confirmation |
| 29–30 | Payments | Cash only; online payments are v2 |
| 31 | Certificate | The chlorine check and certificate are always free |
| G | Subscription | Customer requests it in the app; admin activates and tracks visits by hand. One per address; one visit = one order of up to the tanks covered; paid outside the app (settled Oct 28, 2026, §13) |
| 38 | Cancel/reschedule | In-app and via chat; blocked within 2 h of the slot, no fee |
| 39 | Dispatch | Admin assigns crews manually |
| 40 | Tracking | Crew phone sends GPS while on the way; straight-line distance, no routing ETA |
| 42 | Crew identity | No crew card, details or crew rating |
| 43–44 | Job media | Before photos, after photos and clips are all optional (settled Oct 26, 2026; earlier draft required the photos). Taken from arrival through work, and still accepted for 24 h after completion so an offline queue lands; at most 10 before, 10 after and 4 clips per order (settled Oct 26, 2026) |
| 45–46 | Certificate | A company document (placeholder design), no reading validation |
| 49 | Rating | Skippable, rates the company; 3 stars or fewer opens a support ticket |
| 53 | Notifications | Push + in-app only |
| 54–55 | Content | Articles and categories managed by admin, seeded at launch |
| 59 | Stack | Next.js 16 + Supabase + Vercel (section 3) |
| 60 | Environments | Local (Docker), dev and prod Supabase projects in separate orgs; Claude never holds prod credentials; CI deploys migrations (`docs/supabase-setup.md`). Production releases only through the approved "Deploy prod" workflow, database first, then app (`docs/deploy-setup.md`) |

## 2. Roles and surfaces

Four roles share one login system (phone + OTP); the role on the profile decides which surface opens after login.

| Role | Surface | Route | What they do |
| --- | --- | --- | --- |
| Guest | Customer app | `/` | Read tips, see the price list; asked to log in at Book |
| Customer | Customer app (PWA) | `/` | Book, track, chat, report issues, view certificates, request subscription |
| Crew | Crew app (PWA, mobile) | `/crew` | See assigned jobs, update status, share GPS, upload photos/clips, fill certificate data |
| Admin | Admin dashboard (desktop-first, works on tablet) | `/admin` | Confirm and assign orders, run chat inbox and tickets, manage prices, slots, articles, subscriptions, crews, settings |

Notes:

- A crew is one shared crew phone/account per team (no individual crew profiles in v1). Admins create crew accounts by phone number in the dashboard.
- Admins are invited by phone number from the dashboard; the first admin is created by a seed script.
- Support agents are admins in v1 (one role). A `support` sub-role can be added later without schema changes (role is an enum).

## 3. Tech stack and architecture

One Next.js app on Vercel serves all three surfaces. Supabase provides the database, auth, file storage and realtime. Business rules live in Postgres (RLS, constraints, RPC functions) so every surface enforces them the same way.

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 16 (App Router), TypeScript strict | Route groups `(customer)`, `crew`, `admin`; Server Actions for writes |
| UI | Tailwind CSS v4, Radix primitives, Cairo font via `next/font` | `dir="rtl"` at the root; use logical properties only (`ms-`, `pe-`, `start-`) |
| PWA | Serwist (service worker), web app manifest | Installable; offline page + "you're offline" state. See "PWA and caching" below |
| Database | Supabase Postgres + Row Level Security | Migrations in `supabase/migrations`; generated TS types |
| Auth | Supabase Auth for users and sessions; phone OTP made, sent (OTPIQ) and checked by our server | After a correct code the server signs the user in with a server-only password. A **Send SMS Hook** refuses every Supabase-sent code (section 9.1) |
| Storage | Supabase Storage, private buckets + signed URLs | Resumable (TUS) uploads for video |
| Realtime | Supabase Realtime | Chat messages, order status, crew location. Browser channels join with the user's token (`LiveOrders` sets it before subscribing), or Realtime treats them as guests and RLS refuses the subscription |
| Jobs | `pg_cron` + Edge Functions | Reminders, the subscription's 30-day notice, stale-slot cleanup, unattached media cleanup (`media-cleanup`, §7), the 90-day booking-video retention (§7 Storage). pg_cron calls a function through `pg_net` with a per-job secret from Vault, since the new secret keys aren't JWTs |
| Maps | Google Maps JS API (`@vis.gl/react-google-maps`), Places Autocomplete | Service-area polygon check on the server (PostGIS `ST_Contains`) |
| Push | Web Push (VAPID, `web-push` in the Edge Function `send-push`) | iPhone users must add the app to the home screen (iOS 16.4+). Keys and flow in §9.2 |
| PDF | Headless Chromium (`puppeteer-core` + `@sparticuz/chromium`) in a Vercel function | Renders the HTML certificate so Arabic shaping is correct; PDF stored once in Storage. Off Vercel (local, CI) `CERTIFICATE_CHROMIUM_PATH` names a Chromium instead (§10.1) |
| Media handling | `browser-image-compression` for photos; 60 s / 100 MB cap per video | No server transcoding in v1 |
| Validation | Zod, shared between client and server |  |
| i18n | `next-intl`, single locale `ar`, no locale prefix in URLs | Strings in `messages/ar.json`, keys type-checked; i18n-ready for a second language later |
| Monitoring | Sentry (errors), PostHog (product analytics), both EU region | Free tiers; off without their keys. See "Monitoring, analytics and releases" below |
| Hosting | Vercel (region `fra1`), Supabase (region Frankfurt) | Closest supported regions to Iraq |

Versions: Next.js 16 is decided (Oct 23, 2026). For every other tool, use the current stable release in Phase 0 and pin it in `package.json`. If Serwist or Sentry does not yet support Next.js 16 cleanly, say so before working around it. Tailwind v4 keeps theme tokens in CSS (`@theme` in `globals.css`), not in a `tailwind.config` file.

Pinned in Phase 0 (Oct 23, 2026): Next.js 16.4.2, React 19.3.1, Tailwind 4.3.3, next-intl 4.14.9, Vitest 5.0.5, Playwright 1.64.1, pnpm 10.28.0, Node 22.18+ (it runs the `.ts` scripts and hooks directly), Supabase CLI 2.122.0 (dev dependency), supabase-js 2.118.0, @supabase/ssr 0.12.7, Zod 4.6.7, Postgres 17. Two tools are held one major version back because Next's ESLint config doesn't support the newest yet: **TypeScript 6.0.3** (typescript-eslint supports < 6.1, and 7.0 is out) and **ESLint 9.39** (`eslint-plugin-react` doesn't support ESLint 10). Upgrade both when `eslint-config-next` does. The app keeps the Next 16.4 defaults `cacheComponents` and `partialPrefetching` on. Serwist 9.5.13 (`@serwist/next`, `@serwist/cli`, `serwist`) and esbuild 0.28.2 build the service worker; sharp 0.35.5 generates the icons. The UI kit adds lucide-react 1.61.0 (icons), radix-ui 1.8.1 (Dialog for the bottom sheet), tailwind-merge 3.7.0 (the `cn()` helper) and, for component tests, happy-dom 21.0.4. Monitoring adds @sentry/nextjs 11.9.0 (supports Next 16 with `cacheComponents` and Turbopack) and posthog-js 1.438.20. Phase 1 adds @vis.gl/react-google-maps 1.10.1 (the Location map and Places search) and, for its types, @types/google.maps 3.66.7. Phase 2 adds tus-js-client 4.3.1 (resumable uploads to Supabase Storage, with progress) and browser-image-compression 2.0.2 (photos scaled down before upload; run on the main thread, because its web worker would load the library from a CDN). Phase 4 adds puppeteer-core 25.11.0 and @sparticuz/chromium 153.0.0 (certificate PDFs: 25.11 is the puppeteer release that targets Chrome 153, the newest @sparticuz/chromium build; upgrade the two together) and uqr 0.1.3 (QR codes, no dependencies; it returns the modules, so the code is drawn in the navy token). Phase 5 adds web-push 3.6.7 with @types/web-push 3.6.4 as dev dependencies: only the Edge Function `send-push` uses it (from npm through its `deno.json`), to encrypt and sign each push; its `generateRequestDetails` was checked under Deno 2.9.6 (decrypted and signature verified) and the request goes out with `fetch`. Phase 6 adds react-markdown 10.1.0 (articles, later Terms and Privacy): it builds React elements, so admin Markdown never becomes HTML, and the same component renders on the server (N9) and in the browser (A11's preview). Raw HTML is dropped and only text elements and safe links are kept (`src/components/articles/markdown.tsx`). Next.js already treats both browser packages as external server packages; `next.config.ts` adds @sparticuz/chromium's `bin/` to the two functions that print. Phase 6, task 4 adds @axe-core/playwright 4.13.0 as a dev dependency (the newest release at least two weeks old; it pulls axe-core 4.13): `tests/e2e/a11y.spec.ts` runs axe, the engine Lighthouse's accessibility category uses, on every route; it never ships to the browser. Lighthouse itself runs through `pnpm dlx lighthouse@13.6.0` (`pnpm lighthouse`), not as a dependency. CI uses actions/checkout v7, actions/setup-node v7 (Node 22), pnpm/action-setup v6 and actions/upload-artifact v7.

**PWA and caching (Phase 0).** Serwist runs in its "configurator mode": `pnpm build` runs `next build && serwist build`, and the CLI bundles `src/app/sw.ts` into `public/sw.js` (git-ignored) outside the Next.js bundler. The Turbopack integration (`@serwist/turbopack`) is not used, because its route handler exports `dynamic` and `revalidate`, which Next.js rejects when `cacheComponents` is on. The worker is registered in the root layout and is off in `pnpm dev`. Caching policy:

- Cached: build files under `/_next/static` (hashed names), fonts, and the icons and brand images.
- Never cached: pages, RSC payloads, Server Actions and every cross-origin request (Supabase, Google Maps). Shared crew phones must never show another account's data, and order status must never be stale.
- Precached at install: only the offline page (`/~offline`), its CSS and the Cairo font files. A page load that fails without a network shows that page ("ماكو انترنيت" with "اعد المحاولة", which reloads the requested URL).
- Phase 5 adds the Web Push handlers to the same `src/app/sw.ts` (built in task 3: `push` and `notificationclick`, §9.2). They bundle only the Notifications namespace of ar.json and its formatter, so the worker grew from about 36 KB to 102 KB (30 KB gzipped).

One web app manifest (`src/app/manifest.ts`) covers all three surfaces: crew and admin also start at `/`, and the role picks the surface after login. Its name and description come from `messages/ar.json`, and the theme and splash color is `navy`.

**Sessions and routing (Phase 1).** `src/proxy.ts` runs before every page. It refreshes the Supabase session cookies, sends a guest on a page that needs a login (`loginRequiredPrefixes` in `src/lib/routes.ts`) to Login with `?next=` set, sends a logged-in user away from Welcome and Login, and shows Welcome on first open only (the `zl_welcomed` cookie). Each page checks the session again on the server (`requireViewer` in `src/lib/auth/viewer.ts`), and pages for one role send other roles to their own surface. `next` is accepted only as a path on this site (`safeNext`). Next keeps recently visited pages alive, so forms that must start fresh are keyed by their data, and logout reloads the page so nothing from the account stays in memory on a shared phone.

**Monitoring, analytics and releases (Phase 0).** Owner setup is in `docs/deploy-setup.md`.

- **Off without keys.** Sentry needs `NEXT_PUBLIC_SENTRY_DSN` and PostHog needs `NEXT_PUBLIC_POSTHOG_KEY`. Without them (local, CI, a fresh project) nothing is sent and the app works the same. `next.config.ts` validates both, so a malformed value fails the build.
- **Sentry** (`src/instrumentation.ts`, `src/instrumentation-client.ts`, options in `src/lib/monitoring/sentry.ts`) reports browser, server and edge errors, and traces (10% in production, all in previews). Events are tagged `production` or `preview`. It sends nothing personal: no user, IP, cookies, request bodies, query strings, headers other than `user-agent`, or local variables. No session replay. Source maps are uploaded at build time and then removed from the deploy. `app/error.tsx` and `app/global-error.tsx` report what they catch, and every screen's own `error.tsx` must too (`useReportError`).
- **PostHog** (`src/lib/monitoring/analytics.ts`) runs in Vercel Production only: its key is set there alone. It loads after the page. Page views and clicks are recorded without element text, since a tapped card can show a name, phone or address. No session recording, surveys or extra scripts. Profiles exist only for identified users. From Phase 1, the app identifies logged-in users by user id, never by phone, and calls `posthog.reset()` on logout, because crew phones are shared.
- **Same-origin paths.** Browser events go through the app's own domain so ad blockers don't drop them: `/zl-e` reaches Sentry through `src/app/sentry-tunnel/route.ts`, which forwards only the event and only for our DSN, and `/zl-a` is rewritten to PostHog EU. The service worker never caches either path. A future `proxy.ts` must leave both alone.
- **Releases.** Every PR gets CI and a Vercel preview on dev Supabase. A merge to `main` runs CI, then "Deploy dev" migrates dev Supabase. `vercel.json` stops Vercel from deploying `main` by itself. "Deploy prod" is started by hand and approved: it migrates prod Supabase first, then triggers the Vercel Production build through a deploy hook, so the live app never runs ahead of its database. Functions run in `fra1`.

Why this stack: one language end to end, managed auth/storage/realtime, and very little server code for Claude Code to get wrong. The main lock-in is Supabase, which is plain Postgres underneath and can be self-hosted later.

## 4. Design system (from the canvas)

These tokens are lifted from the artboards' inline styles; put them in `tailwind` theme variables so no screen hard-codes a hex. The canvas files are the visual source of truth; Claude Code should read each `.dc.html` before building its screen.

### Colors

| Token | Hex | Used for |
| --- | --- | --- |
| `navy` | #0B2545 | Primary buttons, headings, ink, dark header |
| `navy-2` | #13315C | Dark cards, icon wells on dark |
| `navy-3` | #1B4A7A | Welcome waves |
| `aqua` | #4CC9F0 | Brand accent, logo, CTA on dark |
| `aqua-soft` | #8FE0F5 | Link hover on dark |
| `teal` | #0A6E8F | Links, active tab, focus border, icons |
| `bg` | #F4F7FB | App background |
| `surface` | #FFFFFF | Cards, inputs |
| `border` | #E3EAF2 | Card and input borders |
| `track` | #D3DCE6 | Progress tracks, inactive steps |
| `muted` | #52627A | Secondary text |
| `body-2` | #34455C | Long body text |
| `on-dark-muted` | #9FB8D3 | Secondary text on navy |
| `selected` | #E6F7FD | Selected chip/card background (with 2px navy border) |
| `disabled` | #C9D3E0 | Disabled button |
| `warn-bg` / `warn-fg` / `warn` | #FEF3C7 / #92400E / #F59E0B | "Needs cleaning", "on the way", unread dot |
| `ok-bg` / `ok-fg` / `ok` | #DCFCE7 / #15803D / #16A34A | Completed, uploaded, certificate |
| `map-bg` | #E8EEF3 | Map placeholder |

**Colors used in the canvas but missing from the table above.** Add tokens for these in Phase 0 (pick names that fit the scheme above). Note that the table has no error color, but every screen needs an error state:

| Hex | Where it appears | Suggested token |
| --- | --- | --- |
| #B42318 | "تسجيل الخروج" (Profile), "مباشر" label (LiveJob); also use it for error text | `danger` |
| #DC2626 | "مباشر" live dot (LiveJob) | `live` |
| #EEF2F7 | Row dividers inside cards (Checkout, Profile, Report) | `divider` |
| #B45309 | Amber icon stroke on `warn-bg` (Home, Notifications) | `warn-icon` |
| #78350F | Strong text on amber banner (LiveJob) | `warn-strong` |
| #D97706 | Star / rating accent (Report) | `star` |
| #8FB6CC | Dashed "add file" tile border (Upload, Issue) | `dashed` |
| #BFE6F5 | Quick-reply chip border (Chat, Notifications) | `chip-border` |
| #9AA9BC | Unchecked radio border, row chevrons (Checkout, Profile) | `control-off` |
| #9FB3C8 | Filled OTP box border (Otp) | `otp-filled` |
| #F1F5F9 | Neutral icon well (Notifications) | `well` |
| #C9D8EA, #DCE7F3 | Body text on navy (Main, Tips featured card) | `on-dark-body` (one token is enough) |

These are now tokens under the suggested names (Phase 0).

Illustration-only colors don't need tokens. Keep them inside the illustration or SVG component: the map drawing (#DCE5EC, #D4EDDA, #BFE3F2), the photo placeholders in Report (#8B7355, #2B8FB3), the Iraqi flag in Login (#CE1126, #000000) and the shadows (`rgba(11,37,69,…)`). Shadows become `shadow-*` theme tokens.

### Type, shape, spacing

- Font: Cairo 400–900. Page title 28/900, screen title 20/900, section label 15–16/800, body 15–17/400–700, meta 12–13. Line height 1.7 for Arabic body text.
- Radii: inputs and chips 12–14, buttons 16, cards 18, round icon buttons 22 (44×44), bottom sheet 26 top corners.
- Heights: primary button 56 (54 in footers, 48 inside cards), inputs 56 (46 in compact forms), chips 40–52. Minimum touch target 44.
- Screen padding 20–24; vertical gaps 8–14.
- Icons: 24-grid, 2px stroke, round caps. Use `lucide-react` and match the canvas glyphs. lucide has no water tank, so Booking's two tank glyphs live in `src/components/icons/tank-icons.tsx`.
- Logo: the three-wave mark in `Main.dc.html`, extracted to `public/brand/logo.svg`. `pnpm icons` (`scripts/generate-icons.mjs`) generates the rest from it (commit the output): the Welcome tile (`public/brand/logo-tile.svg`, also the favicon `src/app/icon.svg`), the 192 and 512 icons (rounded tile), a 512 maskable icon (full bleed, mark inside the 80% safe zone) and the 180 Apple touch icon (`src/app/apple-icon.png`, full bleed).
- Numbers: Western digits (0–9) as in the designs; currency written "35,000 د.ع".
- Phone numbers and times are wrapped in `dir="ltr"` spans, as in the designs.

### Tokens in code

All tokens live in `@theme` in `src/app/globals.css`. Tailwind's default colors, radii, font sizes, line heights, letter spacing and shadows are removed, so only these exist (`tests/unit/theme-tokens.test.ts` checks the colors against this section):

- **Colors:** the names in the two tables above, plus `white` and `black` for translucent overlays (`bg-white/90`, `bg-black/55`, `bg-navy/75`).
- **Radii:** role names `chip` 12, `input` 14, `button` 16, `card` 18, `sheet` 26 (`rounded-t-sheet`). One-offs use pixel names: `4` (chat bubble tail), `8` (photo badges), `10` (status badges), `20` (video player, dark profile card), `30` (logo tile). The canvas's other radii are all half the element's height (dots, progress bars, 44×44 icon buttons, 38px pills), so they use `rounded-full`.
- **Font sizes:** pixel names for each size in the canvas: `text-11` to `text-20`, `text-22`, `24`, `26`, `28`, `44`.
- **Line heights:** `display` 1.2, `tight` 1.3, `snug` 1.4, `normal` 1.5, `relaxed` 1.6, `body` 1.7 (the default on `body`). These replace Tailwind's defaults of the same names, whose values differ.
- **Letter spacing:** `wordmark` 6px ("ZALAL"), `phone` 1px (phone input).
- **Shadows**, by where the canvas uses them: `card`, `float` (controls over the map), `sheet`, `fab` (tab bar Book button), `pin` (crew pin), `segment` (active segmented tab), `knob` (switch), `logo`.
- **Layout:** `max-w-phone` is 430px, so phones up to the largest common width (430) are full width and wider screens get a centered column. The canvas artboards are 390 wide.
- **Spacing:** Tailwind's 4px scale already covers every canvas value (`p-5.5` = 22px), so there are no spacing tokens.
- **Animations:** `animate-sheet-in` / `sheet-out` and `animate-fade-in` / `fade-out` for the bottom sheet and its overlay, always behind `motion-safe:`.
- **Safe area:** `pb-safe-*` pads by the larger of the spacing value and the iPhone home-indicator inset (`pb-safe-6` = max(24px, inset)). The root layout sets `viewport-fit=cover` so the inset is known. The tab bar, sheets and full-screen footers use it instead of a plain `pb-*`.
- **Class merging:** components join classes with `cn()` (`src/lib/cn.ts`, tailwind-merge configured with the tokens above), so a `className` passed by a screen overrides the component's default for the same property. `tests/unit/cn.test.ts` checks that its token lists match `globals.css`.

### UI kit (`src/components/ui/`)

Built in Phase 0 from the canvas. Screens compose these before writing new markup. `/kit` shows every component in its states (a 404 in production); `tests/e2e/kit.spec.ts` checks focus, keyboard and 44px touch targets there.

| Component | Variants (canvas source) |
| --- | --- |
| `Button` | `primary`, `accent` (aqua on navy), `secondary` (white + border), `ghost` (white text on navy), `link` (teal text); sizes `lg` 56, `footer` 54, `md` 52, `card` 48, `sm` 44; `loading`; `href` renders a link |
| `IconButton`, `BackButton` | 44px circle: `surface`, `floating` (map), `dark` (navy header), `soft`, `primary`; optional unread dot; `label` (aria-label) is required |
| `Chip`, `ChipGroup`, `ChipButton` | `option` (tile), `pill` (filter), `tag` (rating); real radio/checkbox inputs in a `<fieldset>`. `ChipButton` = chat quick reply |
| `Card` | `outline`, `raised` (shadow), `dark` (navy); `href` renders a link |
| `Input`, `Textarea`, `Select`, `Field` | `default` 56px, `compact` 46px (sheet forms, admin forms); `Select` is a native select with the inputs' look (Phase 3, admin); `Field` wires label, hint and error |
| `Sheet` (modal), `SheetPanel` (in-page, under a map) | 26px top corners, handle, safe-area padding. No drag-to-dismiss |
| `TabBar` | 4 tabs + raised احجز; `active`, `chatUnread` |
| `Stepper` | Quantity − / + with min/max |
| `Switch` | On/off row from Profile's reminder toggle: a 48×28 teal track, a real checkbox with `role="switch"` (Phase 6, task 2: Checkout's subscription toggle) |
| `StepProgress` | Booking's plain bars (`steps={3}`) or Tracking's labelled steps (`steps={[…]}`) |
| `Skeleton`, `SkeletonGroup` | Loading placeholders; the group announces "جاري التحميل" |
| `EmptyState`, `ErrorState` | Icon, title, text, CTA; tones `neutral`, `success`, `danger`. `ErrorState` adds "اعد المحاولة" (pass Next's `retry` in `error.tsx`) |
| `OfflineBanner` | "ماكو انترنيت" bar; rendered once in the root layout for every surface |
| `Lightbox` | Photos full screen over a dark overlay, with previous/next and arrow keys when there are several (Phase 4: Job progress, Report) |

Departures from the canvas, made for accessibility: chips drawn 36–40px tall, and Orders' 40px segmented tabs, get an invisible strip that makes their touch target 44px; the tab bar's احجز link is named by its visible text instead of the canvas's aria-label "حجز جديد"; modal sheets have a close button that appears only on keyboard focus.

**Contrast (Phase 6, task 4; settled Oct 28, 2026).** Every text/background pair the screens use reaches WCAG AA (4.5:1); `tests/unit/theme-tokens.test.ts` lists them, so a token change can't break one silently. Measured: `muted` on `bg`/`surface`/`selected`/`well` 5.3–6.2, `teal` on `bg`/`surface` 5.4/5.8, `ok-fg` on `ok-bg` 4.57, `warn-fg` on `warn-bg` 6.37, `danger` on `surface` 6.57, `on-dark-muted` on `navy` 7.5, `aqua` on `navy` 8.0. `star` (3.19 on white) is for star icons only; star counts written as text use `warn-icon` (5.02). Kept as drawn in the canvas, as non-text that sits next to a label or text: input and card borders (`border`, 1.21), the dashed add tiles (`dashed`), the filled OTP box (`otp-filled`), chevrons (`control-off`, decorative) and star icons on `bg` (2.96). Disabled controls are exempt.

**Accessibility checks (Phase 6, task 4).** `tests/e2e/a11y.spec.ts` runs axe (WCAG 2.2 A/AA and best practices) on every route of the four roles and on the sheets, measures touch targets and tabs through Home, Orders, Profile and C2 checking that the focus is visible. Touch targets: 44 px on the customer and crew apps; links inside a sentence (Login's Terms and Privacy) are exempt, as WCAG 2.5.8 exempts them; the dashboard (desktop-first) needs 44 px for buttons and controls and at least 24 px (WCAG 2.2 AA) for text links in tables and drawers. Where an accessible name adds words to a control's visible text, the visible text comes first (WCAG 2.5.3).

## 5. Customer app screens

Each designed screen below lists what changes from the canvas, how it behaves, and its states. The canvas copy (Iraqi Arabic) is final unless a change is listed. Text in \[brackets\] in the designs is sample data and comes from the database.

**Global rules for every screen:** skeleton loaders while loading; an empty state with a CTA; an error state with "اعد المحاولة"; a top offline banner "ماكو انترنيت". Phase 6, task 4: while the browser is offline the error state is the offline state ("ماكو انترنيت", with "اعد المحاولة"), and a screen's error boundary tries again by itself once the network is back; an unknown URL, on any surface, shows the Arabic 404 "ما لكينا هذه الصفحة" with "ارجع للرئيسية" (Home sends staff on to their surface). The tab bar shows only on Home, Tips, Notifications, Orders and Profile.

### 5.1 Welcome — `Main.dc.html`

- Route `/welcome`. Customer URLs are kept in `src/lib/routes.ts`: Home `/`, Login `/login`, OTP `/login/verify`, Name `/onboarding/name`, Location `/addresses/new` and `/addresses/[id]/edit`, My tanks `/tanks`, Orders `/orders`, Booking `/book`, Chat `/chat`, Profile `/profile`, Terms `/terms`, Privacy `/privacy`.
- Shown on first open only: a guest's first visit to `/` redirects here and sets the `zl_welcomed` cookie (also set when Welcome is opened directly). A logged-in user goes straight to Home (`src/proxy.ts`).
- "ابدأ الآن" opens Login. "تصفح بدون تسجيل" opens Home in guest mode.

### 5.2 Login — `Login.dc.html`

- Input accepts `7XXXXXXXXX` or `07XXXXXXXXX`; it is stored as E.164 `+9647XXXXXXXXX`. Valid pattern: `^7[3-9]\d{8}$` after stripping a leading 0.
- Channel picker: WhatsApp (default) and SMS. **The SMS button is hidden when the admin toggle `sms_enabled` is off.**
- "أرسل الرمز" stays disabled until the number is valid.
- Errors: invalid number; too many requests ("جرب بعد X دقايق"); WhatsApp send failed, which offers SMS if enabled, otherwise "جرب مرة ثانية".
- Terms and Privacy links open the placeholder pages (N14). Phase 1 shows the settings text as plain paragraphs (an empty state until it is written); Markdown rendering comes with N14 in Phase 6, task 3 (the renderer exists since task 1, `MarkdownText`).
- While `sms_enabled` is off, the intro says "على واتساب" instead of "برسالة SMS أو واتساب".
- The number being verified travels to OTP in an httpOnly cookie, never in the URL, so it stays out of analytics and logs.

### 5.3 OTP — `Otp.dc.html`

- **Change:** show the channel actually used (WhatsApp or SMS) and the real number. The design hard-codes WhatsApp.
- **Change:** replace the on-screen keypad with the system number keyboard. Keep the 6 boxes, backed by one hidden input with `inputmode="numeric"` and `autocomplete="one-time-code"`, so paste and SMS autofill work.
- Auto-submit at 6 digits. A wrong code shows "الرمز غلط، باقي X محاولات"; after 5 wrong codes the number is locked for 15 minutes.
- The resend timer runs 45 s, then offers "أعد الإرسال" and, if SMS is enabled, "أرسل برسالة SMS".
- Routing after success: crew and admins go to their surface (§2); a new user goes to Name (N1), then Location; a user without an address goes to Location; everyone else returns to where they were going (e.g., Booking) or to Home. "Where they were going" is the `next` the login started with.

### 5.4 Location — `Location.dc.html`

- Used in onboarding and for adding or editing an address. In onboarding the back button is replaced by "بعدين", which goes to Home.
- The map moves under a fixed center pin. Search uses Places Autocomplete, restricted to Iraq and biased to Karbala. "موقعي الحالي" uses browser geolocation.
- **Change:** remove the "محلة / زقاق / دار" field. Required fields: pin, district (الحي), landmark (أقرب نقطة دالة). The district field gets full width.
- The label chips (البيت / بيت الأهل / الشغل) are kept; a label may be used once per user.
- On save, the server checks the pin against the service polygon. Outside the area: "بعد ما نخدم منطقتك، حالياً بس كربلاء", and the address is not saved.
- Location permission denied: the map stays on Karbala center and search still works.
- A new address asks for the position on open. Labels the user's other addresses already use are shown disabled, and the first free one is preselected. With all three labels used, the screen explains it instead of the form.
- **Without a Google Maps key** (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` unset, as locally and in CI): the map is the canvas drawing, the search box is hidden, and the pin is set only by "موقعي الحالي" (or stays on Karbala center). The subtitle says so.

### 5.5 Home — `Home.dc.html`

- **Change:** the address in the header opens the address picker sheet (N2), not the Location screen.
- The greeting follows the time of day (صباح الخير / مساء الخير) plus the first name. The bell shows a dot when there are unread notifications.
- **Active order card:** shown when an order is in `pending_confirmation` … `in_progress` (the soonest one if several). The copy follows the status: بانتظار التأكيد / مؤكد · \[date slot\] / الفريق بالطريق · \[X كم\] / الشغل شغال. When on the way it opens Tracking; otherwise it opens Order details.
- **Tank status card**, for the selected address and the tank due soonest:
  - No history: "ما عدنا سجل لخزانك" with a book CTA.
  - OK: green "نظيف" with the next date.
  - Due within 30 days: amber "قرب موعده".
  - Overdue: amber "يحتاج تنظيف".
  - The bar fills with months since the last cleaning ÷ 6. The interval (6 months) is an admin setting.
- Quick actions: اشتراك سنوي → Subscription (N8); شهاداتي → Certificates (N12); راسلنا → Chat; بلّغ عن مشكلة → Issue.
- Tips strip: the 2 newest featured articles, each opening Article (N9).
- Guest mode: the header shows "سجّل دخول"; there are no order or tank cards; a price-list card appears with a book CTA that goes through login.
- **Phase 1 builds a shell**: the header (address picker N2, or "سجّل دخول" for guests), the greeting and the tab bar. The bell, cards, quick actions and tips strip come with the phases that own their data (the price list in Phase 2). The address chosen in N2 is kept per device (`zl_address` cookie) and falls back to the default address.
- **Phase 2 adds the cards** (settled Oct 25, 2026):
  - The active order card updates live through Realtime. An order the crew is working on comes first. A pending or confirmed order whose slot has already ended (staff haven't acted on it yet) shows only when there is no other. Until Tracking exists (Phase 4) it always opens Order details, says "الفريق بالطريق إلك" without the distance, and its link reads "التفاصيل".
  - The tank status card follows the cleaned tank due soonest at the chosen address. Tanks we never cleaned have no date, so with none cleaned the card shows "ما عدنا سجل لخزانك". Its book button shows in every state.
  - Guests get the price list (the 6 rows of `price_list`) with "احجز تنظيف", which goes through login.
  - The bell, quick actions and tips strip still wait for the screens they open (Phases 5–6).
- **Phase 6, task 1 adds the tips strip** (everyone, guests too; settled Oct 28, 2026): "معلومات تهمك" with "شوف الكل" (Tips) and the 2 newest featured articles, filled with the newest others when fewer than 2 are featured; the first card navy-2, the second white, each with its category and title, opening Article (N9). Hidden while no article is published. The quick actions come as one row with Phase 6, task 3, when Certificates (N12) exists (Subscription, N8, came with task 2 and opens from Profile until then), so there is never a half row or a dead link.
- **Phase 6, task 3 adds the quick actions** (customers only; settled Oct 28, 2026: guests already get the price list, and three of the four need a login): the canvas's row of four 58 px white tiles between the tank card and the tips strip, اشتراك سنوي (N8), شهاداتي (N12), راسلنا (Chat) and بلّغ عن مشكلة (Issue).
- **Phase 5, task 3 adds the bell** (logged-in users): the canvas's round navy-2 button at the end of the header, opening Notifications, with the amber dot while any notification is unread, live through Realtime. Guests have none.

### 5.6 Tips — `Tips.dc.html`

- Category chips come from the database, with "الكل" first. The top card is the admin-pinned featured article. Every item opens Article (N9).
- Built (Phase 6, task 1; settled Oct 28, 2026): route `/tips`, guests too. The chips are الكل plus the categories that have a published article, in A11's order; they scroll sideways when they don't fit (§10.2 seeds a fourth category). The top card is the newest featured article, labelled "مقال اليوم · [read time]" as in the canvas; under its title it lists the body's first numbered list (up to 5 items, at most 2 lines each, as the canvas's five signs), or else the body's first paragraph (3 lines), so the admin fills nothing extra. A picked chip filters the list, and the top card shows only while its category is picked or under الكل. List cards show the category's icon tile (as in the canvas; no cover), "category · read time" and the title; whole cards are links. Read time is "# دقيقة" / "# دقائق" (Arabic plural rules). Empty state with "احجز تنظيف"; error and offline as everywhere. The tab bar keeps Home highlighted.

### 5.7 Notifications — `Notifications.dc.html`

- Grouped by اليوم / قبل. Tapping an item marks it read and deep-links to its target. "قراءة الكل" marks everything read. Empty state: "ماكو إشعارات".
- **Built (Phase 5, task 3):** route `/notifications` (customers; staff go to their surface). Newest first, 30 at a time ("عرض المزيد"), live through Realtime. Groups by the Baghdad day; the time is the clock for today, "أمس", or the date. Unread items are white with the chip border and the teal dot; read ones sit on the background, as in the canvas. "قراءة الكل" shows while something is unread. Each item opens `/notifications/<id>`, which marks it read and redirects to its target (§9.2); push taps use the same route. The canvas's sample items are replaced by the §9.2 copy (its "فيديو قبل وبعد جاهز" has no event in v1, and "شهادة التعقيم صدرت" becomes §9.2's "شهادة التعقيم جاهزة"). Icon tiles follow the canvas's (truck on amber for on the way, chat on light aqua, shield on green for the certificate, clock on grey for reminders) and the same family for the other events. Empty state: "ماكو إشعارات" with "احجز تنظيف".

### 5.8 Profile — `Profile.dc.html`

- "تعديل" opens Edit profile (N10).
- The subscription card has 4 states: none (CTA to N8), requested ("طلبك قيد المراجعة"), active (visits left, next visit, expiry), expired (renew CTA).
- Rows:
  - عناويني → N2
  - خزاناتي → N3
  - **Change:** طرق الدفع becomes a read-only row: "كاش · الدفع الإلكتروني قريباً"
  - شهادات التعقيم → N12
  - **Add:** بلاغاتي → N11, الإعدادات → N13
- The reminder toggle saves `profiles.reminders_enabled`. Logout asks for confirmation, then shows Welcome.
- **Phase 1 builds a shell**: name and phone, عناويني (N2 as a sheet), خزاناتي (N3) and logout. بلاغاتي (N11) came with Phase 5, task 2. The rest comes in Phase 6.
- **Phase 6, task 3 completes it** (settled Oct 28, 2026): "تعديل" (N10) next to the name; the rows عناويني, خزاناتي, طرق الدفع (read-only "كاش · الدفع الإلكتروني قريباً", no chevron), شهادات التعقيم (the count, N12), بلاغاتي, الإعدادات (N13) and "تذكير بموعد التنظيف" with the kit's `Switch` (saves `reminders_enabled` at once; flips back with a message if the save fails); then a second card with "مركز المساعدة وتواصل معنا" (Chat) and logout.
- **Phase 6, task 2 adds the subscription card** (settled Oct 28, 2026): the canvas's navy card between the name and the rows, one per address that has a running, requested or expired subscription (named "البيت · الحي" when the customer has several addresses), else one for Home's chosen address. Active: "فعّال" ("يبدأ قريباً" before its start), "الزيارات المتبقية" (left of total), "الزيارة الجاية" (the soonest open covered order; else the month the next cleaning is due: the last covered visit plus the cleaning interval, or the start, today at the earliest; "—" with no visit left), and "ينتهي" (month and year). Requested: "قيد المراجعة". Expired: "جدّد الاشتراك". None, declined or cancelled: "زيارتين تنظيف بالسنة وتذكير بالموعد" with "اشترك". The whole card opens N8 for its address. Live through Realtime.

### 5.9 Booking step 1 — `Booking.dc.html`

- **Add:** an address row at the top with "تغيير", which opens N2.
- **Change (mixed tanks):** the order holds a list of tank lines. Saved tanks at the address appear as selectable cards. The design's type + size picker becomes the "أضف خزان" form, and each line has its own quantity stepper. Maximum 6 tanks per order. New tanks are saved to the address.
- Dates: the next 14 days in a horizontal scroll. Blocked dates are hidden; full days are disabled and marked "ممتلئ".
- Slots: admin-defined, each showing remaining capacity. A full slot is disabled.
- **Change:** the price label "السعر التقريبي" becomes "السعر"; prices are fixed. Total = Σ line price × qty, using the price table from the database.
- A guest tapping Book goes through login, then returns here.
- Built (Phase 2): `/book`, `/book/photos`, `/book/confirm` share one layout that loads the address (Home's choice, else the default), its saved tanks, the price list, `booking_availability()` and the tank limit once. The booking in progress is kept per user in `sessionStorage`, so a reload or a trip to Location keeps it; uploads still running are lost on a reload.
- A first booking at an address with no saved tanks starts with one new line, the design's choice (خزان سطح, 1,000–2,000, ×1), which the customer can edit or remove (settled Oct 25, 2026). Changing the address drops the saved-tank lines and keeps the new-tank lines. Slots that start within the cutoff are left out, and a day left with none is hidden; a slot's places left show under its time.

### 5.10 Booking step 2 — `Upload.dc.html`

- Optional. Up to 4 files. Videos: 60 s and 100 MB maximum. Photos are compressed in the browser to about 1600 px.
- Uploads start right away, with progress, retry on failure, and remove (×). The note allows 500 characters.
- Confirming the booking waits until uploads finish. "تخطي" goes to Checkout.
- **Change (copy):** the intro drops "ويعطيك سعر أدق", since prices are fixed with no re-quotes (decisions 21–22; settled Oct 25, 2026).
- Built (Phase 2): files go from the phone straight to `order-media/customer/<user id>/<random>` over TUS (resumable, `tus-js-client`). Videos are checked on the device (length from the file's metadata; the server can't check it in v1) and photos are scaled to 1600 px on the longer edge. × stops an upload or deletes the finished file. `create_order` books a file only within 48 h of its upload (migration `media_cleanup`); the app forgets an older one (at 46 h, by the device's clock, on reload and when Checkout confirms) and sends the customer back to add it again. Unbooked uploads are deleted after 72 h (§7).

### 5.11 Booking step 3 — `Checkout.dc.html`

- Summary rows link back to their step. Payment: كاش is selected; زين كاش and بطاقة are shown disabled with a "قريباً" tag.
- The breakdown lists one row per tank line, then "فحص كلور وشهادة: مجاناً", then the total.
- Active subscription with visits left: a toggle "استخدم زيارة من اشتراكك". The order is then flagged `uses_subscription`, the total shows "مشمول بالاشتراك", and the admin verifies coverage when confirming.
- **Change:** "أكّد الحجز" creates the order as `pending_confirmation` and opens Booking success (N5), not Tracking.
- The slot is re-checked on submit. If it filled up, the user sees "الموعد انحجز، اختار موعد ثاني" and returns to step 1.
- **Change (footer text):** "تكدر تلغي أو تغير الموعد لحد ساعتين قبل".
- Built (Phase 2): "أكّد الحجز" makes a request id once and keeps it with the booking, so a retry or a double tap returns the same order (`create_order`'s `client_request_id`); any change to the booking makes a new one. A slot that filled up or closed sends the customer back to step 1 with the slot cleared; a missing upload sends them to step 2.
- Built (Phase 6, task 2): when the booking's address has a running subscription, a card with the kit's `Switch` "استخدم زيارة من اشتراكك" sits between payment and the breakdown, off by default, with "باقي لك 1 من 2 زيارات" under it. On, the total reads "مشمول بالاشتراك" (the lines keep their prices; `orders.total_iqd` stays their sum). When the subscription can't cover this booking the switch is disabled and says why: the date is outside its period, no visit is left, or the order has more tanks than it covers (book the rest as another order). `create_order` checks again (`ZL034`); a refusal turns the switch off and shows the reason. The canvas has no toggle; it follows Profile's.

### 5.12 Orders — `Orders.dc.html`

- الحالية = `pending_confirmation`, `confirmed`, `on_the_way`, `arrived`, `in_progress`. السابقة = `completed`, `cancelled`, `no_show`.
- Primary CTA by status:
  - pending or confirmed → تفاصيل
  - on the way → تتبّع
  - arrived or in progress → تابع الشغل
  - completed → الشهادة
  - cancelled → أعد الحجز
- Tapping a card opens Order details (N4). "مساعدة" opens Chat tagged with the order. Lists load 20 at a time.
- **Built (Phase 4, task 1):** on the way → "تتبّع الفريق" (Tracking), arrived or in progress → "تابع الشغل" (Job progress); Home's card does the same ("تتبّع" / "تابع الشغل"). **Phase 4, task 2:** completed → "الشهادة" (Report). `primaryAction()` and `actionHref()` in `src/lib/orders/status.ts` are the one place that changes.
- **Until Phase 4/5** (settled Oct 25, 2026): Tracking, Job progress and the certificate didn't exist yet, so every order except a cancelled one got "تفاصيل الطلب" (Order details). `primaryAction()` in `src/lib/orders/status.ts` is the one place Phase 4 changes. "مساعدة" was hidden until Chat (Phase 5, task 1, built: a secondary button beside the main one on every card). Labels follow the canvas where it has them (تفاصيل الطلب, تتبّع الفريق) and the spec elsewhere. The canvas's "الشهادة والفيديو" becomes "الشهادة", and "أعد الحجز" starts a fresh booking.
- The tab is in the URL (`?tab=past`), and "عرض المزيد" loads 20 more (`&n=40`). Current orders show soonest first, past ones newest first. The list updates live through Realtime.
- Status badges: بانتظار التأكيد / مؤكد / الفريق بالطريق / الفريق وصل / الشغل شغال / مكتمل / ملغي / ما لكينا أحد (no-show).

### 5.13 Tracking — `Tracking.dc.html`

- **Change:** remove the crew card (name, rating, job count, plate). The call button dials the company number from settings; the chat button opens Chat.
- The map shows the home pin and the crew's latest position, updating in real time. The design's "12 دقيقة" bubble and "يوصل حوالي" are replaced by the straight-line distance ("3.2 كم") and "آخر تحديث قبل X ثانية".
- Steps: تأكد / بالطريق / وصل / خلص, driven by the order status.
- If the location is more than 2 minutes old: "موقع الفريق ما ديتحدث هسه". The screen is available only while on the way or arrived.
- Built (Phase 4, task 1): route `/orders/[id]/track`; other statuses go to Job progress (from arrival) or Order details. The age is counted against the server's clock (measured once per page read), so a phone set to the wrong time still shows the right age. Before the first position: "بانتظار موقع الفريق". The chat button (Phase 5, task 1) opens Chat tagged with the order; the call button shows once `company_phone` is set. "تابع الشغل بعد ما يوصلون" stays disabled while on the way and becomes "تابع الشغل" on arrival. Map: Google Maps markers when both `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` are set (Advanced Markers need a Map ID); otherwise the drawn map with both pins to scale and a straight dashed line (no routing, §1).

### 5.14 Job progress — `LiveJob.dc.html`

- **Change:** drop the video player, the 5 fixed steps and the chlorine countdown. The screen shows:
  - a status timeline: وصل الفريق / بدأ الشغل / خلص الشغل, with times
  - a "قبل" photo gallery
  - optional clips the crew uploaded
  - a "بعد" photo gallery
- The "مباشر" badge shows only during `in_progress`. New media appears in real time. "شوف الشهادة" is enabled once the order is `completed`.
- Built (Phase 4, task 1): route `/orders/[id]/live`, open from arrival on (also after completion); on the way it sends the customer to Tracking. Photos open full screen. The button reads "شوف الشهادة (بعد ما يخلص)" disabled until the order is completed, then "شوف الشهادة", which opens Report (Phase 4, task 2). A file the crew takes back disappears on the next load (Realtime sends only new files to the screen). The footer's chat button (Phase 5, task 1) opens Chat tagged with the order.

### 5.15 Certificate and rating — `Report.dc.html`

- **Change:** the before/after tiles show photos (with a lightbox), plus any clips.
- **Change:** the rows become:
  - الخزانات (list)
  - مادة التعقيم (from settings)
  - الكلور المتبقي (only if the crew entered it)
  - "نُفّذ بواسطة: شركة زلال"
  - The الفريق row is removed.
- التنظيف الجاي = completion date + the interval setting. A reminder is scheduled.
- Download downloads the stored PDF. مشاركة uses the native share sheet with the public verification link (N15).
- Rating: stars, company tags and an optional comment; skippable; read-only after sending. 3 stars or fewer automatically opens a ticket and posts a chat message.
- **Built (Phase 4, task 2):** route `/orders/[id]/certificate`, open once the order is completed (other statuses go to Tracking, Job progress or Order details). Back goes to Order details. Each tile shows the first "قبل" / "بعد" photo with "+N" for more and opens all photos of its kind in the `Lightbox`; a kind with no photos says "ما اكو صور" (photos are optional). Clips play below the tiles. The tanks row lists each line ("خزان سطح · 1,000–2,000 × 2"). "نذكّرك" shows only while the customer has reminders on. The download button sends the browser to `/orders/[id]/certificate/pdf`, which makes the PDF first if it is missing and answers with a one-hour signed link that downloads `ZL-1024.pdf`; if the PDF can't be made, Report says so. مشاركة opens the share sheet with the N15 link, or copies it where there is none. Rating: five stars (radio buttons), the tags وصلوا بالوقت / شغل نظيف / تعامل محترم / **الصور واضحة** (the canvas's "الفيديو واضح": v1 has photos and clips, not video; settled Oct 26, 2026), and an optional comment of up to 500 characters (not in the canvas). "أرسل التقييم" waits for a star. After sending, the card shows the stars, the picked tags and the comment read-only, "شكراً على تقييمك", and the ticket number when one was opened. The chat message comes from Chat (Phase 5, task 1): every new ticket posts "فتحنا بلاغ ZL-T-1001 على طلب #1024…" in the customer's thread. "عندك ملاحظة أو مشكلة؟ بلّغنا" opens the Issue report about the order (Phase 5, task 2).

### 5.16 Chat — `Chat.dc.html`

- One thread per customer, answered from the admin inbox.
- **Change:** the header subtitle follows working hours. Inside hours: "نرد عادة خلال دقائق". Outside hours: "نرد بأوقات الدوام \[9 ص– 9 م\]". Off-hours messages get one automatic reply.
- Quick topics تغيير موعد / إلغاء طلب open an order picker. The message is tagged with that order and includes in-app action buttons when the 2-hour rule still allows the change. استفسار عن سعر and شكوى send directly.
- Attachments use the same limits as Upload. Message states: sending, sent, read by support (✓✓), failed with retry. Unread agent messages badge the tab icon.
- **Built (Phase 5, task 1):** route `/chat`. The canvas's "متصلين · نرد عادة خلال 5 دقائق" becomes "نرد عادة خلال دقائق" (green) inside hours and "نرد بأوقات الدوام 9 ص–9 م" (grey) outside, by `support_is_open()` (settled Oct 26, 2026: "متصلين" would claim someone is online, which nothing tracks). The call button shows once `company_phone` is set. Back goes to Home, or to the order with `?order=`.
  - Messages: the newest 50, "رسائل أقدم" for 50 more; day chips اليوم / أمس / the date (Baghdad); live through Realtime (inserts and read receipts). The customer's own messages show a clock while sending (or the upload's %), ✓ when sent, ✓✓ once support read them, and "أعد المحاولة" when they failed (the same client id, so a retry never posts twice). Opening Chat (and every new answer while it is on screen) marks support's messages read. With no messages, the canvas's first bubble "هلا بيك! شلون نكدر نساعدك اليوم؟" is shown as a welcome (not stored).
  - Files: one photo or video per message, with whatever is typed as its caption (settled Oct 26, 2026); Upload's checks (photos shrunk to 1600 px, videos up to 60 s and 100 MB) and TUS upload to `chat-media/<user id>/`, then sent. Photos open full screen; videos play in place.
  - Quick topics: استفسار عن سعر and شكوى send "عندي استفسار عن سعر" / "عندي شكوى" at once. تغيير موعد and إلغاء طلب open a sheet listing the customer's pending and confirmed orders (inside the cutoff too: the message then asks support) and send "أريد أغير موعد طلب #1024" / "أريد ألغي طلب #1024", tagged with it. While the 2-hour rule allows (server clock when Chat loads; `transition_order` checks again), that message carries "غيّر الموعد" (N7) or "ألغِ الطلب" (N6).
  - `?order=<id>` (مساعدة on Orders, N4's help card, Tracking's and Job progress's chat buttons, N6/N7's "افتح المحادثة") shows "عن طلب #1024 ×" above the box; the next message carries the tag.
  - System messages, written by the database: the no-show message (§6), the ticket message (a rating of 3 stars or fewer; the Issue report in Phase 5, task 2) and the off-hours automatic reply (`settings.support_response_text`, one per off-hours stretch: none if one was sent since hours last closed or support last answered).
  - 20 messages a minute per sender (`ZL027`, "رسائل كثيرة بوقت قصير").

### 5.17 Issue report — `Issue.dc.html`

- Categories as designed. The related order lists the user's orders from the last 90 days plus "بدون طلب". Description is required (at least 10 characters). Up to 3 files.
- Submitting creates ticket `ZL-T-####`, shows the success state as designed, and posts a system message in Chat. The promised response time is a setting.
- **Built (Phase 5, task 2):** route `/issue` (login required), `?order=<id>` picks the order (Report's "بلّغنا"). Back goes to Order details when an order is tagged, otherwise Home.
  - The subtitle is "نرد عليك خلال ساعة بأوقات الدوام" with the hours from `settings.ticket_response_hours` (1–72, default 1, edited in A13; plural forms in ar.json; settled Oct 27, 2026). `support_response_text` stays Chat's automatic reply.
  - No category is picked at first (the canvas's selected tile is sample state); sending without one says "اختار نوع المشكلة". The order select lists the customer's orders whose slot is at most 90 days ago or still ahead, any status, newest first, as "#1024 · اليوم · خزان سطح" (اليوم / أمس / باجر or the date; "+1" for more lines), then "بدون طلب"; the newest is selected, or the tagged one (settled Oct 27, 2026). Description 10–1,000 characters.
  - Files: up to 3, Upload's checks (photos shrunk to 1600 px, videos up to 60 s and 100 MB), uploaded at once over TUS to `ticket-media/<user id>/`, each a 64 px tile (a photo shows itself, a video the canvas's play tile) with its progress, retry and ×. Sending waits for the uploads; a failed one must be retried or removed.
  - `create_ticket` makes the ticket; a retry after a lost answer returns the same one. 5 reports an hour (`ZL029`, "بلّغت كثير بوقت قصير…").
  - Success: the canvas's state with the number; "افتح المحادثة" opens Chat, where the ticket's message reads "وصلنا بلاغك ZL-T-1001 عن طلب #1024. موظف الدعم راح يراسلك هنا." (a rating's ticket keeps "فتحنا بلاغ…").

### 5.18 Tab bar — `TabBar.dc.html`

- Tabs: الرئيسية / طلباتي / احجز (center, opens Booking) / المحادثة (unread badge) / حسابي. Tips and Notifications keep Home highlighted.
- Built (Phase 5, task 1): the badge is the canvas's amber dot, from the customer's `chat_threads.customer_unread`, live through Realtime on Home, Orders and Profile (`CustomerTabBar`).

### New screens (not in the canvas; build in the same visual language)

| # | Screen | Entry | Content and rules |
| --- | --- | --- | --- |
| N1 | Name | After OTP, new users | One field "اسمك", 2–40 characters, required. Spaces are trimmed and collapsed. No back button: the user is already logged in |
| N2 | Address list / picker (sheet) | Home header, Booking, Profile | Label, district, landmark; select, edit, delete (blocked while an active order uses it, from Phase 2), add (opens Location; hidden at three addresses), mark default. Delete asks first and also removes the address's tanks |
| N3 | My tanks | Profile | Grouped by address: type, size, optional nickname (up to 30 characters), last cleaned, next due (last cleaned + `cleaning_interval_months`); add, edit, delete. Add and edit use a sheet with Booking's type and size tiles; a tank stays on its address |
| N4 | Order details | Orders, Home card, notifications | Status timeline, summary, price, attachments; buttons by status: cancel, reschedule, track, progress, certificate, help. Route `/orders/[id]`. The timeline says who acted (you, the company, the crew) and never shows staff notes. Track and progress link to Tracking and Job progress (Phase 4, task 1: on the way, then from arrival); once completed, "الشهادة" (Report) and "صور ومقاطع الشغل" (Phase 4, task 2); help is a card at the end, "عندك سؤال عن هذا الطلب؟", that opens Chat tagged with the order (Phase 5, task 1). Live through Realtime. Phase 6, task 4: once the order closed more than 90 days ago (plus the night the purge needs), المرفقات, when files remain, says "نحذف فيديوهات الطلب بعد 90 يوم من انتهائه." (booking videos are deleted then, §7 Storage) |
| N5 | Booking success | After checkout | "وصلنا طلبك #1024 · بانتظار تأكيد الشركة", with the day and slot; a soft push-permission card (Phase 5, with Web Push: settled Oct 25, 2026; built in task 3, §9.2); buttons to Order details and Home. Route `/book/done/[id]` |
| N6 | Cancel sheet | N4, Chat | Reason (تغيرت ظروفي / الموعد ما يناسبني / شي ثاني) + confirm. Within 2 h: blocked, "راسلنا بالمحادثة" (by the server clock when N4 loads, and again from `ZL006` if the cutoff passes while the sheet is open), with "افتح المحادثة" (Chat tagged with the order). From Chat it opens under the customer's own إلغاء طلب message |
| N7 | Reschedule sheet | N4, Chat | Date + slot picker with the same rules as Booking; the order goes back to `pending_confirmation`; blocked within 2 h. Uses Booking's day and slot chips (`DaySlotPicker`); the current slot is shown but can't be picked. Blocked shows "افتح المحادثة" like N6. From Chat it opens under the customer's own تغيير موعد message |
| N8 | Subscription | Home, Profile | Plan card: price and contents from settings (2 cleanings a year + reminders). "اطلب الاشتراك" creates a request; then a status view (requested / active / expired). Built (Phase 6, task 2): `/subscription`, guests too ("اطلب الاشتراك" goes through login). One subscription per address (settled Oct 28, 2026): `?address=` picks it, else Home's chosen address, with chips when there are several; without an address, "ضيف عنوان". The plan card (intro, price "بالسنة", visits, tanks, reminders, a certificate each visit, and how it's paid: cash, arranged after the request), "اطلب الاشتراك"; without a price set in A13, "الاشتراك قريباً" and no button. Requested: "طلبك قيد المراجعة" with the date and "راسلنا". Running: the Profile card, the period, the next covered order (to N4), "احجز زيارة", and from 30 days before the end "جدّد الاشتراك". Expired, declined or cancelled: a note, the plan and the request button again. Back goes to Profile (Home for guests); no tab bar |
| N9 | Article | Home, Tips | Cover, category, read time, rendered body, CTA "احجز تنظيف". Built (Phase 6, task 1): `/tips/[slug]`, guests too, published articles only (admins included; a draft or unknown slug shows "ما لكينا هذا المقال" with a link to Tips). The cover, or the category's icon on a soft aqua block when there is none; category · read time, title (also the page title; the body's first paragraph, cut to 160 characters, is the meta description), publish date, the Markdown body (`MarkdownText`), and "احجز تنظيف" in a footer (guests go through login). Back goes to Tips; no tab bar |
| N10 | Edit profile | Profile | Name; "تغيير الرقم" runs OTP on the new number. Built (Phase 6, task 3): `/profile/edit`, the name with N1's rules, and the phone with "تغيير الرقم" (`/profile/phone`): step 1 sends a code to the current number, step 2 asks for the new number (refused while another account holds it, "same number" too) and sends it a code; both are typed on OTP's screen (`/profile/phone/verify`; "تغيير الرقم" there only for the new number). The steps live in a signed, user-bound cookie (15 min), so a client can't skip step 1. Success returns to N10 with "تغيّر رقمك". Someone who lost the old number makes a new account (no admin tool in v1). No tab bar |
| N11 | My reports | Profile | Tickets with status مفتوح / قيد المعالجة / مغلق and a detail view; replies come in Chat. Built (Phase 5, task 2): `/reports` from Profile's "بلاغاتي" row (which counts the tickets not closed), newest first, each card with the number, date, category (or "من تقييمك · 2 من 5" for a rating's ticket), order and status, live through Realtime; empty state with "بلّغ عن مشكلة" (also in the header). `/reports/[id]`: the status, category, order (to N4), the customer's description and files (photos in the lightbox, clips inline), "الردود توصلك بالمحادثة." and "افتح المحادثة". Staff notes never show |
| N12 | Certificates | Home, Profile | One card per completed order → Report. Built (Phase 6, task 3): `/profile/certificates`, newest first: "شهادة ZL-1024", the service date, district and tanks, and "التنظيف الجاي" (month); the whole card opens Report. Empty state "ماكو شهادات بعد" with "احجز تنظيف". Profile's row shows the count |
| N13 | Settings | Profile | Language (Arabic, disabled), Terms, Privacy, delete account (confirm dialog → soft delete and anonymize personal data). Built (Phase 6, task 3): `/profile/settings`: "اللغة · العربية" (disabled, "لغات ثانية قريباً"), Terms and Privacy (`?from=settings`, so Back returns here), "سجّل خروج من كل الأجهزة" (a sheet; every session's refresh token ends and every browser's push subscription is deleted at once, while other devices' current access token lasts until it expires, up to an hour), "احذف حسابي" (a sheet saying what goes and what stays, then "متأكد؟"; with an open order it says to cancel first, or ask in Chat inside the cutoff, and links to Orders), and the app version. After either, Welcome loads as a full page |
| N14 | Terms / Privacy | Login, Settings | Markdown from settings; placeholder text at launch. Built (Phase 6, task 3): `/terms` and `/privacy` render `terms_md` / `privacy_md` through `MarkdownText`; while empty, a short placeholder from ar.json with the company phone when set (settled Oct 28, 2026: nothing is written to the database). Back goes to Settings with `?from=settings`, else Login |
| N15 | Public certificate page `/c/[code]` | Share link, QR on PDF | No login. Certificate number, date, tank type/size, district, "شهادة صادرة من شركة زلال"; no name or phone. Built (Phase 4, task 2) on `public_certificate(code)`: the code is read without case; an unknown code, or an order no longer completed, shows "ما لكينا هذه الشهادة". The disclaimer from §10.1 and a link to the app. Not indexed by search engines |
| N16 | Out of area / force update / maintenance | System | Full-screen states with a support phone. Built (Phase 6, task 3; settled Oct 28, 2026), each with the company phones, `settings.company_phone` and `company_phone_2` (tap to call, each hidden while unset): **out of area** when a new user's first pin (Location in onboarding) is refused (`ZL001`), with "غيّر الموقع" back to the map (later addresses keep the inline message); **maintenance** while A13's switch is on: `proxy.ts` (reading the switch at most every 10 s per server) shows it at the customer's own URL for customers and guests, with "حاول مرة ثانية"; staff surfaces, Login, Terms, Privacy, the certificate print page and N15 stay open; nothing is refused in the database; **force update** on every surface but the dashboard and the certificate print page: the build's `package.json` version (`NEXT_PUBLIC_APP_VERSION`) below `min_app_version`, checked on load and whenever the app returns to the foreground, covers the app with "حدّث التطبيق", which fetches the new service worker, waits for it to take over and reloads |

## 6. Order lifecycle

An order moves through 8 statuses. Every change goes through one Postgres function, `transition_order(order_id, to_status, payload)`. It checks who may make the change, applies the guard, writes `order_events`, and queues notifications. No client updates `orders.status` directly.

&#91;embedded content: order lifecycle · 8 statuses\]

The main path runs from booking to the certificate. Reschedule loops back to pending confirmation; the red boxes are end states.

| From → To | Who | Guard | Side effects |
| --- | --- | --- | --- |
| (new) → `pending_confirmation` | Customer | Address inside the service area; slot has capacity; uploads done | Reserve slot capacity; alert admins (dashboard sound from Phase 3, push in Phase 5) |
| `pending_confirmation` → `confirmed` | Admin | A covered order's subscription is still active, its period holds the slot date, it covers the tanks and has a visit (`ZL034` otherwise; the admin drops the coverage in A2) | Push "تأكد حجزك"; crew may be assigned now or later |
| `pending_confirmation` or `confirmed` → `pending_confirmation` (reschedule) | Customer (≥ 2 h before slot start), Admin (any time) | New slot has capacity | Release the old slot, reserve the new one; push to admins |
| `pending_confirmation` or `confirmed` → `cancelled` | Customer (≥ 2 h before slot start, reason required), Admin (any time, reason required) | — | Release slot; push to the other side |
| `confirmed` → `on_the_way` | Crew | A crew is assigned | Push "الفريق طلع لبيتك"; crew GPS sharing starts |
| `on_the_way` → `arrived` | Crew | — | Push "الفريق وصل"; GPS sharing stops |
| `arrived` → `in_progress` | Crew | — (photos are optional) | In-app update |
| `in_progress` → `completed` | Crew | Cash collected ticked (none for a covered order, which records no cash); the C4 sterilant (2–120 characters). Optional: residual chlorine (0–10 mg/L, one decimal) and an internal note | Save the C4 fields to `job_reports` (the note to `order_event_notes`); issue certificate + PDF; update `tanks.last_cleaned_at`; schedule reminder; use a subscription visit (the completed order counts as used); push "شهادتك جاهزة". Phase 4: the certificate is issued in the same transaction (any move to completed, overrides too) and its PDF is made right after the crew's answer; the reminder date is `certificates.next_due_on`, which the Phase 5 reminder cron reads |
| `confirmed`, `on_the_way` or `arrived` → `no_show` | Crew or Admin | Note required | Chat system message to the customer (Phase 5, task 1: a trigger on `order_events`; the note stays internal) |
| Any → any | Admin override | Reason required | Logged as an override in `order_events` |

Rules:

- "2 hours before" is measured from the slot start in `Asia/Baghdad` time, computed on the server (`cancel_cutoff_hours`). At exactly 2 h a change is still allowed. The same cutoff applies to a new booking: a slot can be booked only if it starts at least 2 h from now (settled Oct 25, 2026).
- The booking window is today (Baghdad) plus the next 13 days (`booking_window_days` = 14, today included; settled Oct 25, 2026).
- Slot capacity is held in `slot_bookings` with a unique key (`service_date`, `slot_id`, `seat`), so two customers cannot take the last place at once. Bookings for one slot and day also queue on a transaction lock, so a lowered capacity is respected too (`tests/integration/booking-capacity.test.ts`).
- Reschedule keeps the assigned crew; the admin can change it when confirming again. A no-show keeps its place. An admin override out of `cancelled` takes a place again and fails if the slot is full.
- Error codes the app maps to messages: `ZL004` slot not bookable, `ZL005` slot full ("الموعد انحجز، اختار موعد ثاني"), `ZL006` too late to change (N6/N7 "راسلنا بالمحادثة"), `ZL010` move not allowed, `ZL011` a requirement is missing (cash, reason, crew). The full list is in `supabase/CLAUDE.md`.
- Phase 2 builds `transition_order` with every move in the table and its checks. The side effects that need later tables are added by their phases: certificate and PDF (Phase 4, built), notifications and push (Phase 5), subscription coverage and visits (Phase 6, task 2, migration `subscriptions`). Completion already sets `tanks.last_cleaned_at`.
- Subscription orders (Phase 6, task 2; settled Oct 28, 2026): a visit is used only by a completed order; an open one (pending through in progress) holds one, so no more orders can be covered than visits left; a no-show or a cancel uses none, and an override out of completed gives it back. A customer can't reschedule a covered order outside its subscription's period, or keep it on one that ended (`ZL034`, N7 "لازم يبقى موعده ضمن فترة الاشتراك"); staff can, and confirming checks again. An admin override that brings a covered order back from cancelled or no-show checks coverage too (`ZL034`; RLS audit).
- Rating is separate from status. A completed order can be rated once, any time later (`rate_order`, §7).

## 7. Data model

All tables live in Postgres with RLS on. Money is stored as integer IQD. Times are `timestamptz`, shown in `Asia/Baghdad`. Orders snapshot the address and prices, so later edits never change history.

> **Note for Claude Code: this schema is a starting point, not a contract.** The tables below show what data v1 needs and roughly how it fits together. Don't copy them column for column. Claude Code owns the final schema design: table and column names, types, enums vs lookup tables, normalization, keys, constraints, indexes and how RLS is structured. Where you see a better design (safer, simpler, faster, or easier to secure with RLS), use it.
>
> What must not change is the behavior this spec describes: the order lifecycle and its guards (section 6), the "one function changes order status" rule, slot capacity that cannot be overbooked, price and address snapshots on orders, integer IQD, RLS on every table, and the access rules below. When you depart from this table, say why in the migration (a short SQL comment) and in the PR description, then update this section so the spec matches the database.

| Table | Key columns | Notes |
| --- | --- | --- |
| `profiles` | `id` (= `auth.users.id`), `role` (`app_role`: customer \| crew \| admin), `full_name` (null until N1), `phone` (E.164 copy of the Auth phone; null only for a deleted account), `reminders_enabled`, `deleted_at` | Created by a trigger on signup; the phone check refuses any non-07X signup. Users edit only `full_name` and `reminders_enabled`. Departure (migration `account_deletion`): `phone` is nullable with the check `phone is not null or deleted_at is not null`, so a deleted account keeps no number and the number can sign up again |
| `crews` | `id`, `name` ("فريق 1", unique), `user_id` (unique, must be a crew-role account), `active` | One login per crew. Created in Phase 2 because `transition_order` needs it; written by the A10 RPCs (Phase 3, part C), which also copy the name to the crew account's `profiles.full_name`. `private.current_crew_id()` names the caller's crew while it is active and the account is still a crew |
| `service_areas` | `id`, `name`, `area` (geography MultiPolygon), `active` | A placeholder Karbala area comes from a migration (`default_service_area`), so every environment has one: the city with Al-Hurr, Al-Hussainiya, the Karbala–Hindiya road and Hindiya, plus Ain al-Tamr as a second part. Edited in admin (A13) through `admin_save_service_area`; switched off, never deleted, and at least one stays active (`ZL017`). `in_service_area(lat, lng)` checks a point against the active areas |
| `addresses` | `id`, `user_id`, `label` (home \| family \| work), `district` (free text), `landmark`, `lat`, `lng`, `location` (point generated from lat/lng), `is_default`, `deleted_at` | Pin must be in an active service area (error `ZL001`). Unique (`user_id`, `label`) and one default among live rows. Soft delete through `delete_address()`, which also removes the address's tanks |
| `tanks` | `id`, `user_id`, `address_id`, `type` (roof \| ground), `size` (s \| m \| l), `nickname`, `last_cleaned_at` | Foreign key on (`address_id`, `user_id`), so a tank sits only on its owner's address. `last_cleaned_at` is set only by order completion |
| `price_list` | `tank_type`, `size`, `price_iqd`, `updated_at` | Primary key (type, size); 6 rows from migration `booking_catalog`. No `updated_by`: `admin_audit_log` records who changed a price. Everyone reads it, guests too. Admins change it with `admin_update_prices` (A8) |
| `slots` | `id`, `start_time`, `end_time` (Baghdad), `capacity` 1–20, `weekdays` smallint\[\] (0 = Sunday), `active` | No `label`: the app builds "8–10 الصبح" from the times. Unique (`start_time`, `end_time`). Switched off, never deleted. The times are fixed once a slot exists (orders copy them; settled Oct 26, 2026): to move a slot, add a new one and switch the old one off. Three seeded by migration (8–10, 10–12, 16–18; 2 places; Sat–Thu). Everyone reads active slots |
| `blocked_dates` | `date`, `reason` | Holidays such as Arbaeen and Ashura. Admins read it; customers see its effect through `booking_availability()` |
| `slot_bookings` | `service_date`, `slot_id`, `seat`, `order_id` (unique) | Primary key (`service_date`, `slot_id`, `seat`). One row per order holding a place; cancelled orders hold none. "Seat ≤ capacity" is checked by the booking functions, not a constraint, so a lowered capacity never breaks existing bookings. Admin-only |
| `orders` | `id`, `number` (identity from 1001, shown as #1024), `customer_id`, `address_id` + copy (`district`, `landmark`, `lat`, `lng`, generated `location`), `service_date`, `slot_id`, `slot_start_at`, `slot_end_at`, `status` (`order_status`), `crew_id`, `total_iqd`, `payment_method` (`cash`), `cash_collected`, `customer_note` (≤ 500), `client_request_id` | `client_request_id` makes `create_order` retry-safe (unique per customer). No `cancel_reason` (it is on the cancel event). `subscription_id` (Phase 6, task 2): the subscription the order uses, foreign key (`subscription_id`, `address_id`) → `subscriptions`, so only its own address's; null for a cash order. Departure: no `uses_subscription` column (it is `subscription_id is not null`). In the Realtime publication |
| `order_items` | `order_id`, `tank_id` (set null if the tank is deleted), `tank_type`, `size`, `qty`, `unit_price_iqd` | Price snapshot. A new tank line is saved to the address as one tank; `qty` stays on the line (settled Oct 25, 2026) |
| `order_events` | `order_id`, `from_status` (null for the booking), `to_status`, `actor_id`, `actor_role`, `cancel_reason` (`plans_changed` \| `time_unsuitable` \| `other`, the N6 choice), `is_override`, `details` (old and new slot of a reschedule; `cash_collected` on completion), `created_at` | Audit trail and timeline; written only by the order functions. No free-text reason: staff reasons are internal notes (next row) |
| `order_event_notes` | `event_id` (key), `order_id`, `note` (≤ 500), `created_at` | The reason staff give with an event: an admin's cancel reason, a no-show note, an override reason. Internal (settled Oct 25, 2026): admins and the assigned crew read them, the customer never does. Foreign key (`event_id`, `order_id`) → `order_events`. Its own table because RLS can't hide one column from customers while staff read it |
| `order_media` | `id`, `order_id`, `kind` (customer \| before \| after \| clip), `media_type` (photo \| video), `path` (unique object name in `order-media`), `duration_s` (videos only, ≤ 60), `bytes`, `uploaded_by` | `media_type` and `bytes` come from Storage when `create_order` (customer files) or `attach_job_media` (the crew's, Phase 3, migration `crew_job_media`) attaches a file. In the Realtime publication (Job progress, migration `live_job`); screens subscribe to inserts only |
| `job_reports` | `order_id` (PK), `crew_id`, `sterilant` (2–120), `residual_chlorine_mg_l` (numeric(3,1), 0–10, nullable), `created_at`, `updated_at` | The C4 form, written only by `transition_order`'s crew completion (completing again after an override replaces it). Read with its order (customer, assigned crew, admins). Phase 4 copies it onto `certificates`. Departure: §7 had these only on certificates; they are recorded at completion now, and the crew's note is not a column but an internal note on the completion event (settled Oct 26, 2026) |
| `crew_live_location` | `id` (PK), `order_id` (unique), `crew_id`, `lat`, `lng`, generated `location`, `accuracy_m`, `updated_at` (server time) | One row per order, written only by `share_crew_location` (migration `live_job`). Departures: its own `id` key, because Realtime sends a DELETE event's primary key to every subscriber without RLS, so an `order_id` key would leak other customers' order ids (RLS audit); `lat`/`lng` with a generated point, as on `addresses`. Read by the customer only while the order is on the way and from the crew now assigned; by the assigned crew; by admins. Not deleted on arrival (the policy hides it); a nightly job (`purge-live-locations`, 00:27 UTC) deletes rows of orders no longer on the way 24 h after their last update (settled Oct 26, 2026). In the Realtime publication |
| `certificates` | `id`, `order_id` (unique), `public_code` (8 characters from 32, no 0, 1, I or O), `issued_at`, `sterilant` (nullable), `residual_chlorine_mg_l` (nullable), `next_due_on` (date), `pdf_path` (`<id>/<version>.pdf`, unique) | Issued by `transition_order` on every move to completed (`private.issue_certificate`, migration `certificates`), copying the sterilant and chlorine from `job_reports`; an override with no report takes `settings.sterilant_text`. `next_due_on` = the Baghdad completion date + `cleaning_interval_months`. Completing again keeps the id and code (a printed QR stays valid), refreshes the data and clears `pdf_path`. The server sets `pdf_path` once the PDF is stored. Read by the customer while the order is completed, and admins; never crews (the PDF has the customer's name). Guests use `public_certificate(code)`. Departures: no `number` column (the certificate number is the order's, ZL-1024); `next_due_on` is a date; `sterilant` nullable for an override with no sterilant anywhere |
| `ratings` | `order_id` (PK), `stars` 1–5, `tags` `rating_tag`\[\] (`on_time`, `clean_work`, `respectful`, `clear_photos`; no nulls), `comment` (≤ 500), `ticket_id` (unique), `created_at` | Written only by `rate_order(order_id, stars, tags, comment)`: the customer, their own completed order, once (`ZL025` rating_not_allowed, `ZL026` already_rated; someone else's order `P0002`; staff `42501`); repeated tags are dropped. ≤ 3 stars opens a ticket in the same transaction and returns its number. Read by the order's customer and admins. Departures: keyed by order; `ticket_id` links the ticket it opened; tags are an enum |
| `tickets` | `id`, `number` (from 1001, shown ZL-T-1001), `user_id`, `order_id` (the customer's own, foreign key (`order_id`, `user_id`) → `orders` (`id`, `customer_id`)), `category` (`ticket_category`: leak, smell, late, staff, payment, other), `description` (10–1000), `status` (open \| in\_progress \| closed), `source` (app \| rating), `client_id` (unique per customer), `created_at`, `updated_at` | Rating tickets (an order, no category or description) come from `rate_order`; app tickets (a category and a description, check) from `create_ticket` (Phase 5, task 2, migration `tickets_app`). Read by the customer and admins; no direct writes; admins change the status with `admin_set_ticket_status`. Every new ticket posts a chat message to its customer (Phase 5, task 1, trigger `tickets_chat_message`); `unique (id, user_id)` lets messages reference a ticket of their own customer. In the Realtime publication (N11, A1, A5; the key is a uuid and tickets are never deleted). Departure: `client_id` makes a retried Issue report return the first ticket |
| `ticket_media` | `id` (uuid), `ticket_id`, `user_id`, `media_type` (photo \| video), `path` (unique object name in `ticket-media`), `bytes`, `duration_s` (videos only, ≤ 60), `created_at` | The Issue report's files (up to 3), written only by `create_ticket`, which takes type and size from Storage. Read by the ticket's customer and admins. Departures: an id key; `user_id` with the foreign key (`ticket_id`, `user_id`) → `tickets`, so a file stays on its owner's ticket; `bytes` and `duration_s` as on `order_media` |
| `ticket_notes` | `id` (identity), `ticket_id`, `author_id`, `note` (1–1,000), `created_at` | A5's internal notes, a list that is never edited, written only by `admin_add_ticket_note`. Admins read them; the customer never does. New (not in the earlier draft): its own table because RLS can't hide a column of `tickets` from the customer, as `order_event_notes` |
| `chat_threads` | `id` (uuid), `user_id` (unique; the customer), `last_message_at` (null until the first message), `customer_unread`, `admin_unread`, `created_at` | One per customer, made by `chat_thread()`, the first message or a system message (migration `chat`). A trigger on new messages moves `last_message_at` and adds one to the other side's count; `mark_chat_read` recounts. Read by its customer and admins. In the Realtime publication. Departures: no `assigned_admin_id` (support agents are all admins in v1 and A4 has no assignment); the counts are named by who hasn't read |
| `chat_messages` | `id` (uuid), `thread_id`, `customer_id` (the thread's customer), `author` (`chat_author`: customer \| admin \| system), `sender_id` (null for system), `kind` (`chat_message_kind`: message \| auto_reply \| no_show \| ticket), `body` (≤ 2,000), one file (`media_path` unique, `media_type`, `duration_s` ≤ 60, `bytes`), `order_id` (tag), `topic` (`chat_topic`: reschedule \| cancel \| price \| complaint), `ticket_id`, `client_id` (unique per sender), `read_at`, `created_at` (clock time) | Written only by `send_chat_message` and the system triggers; foreign keys (`thread_id`, `customer_id`), (`order_id`, `customer_id`) and (`ticket_id`, `customer_id`) keep every tag the thread customer's own. Read by the thread's customer and admins. In the Realtime publication (screens use INSERT and UPDATE only; keys are uuids because DELETE events skip RLS). Departures: a file is a field, not a kind (a file can carry a caption, as in the canvas); system messages name their event (`no_show`, `ticket`) and the app writes their words from ar.json, while the automatic reply stores its text; `customer_id`, `topic`, `client_id` and `ticket_id` are new |
| `notifications` | `id` (uuid), `user_id`, `type` (`notification_type`, §9.2), `data` (jsonb: the values the words need), `order_id`, `ticket_id`, `read_at`, `created_at`, `audience` (generated from the type: customer \| admin \| crew) | One row per event per person, written only by the triggers and the reminder job (migration `notifications`, Phase 5, task 3). The customer's list (§5.7) and every push (except `work_started`) come from it. Read by its user while they hold the row's role (a removed admin or a switched-off crew stops reading staff rows, which copy customers' messages and orders; RLS audit); read marks only through `mark_notification_read(id)` / `mark_all_notifications_read()`. In the Realtime publication. Deleted after 90 days. Departures: no `title`, `body` or `link`: the app writes the words from ar.json (`Notifications.items`, no Arabic stored, as for chat system messages) and the link from `routes`; `data`, `order_id`, `ticket_id` and `audience` are new; admins and crews get rows too (their push), with no list screen in v1 |
| `push_subscriptions` | `id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, `user_agent` (≤ 300), `created_at`, `saved_at` | One row per browser that allowed push. No API access: `save_push_subscription(endpoint, p256dh, auth, user_agent)` (any logged-in role; https endpoints of the browsers' push services only, `22023` `invalid_endpoint` / `invalid_keys`; an endpoint already stored moves to the caller, since the browser now belongs to whoever is logged in; at most 10 per user) and `delete_push_subscription(endpoint)` (logout, the caller's own). `send-push` reads it with the service key and deletes endpoints that answer 404 or 410. Departure: `saved_at` (clock time of the last save, for the limit) instead of an `updated_at` trigger |
| `cleaning_reminders` | `certificate_id`, `due_on`, `kind` (`week` \| `due`), `created_at` | New: the reminders sent, one per certificate, due date and kind, so none goes twice and a re-issued certificate with a new date gets its own. No API access |
| `subscriptions` | `id` (uuid), `user_id`, `address_id`, `status` (`subscription_status`: requested \| active \| declined \| cancelled), `requested_at`, `price_iqd`, `visits_total` (1–12), `tanks_covered` (1–6), `starts_on`, `ends_on` (start + 12 months − 1 day, check), `visits_adjustment`, `paid`, `activated_at`, `ended_at`, `expiry_notified_on`, `created_at`, `updated_at` | Migration `subscriptions` (Phase 6, task 2). One per address (settled Oct 28, 2026): foreign key (`address_id`, `user_id`) → `addresses`; one request per address (partial unique index); two active ones on an address never overlap (exclusion constraint, `btree_gist`). The customer reads their own, admins all; no direct writes (the RPCs below). In the Realtime publication (uuid key). `subscription_overview` (security invoker view) adds the state (requested, upcoming, active, expired, declined, cancelled), visits used, held and left, the next covered order, the last covered visit, the address and the customer's name and phone. Departures: `address_id` is new; no stored `expired` (an active row past `ends_on` in Baghdad is expired, so nothing goes stale at midnight); `declined` is new (a refused request); no `visits_used` counter (used = completed orders on it + `visits_adjustment`, held = open orders); no `admin_note` (notes are a list in `subscription_notes`, as RLS can't hide one column); `requested_at`, `activated_at`, `ended_at`, `expiry_notified_on` are new |
| `subscription_notes` | `id` (identity), `subscription_id`, `author_id`, `note` (1–1,000), `created_at` | A7's internal notes (and the reasons of activations, adjustments, declines and cancels), written only by the A7 RPCs. Admins read them; the customer never does. New, as `ticket_notes` |
| `article_categories` | `id` (identity), `name` (2–30, unique), `icon` (`category_icon`: droplet, sun, lid, lightbulb, help, shield), `sort`, `created_at`, `updated_at` | Migration `articles` (Phase 6, task 1). Read by everyone, guests included; no direct writes. The four §10.2 categories come from the migration. Departure: `icon` is new, for the canvas's icon tiles on Tips (settled Oct 28, 2026) |
| `articles` | `id` (uuid), `slug` (Latin a-z, 0-9 and single hyphens, 3–80, unique), `title` (5–120), `category_id` (restrict), `cover_path` (nullable, unique, `public-content/articles/<file>`), `body_md` (≤ 20,000), `read_minutes` (generated: words ÷ 150, rounded, at least 1), `featured`, `status` (`article_status`: draft \| published), `published_at`, `created_at`, `updated_at` | Guests, customers and crews read published articles; admins read drafts too. No direct writes: the audited RPCs below. A published article has a `published_at` and a body (check). `published_at` is set on the first publish and kept when the article goes back to draft, which also fixes the slug (`ZL032`), so shared links keep working. The six §10.2 articles come from the migration as drafts. Departures: the slug is typed by the admin in Latin; `read_minutes` is computed, not typed; `created_at`, `updated_at` (settled Oct 28, 2026) |
| `settings` | One row, one typed column per setting | Settings listed below. Readable by everyone, guests included |
| `otp_requests` | `phone`, `channel` (picked), `channel_used` (after any fallback), `code_hash`, `sent_at`, `provider_message_id`, `send_error`, `failed_attempts`, `locked_until`, `verified_at`, `created_at` | One row per send. `code_hash` is an HMAC of the code keyed with a server secret; admins read every column but it. Server-only RPCs: `request_otp` (limits), `record_otp_sent` / `record_otp_send_failed`, `check_otp` (single use, 5 min, 5 wrong codes lock 15 min), `otp_locked_until`. Purged after 7 days |
| `admin_audit_log` | `admin_id`, `action` (e.g. `order.transition`), `entity`, `entity_id` (text), `diff` (jsonb), `created_at` | Every admin write, written by the RPC that makes it (`private.log_admin_action`). Admins read it; nobody writes it directly. Created in Phase 2 for `transition_order` |
| `auth.users` (Supabase Auth's) | — | Guarded by the trigger `guard_auth_user`: a password changes only inside the server-only RPC `set_login_password` (which also ends the user's sessions), otherwise `ZL002`; no new email address or pending email change (`ZL003`; a row that already has an email keeps it). So a stolen session can't add a way in (§9.1) |

Settings (columns of the one `settings` row, migration `settings`): `sms_enabled` (on), `company_phone` (E.164, set before launch), `company_phone_2` (optional second number, E.164 and never the same as the first; everywhere the company phone shows, both show; migration `company_contact`), `working_hours_start` / `working_hours_end` / `working_days` (9:00–21:00, Sat–Thu; days use 0 = Sunday … 6 = Saturday), `cleaning_interval_months` (6), `booking_window_days` (14), `cancel_cutoff_hours` (2), `max_tanks_per_order` (6), `terms_md`, `privacy_md`, `min_app_version` (x.y.z; N16's force update compares the build's version with it), `maintenance_mode` (off; N16 shows customers the maintenance screen while on). Both edited in A13's "التطبيق" (Phase 6, task 3). `sterilant_text` (empty until the owner sets it; the crew finish form C4 starts from it; migration `admin_settings`, which also caps `terms_md` and `privacy_md` at 50,000 characters). `certificate_text` (the service paragraph on every new certificate, §10.1 item 4, ≤ 800 characters; seeded with a draft for the owner to review; migration `certificates`). `support_response_text` (Chat's off-hours automatic reply, ≤ 300 characters, empty turns it off; seeded with a draft for the owner; edited in A13; migration `chat`; settled Oct 26, 2026: it is the reply's text, not a promised response time). `ticket_response_hours` (the Issue report's promised answer time, 1–72, default 1; edited in A13's "المحادثة" section; migration `tickets_app`; settled Oct 27, 2026: the words stay in ar.json, only the number is a setting). `subscription_price_iqd` (null = not offered: N8 shows "الاشتراك قريباً"; `seed.sql` sets 60,000 locally), `subscription_visits` (2, 1–12) and `subscription_tanks` (1, 1–6), edited in A13 (migration `subscriptions`; departure: three typed columns instead of the jsonb `subscription_plan`, and no description: the plan's words are in ar.json). A subscription keeps the plan it was activated with. `certificate_stamp_path` (the stamp image in public-content `stamp/`, null until uploaded; set only through the audited `admin_set_certificate_stamp`, which takes the admin's own finished upload under 48 h old, and refused by `admin_update_settings`; admins upload and delete unused stamps, and the nightly content cleanup deletes stamps over 72 h old that the settings don't use; migration `company_contact`).

Access rules (RLS):

- A customer reads and writes only their own rows. Their order rows can be written only through RPC functions.
- A crew reads orders, their lines, events, staff notes and media only for orders assigned to it, while the crew is active. It reads the address copy on the order, never the `addresses` table. It reads the customer's name and phone only through `crew_job_contact(order_id)` (Phase 3, task 2, part A, migration `crew_jobs`): the assigned crew, while the job is confirmed, on the way, arrived or in progress, never for a deleted account; other roles get `42501`, anything else `P0002`. It writes media, live location and status, all through RPC functions. Live location (migration `live_job`): `share_crew_location(order_id, lat, lng, accuracy_m)`, the assigned active crew while the order is on the way (`ZL024` location_not_allowed otherwise; another crew's order `P0002`; other roles `42501`); a call less than 10 s after the last saved position from the same crew writes nothing and returns false. Media (Phase 3, part B, migration `crew_job_media`): `attach_job_media(order_id, kind, path, duration_s)` records a finished upload from the crew's own folder for that order as a before or after photo (photos) or a clip (videos, ≤ 60 s), while the job is arrived or in progress or up to 24 h after completion (`ZL023` media_not_allowed); 10 / 10 / 4 per order (`ZL008`); a repeat returns the same row, so a retry is safe. `remove_job_media(media_id)` takes back the crew's own file while the job is arrived or in progress and returns its path, which the app then deletes through the Storage API.
- An admin reads and writes everything. Every admin write goes to `admin_audit_log`. Audited admin RPCs so far: `transition_order` (Phase 2) and `assign_crew(order_id, crew_id)` (Phase 3, part A: sets a crew while the order is pending, confirmed or on the way, removes it only while pending or confirmed; the crew must be active with a crew-role account, `ZL013`; other statuses `ZL014`; logged as `order.assign_crew` with the old and new crew, since crew changes are not status events). Phase 3, part B: `admin_update_prices(prices)` (the six cells at once; each changed cell logged as `price.update`), `admin_create_slot(start, end, capacity, weekdays)` (`ZL015` slot_exists for the same times, also against a switched-off slot) and `admin_update_slot(id, capacity, weekdays, active)` (`slot.create` / `slot.update`), `admin_block_date(date, reason)` (not before today in Baghdad) and `admin_unblock_date(date)` (`blocked_date.add` / `.update` / `.remove`), `admin_update_settings(patch)` (only the named settings; `settings.update` with the old and new value of each changed one), and `admin_save_service_area(id, name, area, active)` (GeoJSON in; `ZL016` invalid_area for a shape that isn't a valid polygon inside Iraq, at most 5,000 points; `ZL017` last_active_area; returns how many saved addresses are now outside every active area; `service_area.create` / `.update`). None of them touch orders or addresses: a lowered capacity, a switched-off slot, a dropped weekday or a blocked day leaves bookings in place, and `admin_schedule_conflicts()` lists them for the admin to reschedule. Admin reads: `admin_service_areas()` (shapes as GeoJSON) and `admin_addresses_outside_area()`. Phase 3, part C (migration `admin_staff`): the app server first makes sure an Auth account exists for the phone (Auth admin API, phone confirmed, no password; the first login sets it, §9.1), then calls, as the admin: `admin_create_crew(phone, name)` (the account must be untouched, a customer that never signed in and has no addresses, tanks or orders, so a customer's account and history never become a shared crew phone, `ZL019` phone_has_account; `ZL020` crew_name_taken; `crew.create`), `admin_update_crew(id, name, active)` (rename, switch on or off; returns the crew's open orders and never touches them: a switched-off crew loses access at once and the admin reassigns its orders in A2; `crew.update`), `admin_set_crew_phone(id, phone)` (a lost or replaced crew phone: the crew moves to another untouched account and keeps its orders, the old account becomes an unnamed customer; `crew.phone`), `admin_add_admin(phone, name)` (any customer account, which keeps its own orders and addresses, or a new one; not a crew account, `ZL021` account_is_crew; the name only when the account has none; `admin.add`) and `admin_remove_admin(user_id)` (back to customer; never yourself, `ZL022` cannot_remove_self; removals lock every admin row and check the caller again, so two admins removing each other at once can't leave none; `admin.remove`). Nobody writes `crews` or `profiles.role` directly.
- Chat (Phase 5, task 1, migration `chat`): a customer reads their own thread and its messages, admins every one; crews and guests none; nobody writes the tables. `send_chat_message(client_id, thread_id, body, media_path, duration_s, order_id, topic)`: a customer to their own thread (made on first use; another's `P0002` `thread_not_found`), an admin to any thread it names (no topic, `22023` `invalid_topic`); crews and guests `42501`. A retry with the same client id in the same thread returns the first message. Text is trimmed, ≤ 2,000; a message needs text, a file or a topic (`empty_message`); reschedule and cancel need an order (`order_required`); a tag must be the thread customer's order (`P0002` `order_not_found`). A file must be the sender's own finished upload in `chat-media/<user id>/`, ≤ 48 h old and not sent before (`ZL009`); type and size come from Storage; videos need a length of 0–60 s, photos none (`invalid_duration`). 20 messages a minute per sender (`ZL027` `too_many_messages`). A customer message outside working hours gets the automatic reply (above). `mark_chat_read(thread_id)` marks the other side's messages read and returns how many (the customer on their own thread, admins on any). `chat_thread()` (customers) returns their thread id. `admin_chat_inbox(search, limit)` (admins, `42501` otherwise) lists threads with messages, unread first, with the customer's name, phone and last message; search by name or phone digits. `support_is_open()` (everyone) says whether it is inside working hours and days (Baghdad; the end excluded). Triggers post the no-show message (`order_events`, to `no_show`) and the ticket message (`tickets`). Admin replies are not copied to `admin_audit_log`: each message names its admin and can't be changed (departure from the rule above).
- Certificates (Phase 4, migration `certificates`): `public_certificate(code)` (guests and users; security definer) returns the number, issue date, district and tanks of a completed order's certificate, nothing personal. `rate_order(order_id, stars, tags, comment)` (customers) is the only writer of `ratings` and writes the tickets of low ratings.
- Tickets (Phase 5, task 2, migration `tickets_app`): `create_ticket(client_id, category, description, order_id, media)` (customers; crews, admins and guests `42501`): a category and a description of 10–1,000 characters (trimmed, `22023` `invalid_category` / `invalid_description`); the order is optional and must be the customer's own (`P0002` `order_not_found`) with its slot no more than 90 days ago (`ZL028` `ticket_order_too_old`; upcoming orders count); up to 3 files (`ZL008`), each the customer's own finished upload in `ticket-media/<user id>/`, at most 48 h old and not attached before (`ZL009`), type and size from Storage, videos 0–60 s (`invalid_duration`); a retry with the same client id returns the first ticket; 5 app tickets an hour per customer (`ZL029` `too_many_tickets`). It returns the ticket's id and number. `admin_set_ticket_status(ticket_id, status)` (admins; any status to any other, reopening included; the same status changes and logs nothing; `ticket.status`) and `admin_add_ticket_note(ticket_id, note)` (admins; `ticket.note`); a missing ticket `P0002` `ticket_not_found`. Neither posts in Chat: support answers there by hand. `admin_rating_summary()` (admins, `42501` otherwise) counts ratings per star for A12.
- Notifications (Phase 5, task 3, migration `notifications`): triggers on `order_events`, `orders.crew_id`, `chat_messages`, `chat_threads`, `tickets` and `ratings` write the rows (§9.2); deleted accounts and switched-off crews get none. After each insert statement the new ids whose user has a subscription go to the Edge Function `send-push` (200 per request) through `private.invoke_send_push`, pg_net and the Vault secrets `project_url` and `send_push_secret` (nothing is sent without them). `private.send_cleaning_reminders(day)` (pg_cron `notifications-reminders`, 07:03 UTC) and `private.prune_notifications()` (`notifications-prune`, 01:07 UTC) run as postgres only.
- `admin_slot_board(from, to)` (admins, at most 62 days): places taken per day and slot for the A2 board and the admin reschedule picker. It lists every slot that runs that day plus any switched-off slot that still holds places, and marks blocked days. `bookable` uses staff rules (any slot that hasn't started), unlike `booking_availability()`, which applies the customer window and cutoff.
- Orders: `create_order(request_id, address_id, service_date, slot_id, items, note, media, expected_total)` (customers; `expected_total` is the total Checkout showed, and a different total at today's prices is refused with `ZL018` price_changed, so an admin's price change never bills a customer for a price they didn't see), `transition_order(order_id, to_status, payload)` (all roles, per §6) and `booking_availability()` (logged-in users: days × slots in the window with places left and whether each can be booked) are the only ways in. `delete_address` refuses while an active order uses the address (`ZL012`).
- Articles (Phase 6, task 1, migration `articles`): admins only (`42501` otherwise), each audited. `admin_save_article(id, slug, title, category_id, cover_path, body_md, featured, status)` creates (no id) or updates and returns the id and the cover it replaced or removed, which the server then deletes with the admin's own Storage client (its policy refuses a cover another article took meanwhile; RLS audit). A new cover must be the admin's own finished upload in `public-content/articles/`, at most 48 h old, used by no other article (`ZL009`); the file is locked while it is attached. `ZL031` `slug_taken`, `ZL032` `slug_locked`, `P0002` `category_not_found` / `article_not_found`. Logs `article.create` / `article.update` (only what changed; the body as its length). `admin_delete_article(id)` returns the cover path (`article.delete`). `admin_save_category(id, name, icon)` (`ZL033` `category_name_taken`; `category.create` / `.update`), `admin_delete_category(id)` (`ZL030` `category_in_use` while any article, draft or published, uses it; `category.delete`), `admin_reorder_categories(ids)` (the listed ids first, each once, `22023` `invalid_order` otherwise; a category not listed keeps its place after them; `category.reorder` with the old and new order by name).
- Subscriptions (Phase 6, task 2, migration `subscriptions`): `request_subscription(address_id)` (customers; `42501` otherwise): the caller's live address (`P0002` `address_not_found`) inside an active area (`ZL001`); refused while the plan has no price (`ZL037` `subscription_not_offered`) or while the address has an active subscription ending more than 30 days from today (`ZL035` `subscription_exists`); asking again returns the request; admins are notified. `create_order(..., p_use_subscription)` locks the address's subscription and checks it (`ZL034` `subscription_unavailable`, the reason as message: `no_subscription`, `outside_subscription_period`, `no_visits_left`, `subscription_tanks_exceeded`). Admins, each audited: `admin_activate_subscription(id, starts_on, visits, tanks, price, paid, note)` (a request only, `ZL036` `invalid_subscription_status`; start from today to a year ahead, `22023` `invalid_start`; an overlap is `ZL035`; `subscription.activate`; notifies the customer), `admin_set_subscription_paid(id, paid)` (`subscription.paid`), `admin_adjust_subscription_visits(id, delta, reason)` (adds to the visits used, never below 0 or past the total with the held ones, `22023` `invalid_adjustment`; `subscription.adjust`), `admin_end_subscription(id, reason)` (declines a request, notifying the customer, or cancels an active one that hasn't ended, whose open orders then become cash orders, each logged as `order.subscription`; `ZL011` `reason_required`; `subscription.decline` / `.cancel`), `admin_add_subscription_note(id, note)` (`subscription.note`), `admin_set_order_subscription(order_id, use)` (puts the address's subscription on a pending or confirmed order with the booking's checks, or drops an order's coverage in any status but completed, `ZL038` `subscription_change_not_allowed`; `order.subscription`). `delete_address` also refuses (`ZL012`) while the address has a request or a subscription that hasn't ended. `private.send_subscription_expiry_notices(day)` (pg_cron `subscriptions-expiring`, 07:13 UTC, 10:13 Baghdad) sends the 30-day notice once per `ends_on`, unless the address already has a renewal.
- Accounts (Phase 6, task 3, migration `account_deletion`; settled Oct 28, 2026):
  - **Account deletion:** `delete_account()` (customers, their own account; `42501` otherwise; `ZL039` `account_has_open_orders` while an order is pending … in progress) anonymizes in one transaction and returns the certificate PDF paths, which the server deletes. The profile loses its name and phone (reminders off, `deleted_at` set); the Auth user loses its phone, is banned for 100 years and its sessions, refresh tokens, identities and one-time tokens are deleted, so the same number can later sign up as a new, empty account. Addresses are soft-deleted with the landmark replaced by `-deleted-` and the pin rounded to 2 decimals (about 1 km), and their tanks deleted. Orders stay as company records (number, dates, slot, tanks, prices, cash, status, district) with the same address treatment and no note; their media rows go (the nightly cleanup deletes the files). Certificates stay without their PDF (N15 shows nothing personal; a printed QR keeps working). Ratings keep their stars and tags, without the comment. Staff notes on the customer's orders and subscriptions (free text that often holds a name or directions) are deleted. Tickets (with their files, notes and notifications), the chat thread with every message and file, notifications and push subscriptions are deleted, and so are the admins' notifications of the customer's messages, which keep an excerpt (migration `qa_retention`). The free text staff wrote about the account in `admin_audit_log` (`note` and `reason` values on rows about its orders, tickets and subscriptions) becomes null; the rest of each row stays (migration `qa_retention`, also run once for accounts deleted before it, whose ticket rows are matched by a ticket that no longer exists, since only a deletion removes tickets). `otp_requests` rows go after 7 days like everyone's. Staff phones in crew and admin audit rows are kept as staff records. A requested subscription is declined and an active one cancelled, with no notification. Staff accounts aren't deleted here (crews in A10, admins in A14).
  - After a deletion nothing new attaches to the account: insert triggers on tickets, chat, push subscriptions, ratings, addresses and tanks lock the owner's live profile, so a write racing the deletion from another tab waits and is refused (`42501`); an order of a deleted account never moves back to an open status (`P0002` `order_not_found`, an admin override); the orders and subscriptions read policies need the customer role, so a deleted account's remaining access token reads nothing (RLS audit). `check_address_service_area` skips deleted rows, so the rounded pin never fails the area check. A certificate PDF rendered during the deletion can't be recorded afterwards (`42501`; the server removes its upload). `delete_account` locks the addresses before the profile, as booking does, so a booking racing it either finishes first (then `ZL039`) or finds the address gone.
  - **Phone change:** `change_login_phone(user_id, phone)` (service role only) after the server checked codes to the current and the new number (§9.1): customers only (`42501` for staff, `P0002` `account_not_found` for unknown or deleted), `22023` `invalid_phone` / `same_phone`, `ZL040` `phone_taken`; sets `auth.users.phone` and the phone identity, and the trigger copies it to `profiles.phone`. The user stays signed in.
  - **Log out on all devices:** `delete_my_push_subscriptions()` (any logged-in role, own rows) plus Auth's global sign-out.
  - **Subscribed addresses:** the pin of an address whose subscription is requested, or active and not past its end, can't move (`ZL041` `address_subscribed`, trigger `addresses_guard_subscribed_pin`; Location says so); district and landmark stay editable.
- How it's built: every table revokes Supabase's default grants and grants only what each role needs, with column grants for server-owned columns. Policies read the role from `profiles` through `private.current_user_role()` and `private.is_admin()`, so a role change applies at once. Conventions are in `supabase/CLAUDE.md`.

Storage buckets: `order-media`, `chat-media`, `ticket-media` and `certificates` are private, with signed URLs that last 1 hour. `public-content` (article covers and the certificate stamp) is public. Each bucket also has a size cap and a file-type allow-list (migration `storage_buckets`):

| Bucket | Public | Max size | File types |
| --- | --- | --- | --- |
| `order-media`, `chat-media`, `ticket-media` | No | 100 MB | JPEG, PNG, WebP, HEIC/HEIF photos; MP4, QuickTime (.mov), WebM videos |
| `certificates` | No | 10 MB | PDF |
| `public-content` | Yes | 5 MB | JPEG, PNG, WebP |

Until a phase adds the storage policies for its bucket (with pgTAP tests), only the service role can read or write it. `public-content` (Phase 6, task 1, migration `articles`): anyone with a cover's URL loads it (public bucket); through the API only admins touch it: they upload to `articles/<file>` (never under the name of a used cover), list the bucket, and delete a cover no article uses ("used" is checked without RLS, `private.article_cover_used`). A draft's cover can be fetched by whoever has its exact URL (a random name, never listed). Covers no article uses are deleted 72 h after upload by the nightly cleanup (`unattached_media('content')`, job `media-cleanup-content` at 01:17 UTC, 04:17 Baghdad). The certificate stamp (migration `company_contact`) follows the same rules in `stamp/<file>`: admins upload it (never under the name of the stamp in use), delete a stamp the settings don't use (`private.certificate_stamp_used`), and the same job deletes unused stamps over 72 h old. `certificates` (Phase 4, migration `certificates`): only the server writes it; a PDF is read through `certificates.pdf_path` by whoever reads that certificate, so an older version in the same folder is read by nobody (the server deletes it after recording the new one). `chat-media` (Phase 5, task 1, migration `chat`): customers and admins upload to `<user id>/<file>`; a file is read by its uploader until it is sent, then by whoever reads its message; the uploader deletes it until it is sent. "Sent" is checked without RLS (`private.chat_media_sent`), so an admin who is no longer one can't delete or replace what customers were sent (RLS audit). Unsent chat files over 72 h old are deleted by the nightly cleanup (`unattached_media('chat')`, job `media-cleanup-chat` at 00:37 UTC, 03:37 Baghdad). `ticket-media` (Phase 5, task 2, migration `tickets_app`): customers upload to `<user id>/<file>`, never under the name of an attached file; a file is read by its uploader until `create_ticket` attaches it, then by whoever reads its ticket (the customer and admins); the uploader deletes it until it is attached. "Attached" is checked without RLS (`private.ticket_media_attached`), and `create_ticket` locks each file while attaching it, so a delete running at the same moment waits and then sees it attached (RLS audit). Admins and crews don't upload. Unattached ticket files over 72 h old are deleted by the nightly cleanup (`unattached_media('ticket')`, job `media-cleanup-ticket` at 00:57 UTC, 03:57 Baghdad). `order-media` (Phase 2, migration `order_media_storage`): a customer uploads to `customer/<user id>/<file>` and may delete a file there until `create_order` attaches it; an attached file is read by whoever reads its order (the customer, the assigned crew, admins). Crew uploads (Phase 3, migration `crew_job_media`): the crew uploads to `crew/<crew id>/<order id>/<file>` for an order assigned to it that is arrived or in progress, or completed less than 24 h ago; it reads its uploads there while the order is still assigned to it and deletes them until they are attached. The folder is named by the crew, not the account, so a crew moved to a new phone keeps it. Files uploaded but never booked or attached are deleted by two nightly jobs (migration `media_cleanup`, Edge Function `media-cleanup`): `customer/` files more than 72 h old (`create_order` takes uploads up to 48 h old, so a bookable file is never deleted), and `crew/` files more than 48 h old whose order no longer takes media from that crew (gone, assigned to another crew, not arrived or in progress, or completed more than 48 h ago; `attach_job_media` stops at 24 h). An open job keeps its files however long it stays open. "Unattached" means no `order_media` row has the file's path. `public.unattached_media(folder, limit)` (service role only) lists them, oldest first; the function deletes them through the Storage API, which also removes the stored file (a direct SQL delete would not). pg_cron runs `private.invoke_media_cleanup(folder)` at 00:17 and 00:47 UTC (03:17 and 03:47 Baghdad), which posts to the function through `pg_net` with the job's secret from Vault; without the Vault secrets it sends nothing (`docs/supabase-setup.md` step 8). Each run deletes up to 5,000 files (10 pages of 500, each starting after the last, in chunks of 100, about 50 s); a file Storage refuses is tried again the next night without holding back newer ones. Hosted projects on the Supabase Free plan cap every upload at 50 MB whatever the bucket says, so 50–100 MB videos fail there until the project is on Pro.

Retention and leftovers (Phase 6, task 4, migration `qa_retention`; settled Oct 28, 2026):

- **Booking videos** (`order_media` kind `customer`, type video) are deleted 90 days after the order closed (completed, cancelled or no-show, counted from the event into its current status; §11): `private.purge_expired_media()`, job `media-retention` at 00:23 UTC (03:23 Baghdad), deletes their rows, and the `customer/` cleanup deletes the files the next night. Customer photos, the crew's before and after photos and clips, and certificates are kept. Chat and ticket files stay with their thread or ticket. N4 says so on old orders.
- **Certificate PDFs** that no `certificates.pdf_path` records (a delete that failed after `delete_account`, a failed record, an older version) are deleted by the nightly cleanup once both their upload and last write are more than 24 h old (`unattached_media('certificate')`, job `media-cleanup-certificate` at 02:07 UTC, 05:07 Baghdad).
- `chat-media` (migration `qa_retention`, the same fix as `tickets_app`): `send_chat_message` locks the file while attaching it, `private.chat_media_sent` is volatile, and nobody uploads under the name of a sent file.

## 8. Crew app and admin dashboard

Neither surface has designs. Both are built from the same tokens and kit as the customer app, in Arabic RTL, plain and functional (settled Oct 25, 2026: no canvas pass). Admin is desktop-first: a sidebar on the start side from 1024px, a top bar with a scrolling row of links below that, and a wide content column.

### 8.1 Crew app (`/crew`, mobile PWA)

| # | Screen | Content and rules |
| --- | --- | --- |
| C1 | Login | Same phone + OTP. A crew-role account lands on C2 (with logout in its header); any other role is sent to its own surface |
| C2 | My jobs | Today and tomorrow, grouped by slot. An open job from an earlier day comes first, and today's completed and no-show jobs last; orders still waiting for confirmation are not listed even when a crew is assigned (settled Oct 26, 2026). The list updates through Realtime, and also when the app comes back to the screen and once a minute, since a job taken away from the crew sends it no event. Each card shows the order number, slot, district + landmark, tank lines, a customer-note preview, the customer media count and a status chip |
| C3 | Job detail | Map pin with "افتح بخرائط كوكل" (deep link), "اتصل بالزبون" (only while the job is confirmed, on the way, arrived or in progress, through `crew_job_contact`; settled Oct 26, 2026), tank lines, note, customer photos/videos, timeline |
| C3a | Status button | One large button that moves the job to its next status: طلعنا → وصلنا → بدينا الشغل → خلصنا (opens C4). No step needs a photo (settled Oct 26, 2026). A secondary action, "الزبون مو موجود", marks a no-show until work starts and needs a note, which stays internal |
| C3b | Media | Camera capture (`<input capture>`) for before photos (from وصلنا) and after photos and clips (60 s each, during work), all optional. Each file is shrunk or checked on the phone, kept in IndexedDB until it is attached, uploaded over TUS and attached with `attach_job_media`. The queue waits without signal and starts again when the phone is back online; a reload resumes each upload from its saved TUS URL. It loads only the logged-in account's files and deletes other accounts'; logout deletes every queued file on the phone (and warns first when some are unsent). The crew can take back a wrong file while the job is open. My jobs shows a job's unsent files |
| C4 | Finish form | Sterilant (prefilled from `settings.sterilant_text`, required); residual chlorine mg/L (optional, shows on the certificate only when filled); "استلمنا المبلغ \[35,000 د.ع\]" checkbox (hidden for subscription orders, which show "مشمول بالاشتراك"; Phase 6, task 2); an optional note, internal like every staff note (settled Oct 26, 2026). Submit completes the job and saves `job_reports`; files still queued keep uploading |

GPS rule for v1:

- While a job is `on_the_way`, the crew app runs `watchPosition` and sends a position at most every 15 s. It keeps the screen awake with the Wake Lock API and shows "خلي التطبيق مفتوح لحد ما توصلون".
- A PWA cannot send GPS from the background. That is the main known limitation, and the reason a native crew app may be needed later.
- Built (Phase 3, part C, with Phase 4 task 1): the sender sits in the crew layout, so it runs on every crew screen while any of the crew's jobs is on the way, with a bar on top ("خلي التطبيق مفتوح لحد ما توصلون" and its state: sharing, location off, no GPS, offline). A fix older than 60 s is never sent; when the phone reports nothing for 15 s (standing still) it asks for a fresh fix. Sending stops on arrival.

### 8.2 Admin dashboard (`/admin`, desktop-first)

| # | Screen | Content and rules |
| --- | --- | --- |
| A1 | Overview | Today's orders by status; pending confirmations (sound + push alert); unread chats; open tickets; subscription requests |
| A2 | Orders | Table with filters (status, date, district, crew) plus a date × slot board that shows capacity. The order drawer shows details, customer media, the timeline and admin notes. Actions: confirm, cancel (reason), reschedule, assign crew, verify subscription, override status (reason) |
| A3 | Live map | Crews currently on the way, with their order. Built (Phase 4, task 1): `/admin/live`, a map (Google markers with a key and Map ID, otherwise a drawing fitted to the crews over the service areas) and a list with the crew, the order (links to the A2 drawer), the place, the age of the last position ("ما ديتحدث" after 2 minutes) and the straight-line distance to the customer. Positions arrive through Realtime |
| A4 | Chat inbox | Threads sorted by last message, unread first. The conversation pane shows order tags, attachments and canned replies. A side panel shows the customer's orders, addresses, subscription and tickets |
| A5 | Tickets | List and detail; status open → in progress → closed; internal note; jump to chat |
| A6 | Customers | Search by phone or name; profile with orders, addresses, tanks, subscription and tickets. Not in v1 (settled Oct 28, 2026): A4's customer panel and A7's search cover it; a v2 candidate |
| A7 | Subscriptions | Request queue → "فعّل" (start date, end = start + 12 months, visits, tanks covered, paid tick); active list; "expiring in 30 days" list; manual visit adjustment |
| A8 | Prices | Edit the 6 price cells (roof/ground × s/m/l) |
| A9 | Schedule | Slots (time, capacity, weekdays, active) and a calendar of blocked dates |
| A10 | Crews | Create a crew (name + phone), activate or deactivate |
| A11 | Content | Articles: markdown editor with preview, cover upload, category, featured, draft or publish. Categories with sort order |
| A12 | Ratings | List with a star filter and the average; a link to any ticket it opened |
| A13 | Settings | SMS fallback toggle; company phones (two); certificate stamp image; working hours; response text; cleaning interval; booking window; cancel cutoff; subscription plan; Terms/Privacy markdown; service area polygon editor on a map; maintenance mode |
| A14 | Admins | Invite or remove admins by phone |

Phase 3, part A (built):

- **Shell:** `src/app/admin/layout.tsx`, admins only. Every admin page stays live through Realtime on `orders` (`AdminLive`): any change refetches the page, and a new booking shows a link to it and plays a short chime. Sound starts off; the admin turns it on with "شغّل صوت التنبيه" (browsers allow sound only after a click), and the choice is remembered on that browser. Push comes in Phase 5.
- **A1:** today's orders (Baghdad) counted by status, each count opening the filtered list, and the 10 soonest pending confirmations. Unread chats (Phase 5, task 1), open tickets (Phase 4, task 2) and subscription requests (Phase 6, task 2: their count and the 5 oldest, each opening the A7 drawer).
- **A2:** `/admin/orders`, filters in the URL (status, with "active" as the default and "all"; day; district text; crew or "no crew"; slot from the board). Active orders sort soonest first, others newest first; 50 rows at a time. The drawer (`?order=`) shows the customer, slot, address with a Google Maps link, lines and total, payment and cash, customer note, every photo and video (signed links), the crew and its changes (from the audit log), and the timeline with staff notes and override tags. Actions by status: confirm (optionally assigning a crew first), crew, reschedule (any slot in the next 30 days that hasn't started; keeps the crew), cancel (reason), no-show (note; §6 lets admins do it, so it is its own action rather than an override), and override (any other status, reason). "Verify subscription" came with Phase 6, task 2 (below). The board (`/admin/orders/board`) shows a week of slots, places taken out of capacity, full and blocked days; a cell opens that slot's orders.

Phase 3, part B (built):

- **A8:** `/admin/prices`, the six prices in one grid with one Save. Booked orders keep their prices. A customer on Checkout when a price changes gets "تغيّر السعر" and the new total, and books only after confirming again (`ZL018`).
- **A9:** `/admin/schedule`. "طلبات تحتاج موعد جديد" lists booked orders that no longer fit (blocked day, switched-off slot, dropped weekday, over capacity), each linking to the A2 drawer. The slots table edits capacity, weekdays and on/off in place and says how many orders are booked in the slot; "أضف موعد" adds one. A month calendar (`?month=YYYY-MM`) shows blocked days and places held per day; a day opens a panel to block it (optional reason) or open it again. Past days can't be blocked.
- **A13:** `/admin/settings`, sections that save on their own: SMS fallback, company phone and support hours and days, booking (window, cutoff, tank limit, cleaning interval), sterilant, Terms and Privacy Markdown. The support response text (the off-hours automatic reply, "المحادثة" section) came with Phase 5, task 1; the subscription plan came with Phase 6, task 2; "التطبيق" (maintenance mode and the minimum app version, x.y.z, with this build's version shown; refused above the running build, so A13 can't lock itself out) came with N16 (Phase 6, task 3). `/admin/settings/area` lists the areas with a drawn preview and edits one at a time: name, on/off, and the shape. With a Google Maps key the shape is edited on the map (drag corners, draw a part, remove a part); without one (local, CI) it comes from a GeoJSON file or pasted text (Polygon, MultiPolygon, Feature or FeatureCollection). Every area exports as GeoJSON. A warning shows how many saved addresses are outside every active area.

Phase 3, part C (built):

- **A10:** `/admin/crews`, every crew with its phone, open orders (a link to A2 filtered by the crew) and state. "أضف فريق" takes a name and a phone that has no account yet; a customer's number is refused. Edit renames, switches on or off (switching off warns how many open orders the crew still holds; they stay assigned until the admin gives them to another crew in A2), and moves the crew to a new phone.
- **A14:** `/admin/admins`, every admin, with "انت" on the viewer's row and remove on every other row (with a confirm step). "أضف مشرف" takes a phone and a name; an existing customer keeps their name, and the screen says how many open orders they have as a customer.
- **Audit log:** `/admin/audit`, every admin write newest first, 50 a page (`?before=<id>`), filtered by area (`?entity=`) and by admin (`?admin=`). Each row shows the time, the admin, the change in words, what it was on (orders link to the A2 drawer) and the old and new values.

Phase 5, task 1 (built):

- **A4:** `/admin/chat` lists threads with messages, unread first then newest (name, last message with "انت:" for support's, time, unread count, phone), with search by name or phone (`?q=`) and 30 more at a time (`&n=`). `/admin/chat/[thread]` shows the conversation beside the list from 1024px (on its own below): the customer's messages with their order tags (opening the A2 drawer, where the admin cancels or reschedules) and files, system messages labelled "رد تلقائي", the reply box with attachments and five canned replies from ar.json (a tap puts the text in the box to edit; settled Oct 26, 2026, drafts for the owner to review), and a panel (a column from 1280px, below before that) with the customer's 10 latest orders, saved addresses, subscriptions (Phase 6, task 2) and tickets. Opening a conversation marks the customer's messages read. Everything is live through Realtime.
- **Shell:** "المحادثات" in the nav with the count of threads waiting, live; a new customer message plays the booking chime (while sound is on) and shows "رسالة جديدة من زبون". Push came with Phase 5, task 3 (below).
- **A1:** "المحادثات غير المقروءة" with their count and the 5 newest, each opening its conversation.
- **A13:** "المحادثة" edits the off-hours automatic reply.

Phase 5, task 2 (built):

- **A5:** `/admin/tickets`, newest first, 50 at a time, filters in the URL: status (open and in progress by default, all, or one), source (all, the customer's reports, low ratings) and a search by ticket number (1024 or ZL-T-1024), name or phone digits (`?q=`). Columns: number, date, customer and phone, subject (category or "تقييم 2 من 5"), order (to the A2 drawer), status. The drawer (`?ticket=`) shows the customer (tap to call), the order, the category or the rating (stars, tags, comment), opened and updated times, the description, the files (signed links), "افتح المحادثة" (the customer's thread in A4, where every ticket already posted its message), the status buttons مفتوح / قيد المعالجة / مغلق (any order, reopening included) and the internal notes (newest first, with author and time) with "أضف الملاحظة". Both actions are audited (`ticket.status`, `ticket.note`; the audit log filters by "البلاغات" and links to A5).
- **A12:** `/admin/ratings`: the average (one decimal) and the number of ratings, star filters with their counts (`?stars=`), and every rating newest first: date, order (to A2), customer, stars, tags, comment and the ticket it opened with its status (to A5). 50 at a time.
- **Shell:** "البلاغات" (with the count of open tickets) and "التقييمات" in the nav; every admin page refreshes on a new ticket or a status change (Realtime on `tickets`). Push came with Phase 5, task 3 (below).
- **A1:** "البلاغات المفتوحة" shows Issue reports too (category, or the stars of a rating), each opening the A5 drawer, with "كل البلاغات". The A2 drawer's rating card and A4's customer panel link their tickets to A5.
- **A13:** "المحادثة" also edits `ticket_response_hours`, with a preview of the Issue report's line.

Phase 5, task 3 (built):

- **Shell:** "فعّل التنبيهات" below the sound toggle turns on Web Push on that browser (new bookings, customer reschedules and cancels, customer messages, new tickets; §9.2), then reads "التنبيهات شغالة"; refused in the browser, it says so. A new ticket also plays the chime. A push tap opens the order in A2, the conversation in A4 or the ticket in A5.
- **Crew (C2):** the same button under the greeting, for new and changed jobs. On an iPhone it opens the add-to-home-screen steps.

Phase 6, task 1 (built):

- **A11:** `/admin/content` lists every article, last edited first (title linking to the editor, category, منشور / مسودة, مميز, last edit), filtered by status (`?status=`), with "مقال جديد" and "الأقسام". The editor (`/admin/content/new`, `/admin/content/[id]`): title, Latin slug (fixed once published, with the reason), category, "مقال مميز", the cover (scaled to WebP, at most 1600 px, in the browser and uploaded at once with the admin's session; replace or remove; a cover replaced before saving is deleted at once, one never saved by the nightly cleanup), and the Markdown body with "تعديل / معاينة" tabs (the same renderer as N9) and a live read time. A draft has "انشر" and "احفظ مسودة"; a published article "احفظ" and "رجّعه مسودة", and a link to N9. "احذف المقال" asks first and deletes the cover too. Publishing needs a body. `/admin/content/categories`: name, icon (six to pick from), article count, move up or down, add, edit, and delete (refused while an article uses it). "المحتوى" in the nav; the audit log names the articles (linking to the editor) and categories and filters by both.

Phase 6, task 2 (built):

- **A7:** `/admin/subscriptions`, views in the URL (`?view=`): the request queue (oldest first, the default), running (active and upcoming, ending soonest first), ending within 30 days, and ended (expired, declined, cancelled); a search by name or phone (`?q=`); 50 at a time. Columns: customer and phone, address, state, period, visits left of total, paid, requested. The drawer (`?subscription=`): the customer (tap to call, "افتح المحادثة"), the address, the plan, period, visits (used, held, left of total) and paid, and by state: "فعّل" (start date, today by default, with the end it gives; visits, tanks and price prefilled from the plan; the paid tick; a note), decline (reason; the customer is told), the paid tick, "احسب زيارة مستعملة" / "رجّع زيارة" (reason), cancel (reason; its open orders become cash orders, each logged), the orders on it (to A2), and the internal notes. "الاشتراكات" in the nav with the count of requests; every admin page refreshes on a subscription change (Realtime). A6 (Customers) is in no task yet (§13).
- **A1:** "طلبات الاشتراك" (above).
- **A2 drawer:** a covered order says "مشمول بالاشتراك" in its total (also the list and the board's tables), and a "الاشتراك" card with its state, visits, period, paid and a link to A7, and "شيل الاشتراك" (the order becomes a cash order; any status but completed). An uncovered order still waiting for its visit whose address has a subscription that covers it offers "استخدم الاشتراك". Confirming a covered order the subscription no longer covers shows why (`ZL034`).
- **A4:** the panel lists each address's subscription (state, visits, end), each opening A7.
- **A13:** "الاشتراك السنوي": price (empty = not offered), visits and tanks covered.
- **Audit log:** "الاشتراكات" as an area, its actions, and `order.subscription`; rows link to the A7 drawer.

Phase 4, task 2 (built):

- **A1:** "البلاغات المفتوحة" lists the 5 newest open tickets with their count (each opening A5 since Phase 5, task 2).
- **A2 drawer:** for a completed order, a "الشهادة والتقييم" card: the certificate number and code with links to the PDF, the print page and N15, and the customer's rating (stars, tags, comment, and the ticket it opened with its status). A12 (ratings list) came with Phase 5, task 2.
- **A13:** a "الشهادة" section edits `certificate_text`, the service paragraph printed on new certificates.
- **A13 (Oct 29, 2026):** "التواصل وساعات الدعم" takes a second company phone (optional, not the first one again). A "ختم الشركة" card uploads the certificate stamp (scaled to WebP, at most 800 px, transparency kept) and saves it at once, with replace and remove; the replaced file is deleted. Everywhere the company phone shows, both numbers show: the certificate footer, N16, Terms/Privacy's placeholder, and Tracking's and Chat's call button, which calls the one number or, with two, opens a sheet with both.

## 9. OTP, notifications and integrations

### 9.1 OTP delivery

Our server makes, sends and checks the code (settled Oct 24, 2026). Supabase Auth keeps the users and sessions but never sends or checks a phone code. Its `/verify` endpoint is public and has no attempt limit, only a per-IP rate limit, so a code Supabase made could be guessed from many IPs around our lock. The code lives in `src/lib/otp/`.

1. Login screen → Server Action → `requestOtp({ phone, channel })`. It validates the number (Zod, `src/lib/phone.ts`), makes a random 6-digit code and calls `request_otp`, which applies our limits (one send per 45 s, 3 per 10 minutes, 10 per 24 hours per phone, SMS only while `sms_enabled` is on, nothing while locked) and stores only an HMAC of the code. Then it sends the code:
   - Channel `whatsapp`: [OTPIQ](https://otpiq.com/) `POST /sms` with `provider: "whatsapp"`, `smsType: "verification"`. Our own WhatsApp number and template are used once set; OTPIQ's account until then.
   - Channel `sms`: OTPIQ with `provider: "sms"`. Both go through an `OtpSender` interface, so another provider can be added later.
   - WhatsApp fails right away (timeout, network or provider error, number refused) and `sms_enabled` is on: retry once over SMS. Not when the failure is our OTPIQ account or OTPIQ's own rate limit, which SMS would hit too.
   - The outcome goes back through `record_otp_sent` (with `channel_used`) or `record_otp_send_failed`. A failed send doesn't start the 45 s wait, so Login can offer SMS at once.
2. OTP screen → Server Action → `verifyOtp({ phone, code })`. `check_otp` compares the HMAC with the phone's latest sent code: valid for 5 minutes, usable once, and the 5th wrong code locks the phone for 15 minutes, during which even the right code is refused.
3. On a correct code the server finds the profile by phone, or creates the user through the Auth admin API (phone confirmed). It then signs in with `signInWithPassword`, using a password derived from the server secret and the user id, which sets the session cookies. That password never changes, because setting a new one signs the user out on their other devices. Users created without it (the seed's first admin) get it set on their first login, and so does everyone once after the secret key is rotated. The server sets it with the server-only RPC `set_login_password`, and a trigger on `auth.users` refuses every other password change, and any email address. So someone holding a stolen session can't call Auth's `PUT /auth/v1/user` to give themselves a password or an email, which would be a way in without our code (migration `auth_user_guard`).
4. Supabase Auth settings (`supabase/config.toml`, and by hand on hosted projects, `docs/supabase-setup.md` step 3): phone provider on with confirmations, sign-ups off, and the Send SMS Hook `private.refuse_auth_sms`, which refuses every send. So `/otp`, `/resend` and phone sign-up called directly deliver nothing, and Supabase never holds a phone code. Every sign-in comes from the app server's IP, so the hosted token-refresh rate limit (which also counts sign-ins) is raised.
5. OTPIQ problems the owner has to fix (key, credit, spending cap, trial mode, sender ID) go to Sentry without the phone or code. Locally and in CI there is no OTPIQ key and codes are printed in the server terminal; on Vercel a key is required, and Production refuses a dev key.

Phone change (Phase 6, decision 12) must use the same flow: our code to the new number, then the admin API changes the phone. Supabase's own phone-change SMS is refused by the hook. Built (Phase 6, task 3; settled Oct 28, 2026): our code to the account's current number first, then to the new number (`verifyCurrentPhone`, `newPhoneAvailable`, `changePhone` in `src/lib/otp`, with the same limits), then the server-only RPC `change_login_phone` moves the account in one transaction (§7). The sign-in password comes from the user id, so the user stays signed in and next logs in with the new number.

To do before launch: connect the WhatsApp Business number in OTPIQ and get the Arabic authentication template approved. The OTPIQ key lives only in Vercel's server env (`docs/deploy-setup.md` step 5).

### 9.2 Notifications

Every event writes a `notifications` row (the in-app list) and sends Web Push to all of that user's `push_subscriptions`. A database trigger on insert calls the Edge Function `send-push`. An endpoint that answers 410 (or 404) is deleted. Admins get push alerts plus a sound in an open dashboard.

Built in Phase 5, task 3 (migration `notifications`; copy settled Oct 27, 2026). The words are in ar.json (`Notifications.items`); the database stores the type and its values, and one function (`describeNotification`) writes them for both the list and the push. Numbers are shown left to right.

| Event | To | Title · body | Opens |
| --- | --- | --- | --- |
| Booking created | Admins | حجز جديد #1024 · day · slot · district | A2 order |
| Confirmed | Customer | تأكد حجزك · طلب #1024 · day · slot | N4 |
| Confirmed, with a crew assigned | Crew | شغلة جديدة #1024 · day · slot · district | C3 |
| Crew assigned to a confirmed or on-the-way order | New crew / old crew | شغلة جديدة #1024 / تغيّرت شغلة #1024 · انطت لفريق ثاني. | C3 / C2 |
| Rescheduled by the customer | Admins | الزبون غيّر موعد طلب #1024 · الموعد الجديد: … · يحتاج تأكيد | A2 order |
| Rescheduled by staff | Customer | تغيّر موعد طلبك #1024 · الموعد الجديد: … | N4 |
| Cancelled by the customer | Admins | الزبون ألغى طلب #1024 · السبب: (the N6 choice) | A2 order |
| Cancelled by staff | Customer | انلغى طلبك #1024 · إذا عندك سؤال راسلنا بالمحادثة. | N4 |
| Cancelled or rescheduled after confirmation, with a crew | Crew | تغيّرت شغلة #1024 · انلغت. / تغيّر موعدها وترجع للتأكيد. | C2 |
| On the way | Customer | الفريق طلع لبيتك · طلب #1024 · تابعهم على الخريطة. | Tracking |
| Arrived | Customer | الفريق وصل · طلب #1024 · الفريق يمك هسه. | Job progress |
| Work started | Customer, in-app only (§6) | بدأ الشغل · طلب #1024 · تكدر تشوف الصور أول بأول. | Job progress |
| Completed | Customer | شهادة التعقيم جاهزة · طلب #1024 · شوف الشهادة وقيّم الشغل. | Report |
| No-show | Customer | ما لكينا أحد بالبيت · طلب #1024 · راسلنا حتى نرتب موعد ثاني. | Chat (tagged with the order) |
| Support's chat message | Customer | رد جديد من الدعم · first 80 characters, or أرسل لك صورة / فيديو | Chat |
| A customer's chat message | Admins | رسالة جديدة من زبون · first 80 characters, the file or the quick topic | A4 conversation |
| New ticket | Admins | بلاغ جديد ZL-T-1001 · category or "تقييم 2 من 5" · order | A5 |
| Ticket status changed | Customer | بلاغك ZL-T-1001 صار قيد المعالجة / انغلق بلاغك… / رجع انفتح بلاغك… · الردود توصلك بالمحادثة. | N11 detail |
| Cleaning reminder, 7 days before | Customer | تذكير بموعد التنظيف · موعد التنظيف الجاي لخزان البيت يوم 8 تشرين الثاني. | Booking |
| Cleaning reminder, on the day | Customer | تذكير بموعد التنظيف · مرت 6 أشهر على آخر تنظيف لخزان البيت. | Booking |
| Subscription requested | Admins | طلب اشتراك جديد · البيت · الحي | A7 drawer |
| Subscription activated | Customer | تفعّل اشتراكك السنوي · اشتراك البيت: زيارتين لحد [date]. | N8 |
| Subscription expiring in 30 days (daily at 10:13 Baghdad, once per end date, not when a renewal was asked for) | Customer | اشتراكك يخلص قريباً · اشتراك البيت ينتهي يوم [date]. تكدر تجدده هسه. | N8 |
| Subscription request declined | Customer | ما كدرنا نفعّل اشتراكك · راسلنا بالمحادثة إذا عندك سؤال. | Chat |

Rules (settled Oct 27, 2026):

- Admin overrides notify only into completed (the certificate) and cancelled; other overrides are corrections. A crew is told only about jobs it could see (confirmed or later) and only while active. Deleted accounts get nothing. System chat messages (the automatic reply, the no-show and ticket messages) notify nothing: their event already did, or the customer caused it. Ticket notes never notify.
- Admins and crews get rows, which is how their push is sent, but no list screen in v1. Each user reads only their own rows, and only while they hold the role a row is for.
- Notifications are deleted after 90 days, read or not (nightly, 04:07 Baghdad).
- The Home bell shows a dot while any notification is unread. The chat tab dot stays chat-only; opening Chat also marks the customer's chat notifications read. No app-icon badge in v1.
- Reminders: daily at 10:03 Baghdad (§9.2's 10:00, off the hour), from `certificates.next_due_on`: the week reminder 1–7 days before, the due reminder on the day or up to 6 days after (a missed run catches up). Only while `reminders_enabled`, for a live account and address, when no newer certificate covers that address and no order there is still open. Each goes once (`cleaning_reminders`); a re-issued certificate with a new date gets its own. A reminder held back while reminders were off goes out if they are turned on within its window.
- Push is best effort: a request that fails leaves the in-app row. Chat pushes replace each other on the phone (the customer's in one, an admin's per conversation; the Topic header and the notification tag).

How push works:

- **Keys (VAPID).** One key pair per project. The public key is `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (Vercel; optional), the private key and a contact are Edge Function secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`), and `SEND_PUSH_SECRET` matches the Vault secret `send_push_secret` (`docs/supabase-setup.md` step 9, `docs/deploy-setup.md` step 1). Locally and in CI none is set: the app never asks for permission, the trigger sends nothing, and tests make throwaway keys (e2e gets only a public key and stubs the browser's subscribe).
- **send-push** (`supabase/functions/send-push`): checks the secret, reads the rows and the users' subscriptions with the service key, encrypts and signs each message with `web-push` (checked under Deno 2) and posts it with `fetch`, only to the push services `save_push_subscription` accepts. The payload is the type, its values and the ids; it logs counts only.
- **Service worker** (`src/app/sw.ts`): `push` writes the words from ar.json (only the Notifications namespace is bundled) and shows the notification with the badge icon; a tap opens `/notifications/<id>`, which marks it read and redirects to its target, in an open app window when there is one.
- **This browser's subscription** is saved under whoever is logged in each time Home, the admin shell or the crew app opens (a shared crew phone moves to the new account), and logout deletes and unsubscribes it first. "سجّل خروج من كل الأجهزة" (N13) deletes every subscription of the account (`delete_my_push_subscriptions`), and account deletion deletes them too (Phase 6, task 3).

Push permission: ask with an in-app card on Booking success (N5), never on first open. On iPhone, the card first explains "أضف التطبيق للشاشة الرئيسية", because Safari only allows web push from an installed app. Built: "خلّي نبلغك بكل خطوة" with "فعّل الإشعارات" (the browser's prompt opens only then) and "بعدين" (hides the card on that device for 30 days); on an iPhone or iPad in Safari's tab, the three steps (share button, «إضافة إلى الشاشة الرئيسية», open Zalal from the home screen). Hidden when push can't work there, is already on, or was refused. Staff turn push on with "فعّل التنبيهات" in the admin shell and the crew header (C2), which on an iPhone opens the same steps.

### 9.3 Other integrations

- Google Maps: one browser key (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) restricted to the app's domains. It enables Maps JavaScript API and Places API (New). The key is optional: without it Location falls back to a drawn map (§5.4). Owner setup: `docs/deploy-setup.md` step 6. The server checks addresses against `service_areas` with PostGIS, with no Google call. No reverse geocoding in v1.
- Sentry for the Next.js app and the Edge Functions; PostHog for funnels (login → address → booking → confirmed).
- Email: none in v1.

## 10. Certificate PDF and seed data

### 10.1 Certificate PDF (recommended contents)

The certificate is a single A4 portrait page, rendered from the HTML route `/certificates/[id]/print` with headless Chromium. It is generated once when the order completes and stored in the `certificates` bucket. It is a company document: it must not imitate a government or health-authority certificate.

1. **Header:** Zalal logo, "شهادة تنظيف وتعقيم خزان ماء", certificate number (ZL-1024), issue date.
2. **Customer:** name, district + landmark, masked phone (0780 ••• 4567).
3. **Service:** order number, service date and slot, tanks (type, size, quantity), sterilant (from settings), residual chlorine if the crew entered it.
4. **Service description:** a short standard paragraph from settings describing what a Zalal cleaning includes.
5. **Photos:** up to 2 "قبل" and 2 "بعد" thumbnails.
6. **Next cleaning:** the recommended date (+6 months).
7. **Verification:** a QR code to `/c/[public_code]`, with the code also printed in text.
8. **Stamp area:** the company stamp/signature image (uploaded in settings; a placeholder box until then).
9. **Footer:** company phone and a disclaimer: "هذه الشهادة وثيقة صادرة من شركة زلال لتوثيق الخدمة المنفذة، وليست شهادة من جهة رسمية".

The on-screen Report and the public page N15 use the same data, so all three always match.

Built (Phase 4, task 2):

- **Print page:** `/certificates/[id]/print` (certificate id), one A4 page (794 × 1123 px). Headless Chromium opens it with a print token: an HMAC of the certificate id and an expiry 5 minutes ahead, keyed with the server secret, sent as an httpOnly cookie on our own origin, never in the URL. With a valid token the page reads with the secret key; otherwise it reads as the logged-in user (the customer and admins see it; anyone else, guests included, gets the not-found page). Not indexed.
- **Contents as listed above.** Certificate identity settled Oct 29, 2026 (§13): the issuer is "شركة زلال" (ar.json); the stamp area shows the image uploaded in A13 (`settings.certificate_stamp_path`, a public file in public-content `stamp/`), and a dashed box labelled "ختم الشركة" until there is one; the footer lists `settings.company_phone` and `company_phone_2`, each left out until set. The service paragraph is `settings.certificate_text` (A13). Up to 2 before and 2 after photos. The QR code (error correction M) and the printed link open N15; the link uses the production domain in production (`VERCEL_PROJECT_PRODUCTION_URL`) and the deployment's own address elsewhere.
- **Making the PDF** (`src/lib/certificates/pdf.ts`): Chromium opens the deployment's own print page (`VERCEL_URL` on Vercel; off Vercel only a localhost address from the request, never another host), waits for the network and the Cairo font, and prints A4 without margins. Its requests to our origin carry `x-vercel-protection-bypass` when `VERCEL_AUTOMATION_BYPASS_SECRET` is set (`docs/deploy-setup.md` step 1.6); Supabase Storage photos load; everything else (analytics, error reporting, the service worker, other hosts) is blocked. The file goes to `certificates/<id>/<issue time>.pdf`, `pdf_path` is recorded only if the certificate wasn't issued again meanwhile, and older versions are deleted. It runs after the crew's خلصنا (`after()` in the Server Action, so the crew doesn't wait; failures go to Sentry) and on the first download when the PDF is missing (an admin override, or a failed run). Both functions get `maxDuration = 60`.
- **Chromium:** on Vercel, `@sparticuz/chromium` (decompressed to /tmp on a cold start). Locally and in CI, `CERTIFICATE_CHROMIUM_PATH` (the e2e server gets Playwright's Chromium), launched without its sandbox as Playwright does; without either, the download shows "ما كدرنا نجهّز ملف الشهادة هسه".

### 10.2 Seed data (`supabase/seed.sql`)

`seed.sql` loads only into local databases (`pnpm db:reset`, CI). Hosted dev and prod never load it: the deploy runs migrations only. So any row a hosted project needs to work goes in a migration, written to skip itself when the row already exists (the settings row, the service area). Phase 2 must do the same for the starting prices and slots, or booking on dev has nothing to offer.

| Item | Seed value | Source |
| --- | --- | --- |
| Prices, roof s / m / l | 25,000 / 35,000 / 50,000 IQD | `Booking.dc.html` script |
| Prices, ground s / m / l | 60,000 / 80,000 / 120,000 IQD | `Booking.dc.html` script |
| Size labels | لحد 1,000 لتر / 1,000–2,000 / أكبر | Booking design |
| Slots | 8–10 الصبح, 10–12 الظهر, 4–6 العصر; capacity 2 each; Sat–Thu | Booking design; capacity is a placeholder |
| Service area | Karbala city polygon, drawn in A13 before launch | Placeholder from migration `default_service_area` (city, Al-Hurr, Al-Hussainiya, Karbala–Hindiya road, Hindiya, and Ain al-Tamr) |
| Article categories | صحة, نصائح, الصيف, أسئلة شائعة | Tips design + 1 |
| Subscription plan | 2 visits / 12 months, 1 tank, price \[YOUR PRICE\] | Visits and tanks from migration `subscriptions`; no price on dev and prod until you set it in A13 (`seed.sql` uses 60,000 locally) |
| First admin | Your phone number, via `ADMIN_PHONE` env | — |

Seeded articles. Claude Code drafts the bodies in Iraqi Arabic, 300–500 words each; you review them before launch, especially health statements. Built (Phase 6, task 1): the categories (with icons: صحة a drop, نصائح a tank lid, الصيف a sun, أسئلة شائعة a question mark) and the articles come from migration `articles`, so every project has them, skipped when the name or slug exists. Articles are **drafts** there (settled Oct 28, 2026): Tips shows its empty state and Home hides the strip on dev and prod until you publish them in A11. `seed.sql` publishes them locally. No covers (none exist yet; a migration can't upload files). Slugs: `tank-cleaning-signs`, `clean-every-six-months`, `summer-heat-bacteria`, `tank-lid`, `cleaning-visit`, `chlorine-smell`. "5 علامات" uses the Tips canvas's five signs as its numbered list.

| Title | Category | Featured |
| --- | --- | --- |
| 5 علامات تكول خزانك يحتاج تنظيف | نصائح | Yes |
| ليش لازم تنظف الخزان كل 6 أشهر؟ | صحة | Yes |
| الحر يكثّر البكتريا بالخزان: شلون تحمي عائلتك | الصيف | No |
| غطاء الخزان: أبسط خطوة تمنع الوسخ والحشرات | نصائح | No |
| شنو يصير بزيارة التنظيف؟ | أسئلة شائعة | No |
| ريحة الكلور بعد التعقيم: طبيعية لو لا؟ | صحة | No |

## 11. Running cost estimate

Expect about **$70–$85 a month (≈ 92,000–112,000 IQD) at launch** and about **$300–$500 a month at 10× the volume, most of it OTP messages**. There are no app-store fees, because v1 is a PWA.

Assumptions: launch = 300 orders and 1,000 OTP codes a month; growth = 3,000 orders and 10,000 codes a month. About 70 MB of media per order. 1 USD ≈ 1,310 IQD. Prices are list prices as of October 2026; check them before you subscribe.

| Item | Launch / month | Growth / month | Notes |
| --- | --- | --- | --- |
| [Vercel Pro](https://vercel.com/pricing) | $20 | $20 | 1 seat. Hobby forbids commercial use |
| [Supabase Pro](https://supabase.com/pricing) | $25 | $30–$60 | Prod only; dev stays on Free. Includes 8 GB DB, 100 GB files, 250 GB egress, $10 compute credit. Growth adds a Small instance and storage beyond 100 GB at $0.021/GB. Free caps uploads at 50 MB, below the 100 MB video limit (§5.10), and pauses after a week idle, so prod must be on Pro by launch |
| WhatsApp OTP via [OTPIQ](https://docs.otpiq.com/llms-full.txt) | ≈ $19 (25,000 IQD) | ≈ $190 (250,000 IQD) | 25 IQD per authentication message |
| SMS fallback (≈ 10% of codes) | ≈ $6–$19 | ≈ $61–$191 | OTPIQ lists 80–250 IQD per SMS depending on carrier; your own provider may be cheaper. Admins can switch it off |
| [Google Maps](https://www.woosmap.com/blog/google-maps-api-pricing-breakdown) | $0 | $0–$40 | 10,000 free map loads and 10,000 free autocomplete requests a month per API; then $7 per 1,000 map loads. Needs a billing card |
| Web Push, Sentry, PostHog | $0 | $0 | Free tiers cover this volume |
| Domain (.com) | ≈ $1 | ≈ $1 | About $12 a year; a .iq domain costs more |
| **Total** | **≈ $70–$85** | **≈ $300–$500** |  |

How to keep costs down:

- Keep sessions long (refresh tokens of 60 days or more), so returning users rarely need a new code. OTP is the cost that grows with users.
- Delete customer-uploaded booking videos 90 days after completion. Keep before/after photos and certificates. Built in Phase 6, task 4 (`media-retention`, §7 Storage); cancelled and no-show orders count from their own end.
- Load the map only on Location, Tracking and the crew job screen. Lists and cards use text, not maps.

Later costs, if you go native: Apple Developer $99 a year and Google Play $25 once.

## 12. Claude Code playbook

Build in 7 phases. Each phase ends with a working, deployed slice and its acceptance checks. Start every Claude Code session with: "Read CLAUDE.md and docs/spec.md, then do Phase N, task X".

### 12.1 Repo setup

```
zalal/
  CLAUDE.md                 # rules below
  docs/spec.md              # this doc, exported as Markdown
  design/                   # the canvas .dc.html files + canvas.json (read-only reference)
  src/app/(customer)/...    # customer routes
  src/app/crew/...          # crew app
  src/app/admin/...         # dashboard
  src/app/c/[code]/         # public certificate page
  src/app/certificates/[id]/print/  # PDF source page
  src/components/ui/        # buttons, chips, cards, sheets, inputs (tokens only)
  src/lib/                  # supabase clients, money, dates, phone, otp, push
  src/server/actions/       # Server Actions (all writes)
  messages/ar.json          # every UI string
  supabase/migrations/      # schema, RLS, RPC functions
  supabase/functions/       # send-push, reminders
  supabase/seed.sql
  tests/unit/  tests/e2e/   # Vitest, Playwright (390x844 viewport)
```

### 12.2 CLAUDE.md starter

The maintained version is `CLAUDE.md` at the repo root, which has grown past this starter. Edit that file, not this block. Tooling and workflow for Claude Code are in `docs/claude-code-setup.md`.

```markdown
# Zalal — rules for Claude Code
- Spec: docs/spec.md. Designs: design/*.dc.html. Read the screen's design file before building it; match layout, copy and tokens exactly unless the spec lists a change.
- Arabic RTL app. Use logical CSS (ms-/me-/ps-/pe-/start/end), never left/right. Wrap phone numbers and times in dir="ltr".
- All UI strings go in messages/ar.json (Iraqi Arabic, copy from the designs).
- Colors, radii and sizes come from the Tailwind theme tokens only. No raw hex in components.
- TypeScript strict. Zod for every input. Writes go through Server Actions or Postgres RPC; never update orders.status directly; use transition_order().
- Every table has RLS. Add an RLS test for every new policy.
- Money = integer IQD; format with formatIQD(). Dates = Asia/Baghdad via lib/dates.
- Every screen has loading, empty, error and offline states.
- Do not add libraries without saying why in the PR description.
- After each task: pnpm lint && pnpm typecheck && pnpm test; commit with a clear message.
```

### 12.3 Phases and tasks

**Phase 0 — Foundation**

- [x] Next.js 16 + TS + Tailwind v4 + pnpm; Cairo font; `dir="rtl"`; theme tokens from section 4
- [x] Supabase project (Frankfurt), local dev with the Supabase CLI, generated types
- [x] PWA manifest + Serwist; icons from the extracted logo
- [x] Base UI kit: Button, IconButton, Chip, Card, Input, Sheet, TabBar, Stepper, Skeleton, EmptyState (see §4 "UI kit"); Welcome screen built on it
- [x] Vercel project, preview deploys, Sentry, PostHog; GitHub Actions running lint, typecheck and tests (code and workflows; the owner's account steps are in `docs/deploy-setup.md`)
- [x] Claude Code setup from `docs/claude-code-setup.md`: SessionStart hook, `.claude/settings.json` permissions and edit hooks, guard scripts (`scripts/guards.ts` in `pnpm lint`) and the protected-paths CI check, the `build-screen` and `ship-task` skills; Commands section of CLAUDE.md filled in

* Done when: an empty app installs to the home screen on Android and iPhone and renders the Welcome screen pixel-close to `Main.dc.html`

**Phase 1 — Accounts and addresses**

- [x] Schema: profiles, settings, otp\_requests, service\_areas, addresses, tanks; RLS. With the first schema task, add the `db-change` skill, the `rls-auditor` subagent and `supabase/CLAUDE.md` (`docs/claude-code-setup.md` §3.4–3.6)
- [x] OTP on the server (OTPIQ WhatsApp + SMS behind an `OtpSender` interface + `sms_enabled` toggle): our server makes, sends and checks the code, and Supabase Auth never sends one (§9.1). Replaces the planned `send-otp` Edge Function, which would have left Supabase's `/verify` open to guessing (§13)
- [x] Screens: Welcome, Login, OTP, Name (N1), Location, address list/picker (N2), My tanks (N3); guest mode. Also the Phase 1 shells of Home and Profile (entry points for N2 and N3), `/crew` and `/admin` placeholders, plain-text Terms and Privacy, and `src/proxy.ts`

* Done when: a real Iraqi number logs in over WhatsApp; turning `sms_enabled` off hides SMS; a pin outside Karbala is refused

**Phase 2 — Booking**

- [x] Schema: price\_list, slots, blocked\_dates, slot\_bookings, orders, order\_items, order\_events, order\_media; `create_order` + `transition_order` RPC. Also `crews` and `admin_audit_log` (which `transition_order` needs), `booking_availability()`, and the `order-media` upload rules
- [x] Screens: Booking 1–3, Upload with resumable upload, Booking success (N5), Orders, Order details (N4), Cancel (N6), Reschedule (N7); Home with live cards
  - [x] Part A: Booking 1–3, Upload with resumable upload, Booking success (N5)
  - [x] Part B: Orders, Order details (N4), Cancel (N6), Reschedule (N7), Home with live cards

* Done when: two parallel bookings cannot overbook the last seat (test); cancelling at 1 h 59 min is refused

**Phase 3 — Admin core and crew app**

- [x] Admin shell + A1, A2 (confirm, assign, cancel, reschedule, override), A8, A9, A10, A13, A14; admin audit log
  - [x] Part A: admin shell, A1, A2 with the order drawer and the date × slot board; `assign_crew` and `admin_slot_board`; in-page sound for new bookings
  - [x] Part B: A8 prices, A9 schedule (slots, blocked dates), A13 settings with the service-area editor (Google Maps with a key; without one, a drawn preview plus GeoJSON import and export)
  - [x] Part C: A10 crews, A14 admins (a phone that already has an account can't become a crew; an existing account can be made an admin), audit log screen
- [ ] Crew app C1–C4 with media capture, retry queue and GPS sharing
  - [x] Part A: C1 login, C2 My jobs, C3 Job detail, C3a status button and no-show; a cash-only finish sheet; `crew_job_contact`; before and after photos made optional
  - [x] Part B: C3b photo and clip capture with a retry queue that survives a reload; the full C4 finish form (sterilant, residual chlorine, an internal crew note)
  - [ ] Part C: GPS sharing while on the way (`crew_live_location`, Wake Lock), and the three-device test of the whole path
    - [x] GPS sharing, built with Phase 4, task 1 (migration `live_job`)
    - [ ] The three-device test of the whole path (by hand, on real phones)
- [x] Cleanup of unattached uploads in `order-media`: booking files after 72 h, crew files once the job can't take them (Edge Function `media-cleanup` on pg_cron, migration `media_cleanup`); `create_order` books uploads only within 48 h

* Done when: the whole path booking → confirm → assign → on the way → arrived → in progress → completed runs across three devices

**Phase 4 — Live job and certificate**

- [x] Tracking (Realtime crew location), Job progress (Realtime media), A3 live map
- [x] Certificates: record on completion, print route, PDF via Chromium, public page N15, Report screen, rating + auto-ticket (also the certificate and rating in the A2 drawer, open rating tickets on A1, `certificate_text` in A13). N12 stays in Phase 6 with Profile

* Done when: the PDF renders Arabic correctly, its QR opens N15, and a 2-star rating creates a ticket

**Phase 5 — Communication**

- [x] Chat (customer) + A4 inbox with Realtime, attachments, order tags, working-hours auto-reply. Also the entry points that waited for Chat (مساعدة on Orders and N4, the chat buttons on Tracking and Job progress, "افتح المحادثة" in N6/N7), the no-show system message (§6), the chat message for every new ticket (so ratings' tickets post one now), the tab bar's unread dot, unread chats on A1 and the nav, the automatic reply in A13, and the chat folder of the nightly media cleanup
- [x] Issue report + My reports (N11) + A5 tickets (the ticket's chat message already posts, migration `chat`; the Issue report adds its wording and "افتح المحادثة"); A12 ratings. Also `ticket_media`, `ticket_notes` and the `ticket-media` storage rules and cleanup (migration `tickets_app`), Report's "بلّغنا", Profile's "بلاغاتي", the A13 response time, and links to A5 from A1, A2, A4 and the audit log
- [x] Notifications: table, in-app list, Web Push (`send-push`), soft permission card, reminders cron. Also the Home bell, push for admins and crews ("فعّل التنبيهات" in the admin shell and C2), the ticket chime in the admin shell, logout forgetting the browser, notification retention, and the RLS audit's role check on staff rows (migration `notifications`)

* Done when: every event in 9.2 arrives as push on an installed Android and iPhone PWA

**Phase 6 — Content, subscription, polish**

- [x] Articles + categories + A11 editor + seeded articles; Tips and Article (N9). Also Home's tips strip, the Markdown renderer N14 will reuse, admin-only cover storage with its nightly cleanup, and the audit log's article actions (migration `articles`)
- [x] Subscription: N8 request, A7 management, checkout toggle, visit decrement. Also the Profile card, the kit's `Switch`, the A1 list and nav count, A2's coverage card, A4's panel, A13's plan, the audit log's subscription rows, four notifications and the 30-day notice job (migrations `subscription_notification_types`, `subscriptions`)
- [x] Profile, Edit profile (N10), Certificates (N12), Settings (N13) with account deletion, Terms/Privacy placeholders (N14), N16 states. Also Home's quick actions, the two-code phone change, log out on all devices, A13's "التطبيق" section and the admin screens' "حساب محذوف" (migration `account_deletion`)
- [x] QA pass: empty/error/offline states, accessibility (labels, 44 px targets, contrast), Lighthouse PWA ≥ 90, media retention job. Also the Arabic 404, the offline error state, axe on every route (`a11y.spec.ts`), Chrome's installability check in place of Lighthouse's dropped PWA category (`pwa.spec.ts`), `pnpm lighthouse` (Accessibility 100, Best practices ≥ 95, SEO ≥ 90 on indexable pages; Performance reported), the certificate PDF sweep, the audit-log scrub on deletion and the chat-media swap fix (migration `qa_retention`)

* Done when: the launch checklist passes

### 12.4 Launch checklist

- [ ] Prod Supabase project moved to Pro (Free caps uploads at 50 MB and pauses idle projects); set its global upload limit to at least 100 MB (Storage settings)
- [ ] Domain bought and connected; Google Maps key restricted to it; a Map ID created for Tracking and the live map (`docs/deploy-setup.md` step 6)
- [ ] OTPIQ WhatsApp number connected and template approved; live OTPIQ key in Vercel Production (`docs/deploy-setup.md` step 5)
- [ ] Web Push keys and secret in the prod project and the public key in Vercel Production (`docs/supabase-setup.md` step 9); one push checked on an installed Android and iPhone app
- [ ] Karbala polygon drawn; prices, slots, capacity and subscription price set; sterilant text and both company phones set (A13)
- [ ] Terms and Privacy text replaced; the stamp image uploaded (A13 "ختم الشركة"; certificate identity settled Oct 29, 2026, §13); `certificate_text` reviewed (A13)
- [ ] Vercel "Protection Bypass for Automation" secret created, so certificate PDFs can be made (`docs/deploy-setup.md` step 1.6)
- [ ] Seeded articles reviewed (health statements first) and published in A11; they are drafts on dev and prod
- [ ] Admin and crew accounts created; crews trained on the PWA (keep it open while driving)
- [ ] The three-device test of the whole path, by hand on real phones (Phase 3, part C): booking → confirm → assign → on the way → arrived → in progress → completed
- [ ] `pnpm lighthouse` on the production domain with a customer's session: Accessibility 100, Best practices ≥ 95, SEO ≥ 90 on indexable pages

Every item above is the owner's (accounts, keys, content, phones); the code-side checks run in CI.

## 13. Open items

These are assumptions made while writing the spec. Each has a working default, so none blocks Phase 0–2; settle them before the phase noted.

- [x] **Job media (before Phase 3):** settled Oct 26, 2026: before photos, after photos and clips are all optional. `transition_order` no longer checks for photos (migration `crew_jobs`).
- [x] **Crew finish form (Phase 3, task 2, part B):** settled Oct 26, 2026: the C4 note is internal (staff only, in `order_event_notes`); sterilant and the chlorine reading go to `job_reports` until certificates exist; the sterilant is required. Uploads land up to 24 h after completion; limits 10 before, 10 after, 4 clips; the crew can remove its own file while the job is open.
- [x] **Residual chlorine (before Phase 3):** settled Oct 26, 2026: kept as an optional crew field (C4) that shows on the certificate only when filled.
- [x] **Crew calls the customer (before Phase 3):** settled Oct 26, 2026: yes, from the company-owned crew phone, and only while the job is open (confirmed through in progress). After that the number is hidden.
- [x] **No-show policy (before Phase 3):** settled Oct 26, 2026: no fee or block in v1, only the status and an internal note. The chat message to the customer came with Chat (Phase 5, task 1).
- [x] **Subscription details (Phase 6, task 2):** settled Oct 28, 2026: (1) 2 visits a year for 1 tank, the price set by the owner in A13 (no price = not offered); (2) one visit covers one order of up to the tanks covered, so Checkout offers the toggle only then; (3) a subscription belongs to one address; (4) paid outside the app, "paid" is a tick for the admin and doesn't block use; (5) only a completed order uses a visit, a no-show or cancel none, an open order holds one; (6) the slot date must be inside the 12-month period and unused visits lapse; (7) the admin picks the start, today by default; (8) a renewal from 30 days before the end or after it; (9) admins decline (the customer is told) or cancel with an internal reason, customers withdraw only through chat; (10) no admin-made subscriptions in v1; (11) "الزيارة الجاية" as in §5.8; (12) guests see N8; (13) Checkout's toggle starts off; (14) the plan's words are in ar.json; (15) A6 stays out of this task.
- [x] **A6 Customers:** settled Oct 28, 2026: not in v1. A4's customer panel and A7's search cover it.
- [x] **Moving a subscribed address:** settled Oct 28, 2026: the pin can't move while the address's subscription is requested or active and not past its end (`ZL041`); district and landmark stay editable (migration `account_deletion`).
- [x] **Operations (before Phase 2):** settled Oct 25, 2026: slot capacity 2, slots Saturday to Thursday (Friday closed), support hours 9 AM–9 PM, as seeded. All are editable later (A9, A13).
- [x] **Booking rules (Phase 2, task 1):** settled Oct 25, 2026. The window is today plus 13 days. A new booking needs the slot to start at least 2 h from now, like cancel and reschedule. A new tank line saves one tank to the address, and its quantity stays on the order line. `transition_order` covers the whole §6 table now, so `crews` and `admin_audit_log` moved up from Phase 3.
- [x] **Staff notes on the order timeline (Phase 2, task 1):** settled Oct 25, 2026: internal. The reason staff give when they cancel, mark a no-show or override goes to `order_event_notes`, which admins and the assigned crew read and the customer never does. The customer's timeline (N4) shows what happened and who did it (company or crew), without the note.
- [x] **Active orders per customer (Phase 2, task 1):** settled Oct 25, 2026: no limit. Admins confirm every booking, so they can cancel abuse by hand. A limit would be one check in `create_order`.
- [x] **SMS provider (before Phase 1):** OTPIQ for both WhatsApp and SMS (settled Oct 23, 2026). The `OtpSender` interface keeps room for another provider later.
- [x] **OTP verify bypass (before Phase 1, task 2):** closed (settled Oct 24, 2026). Our server makes, sends and checks the code and signs the user in itself, and the Send SMS Hook refuses every Supabase-sent code. So Supabase's `/verify` has no phone code to guess, and calling its `/otp` directly delivers nothing (§9.1).
- [x] **Auth gaps for a stolen session (after Phase 1, task 3):** closed (settled Oct 24, 2026). A logged-in user could set their own password (`PUT /auth/v1/user`) and then sign in without our code, or attach an email as a second way in. A trigger on `auth.users` now refuses both: a password changes only inside the server-only RPC `set_login_password`, and no account gets an email (§9.1, §7). An earlier draft with a short window the server opened before calling the Auth admin API could be raced by the stolen session; the RLS audit caught it. Accepted for v1: a stolen session stays usable until it is refreshed away (no "log out on all devices" yet; it could come with Settings, N13), it can edit its own user metadata (nothing reads it; roles come from `profiles`), and it can log its owner out everywhere.
- [x] **Districts (before Phase 1):** free text as designed, 2–60 characters (settled Oct 23, 2026). An admin-managed list can come later if the data gets messy.
- [x] **Media retention (before Phase 6):** settled Oct 28, 2026 (Phase 6, task 4): customer booking videos only, 90 days after the order closed (completed, cancelled or no-show); customer photos, the crew's photos and clips, certificates, chat and ticket files are kept. N4 says so on old orders. Built as below (`media-retention`, migration `qa_retention`). The question was: delete booking videos 90 days after completion? If yes, a SQL job that deletes those videos' `order_media` rows is enough: the files then count as unattached, and the nightly `media-cleanup` job deletes them (its customer rule already applies, since they are over 72 h old).
- [x] **Unattached media cleanup (Phase 3):** settled Oct 26, 2026: a pg_cron + Edge Function job per folder (not a Vercel cron, which would clean only prod), booking uploads bookable for 48 h and deleted after 72 h, crew uploads deleted 48 h after the job stops taking them. Accepted: if an admin override reopens a job in the seconds between the job listing a crew file and deleting it, and the crew's phone attaches that file in the same moment, the row points at a deleted file. The phone's queue would also have to be holding a file for a job closed more than 48 h earlier.
- [x] **Issue report response time (Phase 5, task 2):** settled Oct 27, 2026: a setting, `ticket_response_hours` (1–72, default 1, A13), with the words in ar.json ("نرد عليك خلال ساعة / ساعتين / 3 ساعات بأوقات الدوام").
- [x] **Ticket rules (Phase 5, task 2):** settled Oct 27, 2026: admins may move a ticket to any status, reopening included; the Issue report lists orders whose slot is at most 90 days ago or still ahead, any status, newest selected; 5 reports an hour per customer; a status change posts nothing in Chat (task 3 pushes it).
- [x] **Chat media swap (RLS audit of `tickets_app`):** fixed Oct 28, 2026 in migration `qa_retention`, as below. `chat-media` has the race the ticket audit found: its upload policy doesn't refuse the name of a sent file, and `send_chat_message` doesn't lock the file while attaching it, so a customer deleting their file at the very moment it is sent could later upload other content under that name (their own message only). The fix is the same as `tickets_app`'s, in a new migration.
- [x] **Notifications (Phase 5, task 3):** settled Oct 27, 2026: the copy in §9.2; admins and crews get rows for their push but no list in v1; 90-day retention; the bell dot means any unread notification and the chat tab dot stays chat-only (opening Chat marks chat notifications read); no app-icon badge in v1; "work started" is in-app only; the crew is told when its confirmed job is cancelled, moved back to pending or given to another crew; overrides notify only into completed and cancelled; reminders skip an address that was deleted, has a newer certificate or an open order.
- [x] **Push after a session ends without logout:** settled Oct 28, 2026: N13's "سجّل خروج من كل الأجهزة" ends every session's refresh token and deletes every push subscription of the account. A session that just expires still leaves its browser's subscription until the next login there (accepted).
- [x] **Chat after account deletion:** settled Oct 28, 2026: deletion deletes the thread with every message (staff replies included) and file.
- [x] **Account deletion (Phase 6, task 3):** settled Oct 28, 2026, with the plan's recommended defaults: customers only; refused while an order is open; the Auth user is banned without its phone, so the number can sign up again as a new account; orders and certificates stay anonymized as company records (landmark removed, pin rounded to about 1 km, note and rating comment cleared, order media and certificate PDFs deleted); tickets, chat, notifications and push deleted; subscriptions ended (§7 "Accounts").
- [x] **Personal data left after a deletion (before launch):** settled Oct 28, 2026 (Phase 6, task 4): `otp_requests` already go after 7 days (`purge-otp-requests`, migration `otp_requests`), kept as is; `delete_account` blanks `note`/`reason` in the account's audit rows (once for earlier deletions too) and deletes the admins' notifications of its messages (RLS audit); a nightly sweep deletes certificate PDFs nothing records. Staff phones in crew and admin audit rows stay as staff records. The item was: `otp_requests` keeps the number (its rows have no retention job yet), `admin_audit_log` diffs keep old values (a crew's or admin's phone), and a certificate PDF stays in the bucket if the server's delete after `delete_account` fails (Sentry is told). Decide on an `otp_requests` retention (for example 30 days) and whether audit diffs of a deleted account are scrubbed.
- [x] **Chat details (Phase 5, task 1):** settled Oct 26, 2026: `support_response_text` is the off-hours automatic reply; canned replies are a fixed list in ar.json for v1 (editable in A13 later if needed); the header drops "متصلين"; one file per message with the typed text as its caption.
- [ ] **Staff writing about a deleted account (after launch):** found by the RLS audit of `qa_retention`. After a deletion, an admin can still add a subscription note or override an order with a reason; that new text lands in `subscription_notes`, `order_event_notes` and the audit log, and nothing scrubs it again. Default for v1: accepted as a staff record (staff see "حساب محذوف" and have no reason to write personal data). The alternative is refusing those RPCs for a deleted account's rows.
- [x] **Lighthouse "PWA ≥ 90" (Phase 6, task 4):** settled Oct 28, 2026: Lighthouse 12+ dropped the PWA category, so `pwa.spec.ts` runs Chrome's own installability check and manifest parser in CI, and `pnpm lighthouse` reports the other categories with targets (Accessibility 100, Best practices ≥ 95, SEO ≥ 90 on indexable pages), not in CI. Performance has no gate: the first load is mostly Sentry (about 116 KB gzipped, already trimmed by `bundleSizeOptimizations`) and the framework; tuning it comes after launch.
- [x] **Certificate identity (before launch):** settled Oct 29, 2026: the issuer stays "شركة زلال" (the company is زلال); the stamp or signature is an image the admin uploads in A13 (none yet; a dashed box until then); the company has two phones, 07764349984 and 07867903703, which the owner enters in A13, and both show wherever the company phone does (migration `company_contact`).
- [x] **Tips and articles (Phase 6, task 1):** settled Oct 28, 2026, with the plan's recommended defaults: (1) the seeded articles are drafts on dev and prod until the owner publishes them in A11 (`seed.sql` publishes them locally); (2) no seed covers: N9 shows the category's icon block and Tips always uses icon tiles; (3) read time is computed from the body at 150 words a minute, at least 1; (4) slugs are Latin and typed by the admin, editable until the first publish, then fixed; (5) Tips' top card is the newest featured article, keeps the canvas label "مقال اليوم", lists the body's first numbered list (up to 5) or its first paragraph, and shows under الكل or its own category; (6) Home's strip fills with the newest published articles when fewer than 2 are featured and hides when none is published; (7) Home's quick actions come as one row with Phase 6, task 3; (8) whole article cards are links.
- [x] **Crew and admin designs (before Phase 3):** settled Oct 25, 2026: no canvas pass; both are built from the kit and tokens (§8).
