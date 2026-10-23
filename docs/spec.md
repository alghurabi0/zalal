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
- Job progress by status, optional clips, required before and after photos
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
| 9 | OTP channel | WhatsApp first; SMS fallback via the owner's Iraqi SMS provider, admin toggle |
| 10 | OTP rules | 6 digits, 5 min expiry, 45 s resend, 5 attempts then lockout, 07X numbers only |
| 11 | Guests | Can browse tips and prices; login required at Book |
| 12 | Profile | Edit name only; phone change = new OTP; account deletion available |
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
| G | Subscription | Customer requests it in the app; admin activates and tracks visits by hand |
| 38 | Cancel/reschedule | In-app and via chat; blocked within 2 h of the slot, no fee |
| 39 | Dispatch | Admin assigns crews manually |
| 40 | Tracking | Crew phone sends GPS while on the way; straight-line distance, no routing ETA |
| 42 | Crew identity | No crew card, details or crew rating |
| 43–44 | Job media | Before and after photos are required; per-step clips are optional |
| 45–46 | Certificate | A company document (placeholder design), no reading validation |
| 49 | Rating | Skippable, rates the company; 3 stars or fewer opens a support ticket |
| 53 | Notifications | Push + in-app only |
| 54–55 | Content | Articles and categories managed by admin, seeded at launch |
| 59 | Stack | Next.js 16 + Supabase + Vercel (section 3) |
| 60 | Environments | Local (Docker), dev and prod Supabase projects in separate orgs; Claude never holds prod credentials; CI deploys migrations (`docs/supabase-setup.md`) |

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
| Auth | Supabase Auth, phone OTP + custom **Send SMS Hook** | The hook is a Supabase Edge Function that delivers the code by WhatsApp or SMS (section 9) |
| Storage | Supabase Storage, private buckets + signed URLs | Resumable (TUS) uploads for video |
| Realtime | Supabase Realtime | Chat messages, order status, crew location |
| Jobs | `pg_cron` + Edge Functions | Reminders, subscription expiry, stale-slot cleanup |
| Maps | Google Maps JS API (`@vis.gl/react-google-maps`), Places Autocomplete | Service-area polygon check on the server (PostGIS `ST_Contains`) |
| Push | Web Push (VAPID, `web-push`) | iPhone users must add the app to the home screen (iOS 16.4+) |
| PDF | Headless Chromium (`puppeteer-core` + `@sparticuz/chromium`) in a Vercel function | Renders the HTML certificate so Arabic shaping is correct; PDF stored once in Storage |
| Media handling | `browser-image-compression` for photos; 60 s / 100 MB cap per video | No server transcoding in v1 |
| Validation | Zod, shared between client and server |  |
| i18n | `next-intl`, single locale `ar`, no locale prefix in URLs | Strings in `messages/ar.json`, keys type-checked; i18n-ready for a second language later |
| Monitoring | Sentry (errors), PostHog (product analytics) | Free tiers |
| Hosting | Vercel (region `fra1`), Supabase (region Frankfurt) | Closest supported regions to Iraq |

Versions: Next.js 16 is decided (Oct 23, 2026). For every other tool, use the current stable release in Phase 0 and pin it in `package.json`. If Serwist or Sentry does not yet support Next.js 16 cleanly, say so before working around it. Tailwind v4 keeps theme tokens in CSS (`@theme` in `globals.css`), not in a `tailwind.config` file.

Pinned in Phase 0 (Oct 23, 2026): Next.js 16.4.2, React 19.3.1, Tailwind 4.3.3, next-intl 4.14.9, Vitest 5.0.5, Playwright 1.64.1, pnpm 10.28.0, Node 22+, Supabase CLI 2.122.0 (dev dependency), supabase-js 2.118.0, @supabase/ssr 0.12.7, Zod 4.6.7, Postgres 17. Two tools are held one major version back because Next's ESLint config doesn't support the newest yet: **TypeScript 6.0.3** (typescript-eslint supports < 6.1, and 7.0 is out) and **ESLint 9.39** (`eslint-plugin-react` doesn't support ESLint 10). Upgrade both when `eslint-config-next` does. The app keeps the Next 16.4 defaults `cacheComponents` and `partialPrefetching` on. Serwist 9.5.13 (`@serwist/next`, `@serwist/cli`, `serwist`) and esbuild 0.28.2 build the service worker; sharp 0.35.5 generates the icons.

**PWA and caching (Phase 0).** Serwist runs in its "configurator mode": `pnpm build` runs `next build && serwist build`, and the CLI bundles `src/app/sw.ts` into `public/sw.js` (git-ignored) outside the Next.js bundler. The Turbopack integration (`@serwist/turbopack`) is not used, because its route handler exports `dynamic` and `revalidate`, which Next.js rejects when `cacheComponents` is on. The worker is registered in the root layout and is off in `pnpm dev`. Caching policy:

- Cached: build files under `/_next/static` (hashed names), fonts, and the icons and brand images.
- Never cached: pages, RSC payloads, Server Actions and every cross-origin request (Supabase, Google Maps). Shared crew phones must never show another account's data, and order status must never be stale.
- Precached at install: only the offline page (`/~offline`), its CSS and the Cairo font files. A page load that fails without a network shows that page ("ماكو انترنيت" with "اعد المحاولة", which reloads the requested URL).
- Phase 5 adds the Web Push handlers to the same `src/app/sw.ts`.

One web app manifest (`src/app/manifest.ts`) covers all three surfaces: crew and admin also start at `/`, and the role picks the surface after login. Its name and description come from `messages/ar.json`, and the theme and splash color is `navy`.

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
- Icons: 24-grid, 2px stroke, round caps. Use `lucide-react` and match the canvas glyphs.
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

## 5. Customer app screens

Each designed screen below lists what changes from the canvas, how it behaves, and its states. The canvas copy (Iraqi Arabic) is final unless a change is listed. Text in \[brackets\] in the designs is sample data and comes from the database.

**Global rules for every screen:** skeleton loaders while loading; an empty state with a CTA; an error state with "اعد المحاولة"; a top offline banner "ماكو انترنيت". The tab bar shows only on Home, Tips, Notifications, Orders and Profile.

### 5.1 Welcome — `Main.dc.html`

- Shown on first open only. A logged-in user goes straight to Home.
- "ابدأ الآن" opens Login. "تصفح بدون تسجيل" opens Home in guest mode.

### 5.2 Login — `Login.dc.html`

- Input accepts `7XXXXXXXXX` or `07XXXXXXXXX`; it is stored as E.164 `+9647XXXXXXXXX`. Valid pattern: `^7[3-9]\d{8}$` after stripping a leading 0.
- Channel picker: WhatsApp (default) and SMS. **The SMS button is hidden when the admin toggle `sms_enabled` is off.**
- "أرسل الرمز" stays disabled until the number is valid.
- Errors: invalid number; too many requests ("جرب بعد X دقايق"); WhatsApp send failed, which offers SMS if enabled, otherwise "جرب مرة ثانية".
- Terms and Privacy links open the placeholder pages (N14).

### 5.3 OTP — `Otp.dc.html`

- **Change:** show the channel actually used (WhatsApp or SMS) and the real number. The design hard-codes WhatsApp.
- **Change:** replace the on-screen keypad with the system number keyboard. Keep the 6 boxes, backed by one hidden input with `inputmode="numeric"` and `autocomplete="one-time-code"`, so paste and SMS autofill work.
- Auto-submit at 6 digits. A wrong code shows "الرمز غلط، باقي X محاولات"; after 5 wrong codes the number is locked for 15 minutes.
- The resend timer runs 45 s, then offers "أعد الإرسال" and, if SMS is enabled, "أرسل برسالة SMS".
- Routing after success: a new user goes to Name (N1), then Location; a user without an address goes to Location; everyone else returns to where they were going (e.g., Booking) or to Home.

### 5.4 Location — `Location.dc.html`

- Used in onboarding and for adding or editing an address. In onboarding the back button is replaced by "بعدين", which goes to Home.
- The map moves under a fixed center pin. Search uses Places Autocomplete, restricted to Iraq and biased to Karbala. "موقعي الحالي" uses browser geolocation.
- **Change:** remove the "محلة / زقاق / دار" field. Required fields: pin, district (الحي), landmark (أقرب نقطة دالة). The district field gets full width.
- The label chips (البيت / بيت الأهل / الشغل) are kept; a label may be used once per user.
- On save, the server checks the pin against the service polygon. Outside the area: "بعد ما نخدم منطقتك، حالياً بس كربلاء", and the address is not saved.
- Location permission denied: the map stays on Karbala center and search still works.

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

### 5.6 Tips — `Tips.dc.html`

- Category chips come from the database, with "الكل" first. The top card is the admin-pinned featured article. Every item opens Article (N9).

### 5.7 Notifications — `Notifications.dc.html`

- Grouped by اليوم / قبل. Tapping an item marks it read and deep-links to its target. "قراءة الكل" marks everything read. Empty state: "ماكو إشعارات".

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

### 5.9 Booking step 1 — `Booking.dc.html`

- **Add:** an address row at the top with "تغيير", which opens N2.
- **Change (mixed tanks):** the order holds a list of tank lines. Saved tanks at the address appear as selectable cards. The design's type + size picker becomes the "أضف خزان" form, and each line has its own quantity stepper. Maximum 6 tanks per order. New tanks are saved to the address.
- Dates: the next 14 days in a horizontal scroll. Blocked dates are hidden; full days are disabled and marked "ممتلئ".
- Slots: admin-defined, each showing remaining capacity. A full slot is disabled.
- **Change:** the price label "السعر التقريبي" becomes "السعر"; prices are fixed. Total = Σ line price × qty, using the price table from the database.
- A guest tapping Book goes through login, then returns here.

### 5.10 Booking step 2 — `Upload.dc.html`

- Optional. Up to 4 files. Videos: 60 s and 100 MB maximum. Photos are compressed in the browser to about 1600 px.
- Uploads start right away, with progress, retry on failure, and remove (×). The note allows 500 characters.
- Confirming the booking waits until uploads finish. "تخطي" goes to Checkout.

### 5.11 Booking step 3 — `Checkout.dc.html`

- Summary rows link back to their step. Payment: كاش is selected; زين كاش and بطاقة are shown disabled with a "قريباً" tag.
- The breakdown lists one row per tank line, then "فحص كلور وشهادة: مجاناً", then the total.
- Active subscription with visits left: a toggle "استخدم زيارة من اشتراكك". The order is then flagged `uses_subscription`, the total shows "مشمول بالاشتراك", and the admin verifies coverage when confirming.
- **Change:** "أكّد الحجز" creates the order as `pending_confirmation` and opens Booking success (N5), not Tracking.
- The slot is re-checked on submit. If it filled up, the user sees "الموعد انحجز، اختار موعد ثاني" and returns to step 1.
- **Change (footer text):** "تكدر تلغي أو تغير الموعد لحد ساعتين قبل".

### 5.12 Orders — `Orders.dc.html`

- الحالية = `pending_confirmation`, `confirmed`, `on_the_way`, `arrived`, `in_progress`. السابقة = `completed`, `cancelled`, `no_show`.
- Primary CTA by status:
  - pending or confirmed → تفاصيل
  - on the way → تتبّع
  - arrived or in progress → تابع الشغل
  - completed → الشهادة
  - cancelled → أعد الحجز
- Tapping a card opens Order details (N4). "مساعدة" opens Chat tagged with the order. Lists load 20 at a time.

### 5.13 Tracking — `Tracking.dc.html`

- **Change:** remove the crew card (name, rating, job count, plate). The call button dials the company number from settings; the chat button opens Chat.
- The map shows the home pin and the crew's latest position, updating in real time. The design's "12 دقيقة" bubble and "يوصل حوالي" are replaced by the straight-line distance ("3.2 كم") and "آخر تحديث قبل X ثانية".
- Steps: تأكد / بالطريق / وصل / خلص, driven by the order status.
- If the location is more than 2 minutes old: "موقع الفريق ما ديتحدث هسه". The screen is available only while on the way or arrived.

### 5.14 Job progress — `LiveJob.dc.html`

- **Change:** drop the video player, the 5 fixed steps and the chlorine countdown. The screen shows:
  - a status timeline: وصل الفريق / بدأ الشغل / خلص الشغل, with times
  - a "قبل" photo gallery
  - optional clips the crew uploaded
  - a "بعد" photo gallery
- The "مباشر" badge shows only during `in_progress`. New media appears in real time. "شوف الشهادة" is enabled once the order is `completed`.

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

### 5.16 Chat — `Chat.dc.html`

- One thread per customer, answered from the admin inbox.
- **Change:** the header subtitle follows working hours. Inside hours: "نرد عادة خلال دقائق". Outside hours: "نرد بأوقات الدوام \[9 ص– 9 م\]". Off-hours messages get one automatic reply.
- Quick topics تغيير موعد / إلغاء طلب open an order picker. The message is tagged with that order and includes in-app action buttons when the 2-hour rule still allows the change. استفسار عن سعر and شكوى send directly.
- Attachments use the same limits as Upload. Message states: sending, sent, read by support (✓✓), failed with retry. Unread agent messages badge the tab icon.

### 5.17 Issue report — `Issue.dc.html`

- Categories as designed. The related order lists the user's orders from the last 90 days plus "بدون طلب". Description is required (at least 10 characters). Up to 3 files.
- Submitting creates ticket `ZL-T-####`, shows the success state as designed, and posts a system message in Chat. The promised response time is a setting.

### 5.18 Tab bar — `TabBar.dc.html`

- Tabs: الرئيسية / طلباتي / احجز (center, opens Booking) / المحادثة (unread badge) / حسابي. Tips and Notifications keep Home highlighted.

### New screens (not in the canvas; build in the same visual language)

| # | Screen | Entry | Content and rules |
| --- | --- | --- | --- |
| N1 | Name | After OTP, new users | One field "اسمك", 2–40 characters, required |
| N2 | Address list / picker (sheet) | Home header, Booking, Profile | Label, district, landmark; select, edit, delete (blocked while an active order uses it), add (opens Location), mark default |
| N3 | My tanks | Profile | Grouped by address: type, size, optional nickname, last cleaned, next due; add, edit, delete |
| N4 | Order details | Orders, Home card, notifications | Status timeline, summary, price, attachments; buttons by status: cancel, reschedule, track, progress, certificate, help |
| N5 | Booking success | After checkout | "وصلنا طلبك #1024 · بانتظار تأكيد الشركة"; a soft push-permission card; buttons to Order details and Home |
| N6 | Cancel sheet | N4, Chat | Reason (تغيرت ظروفي / الموعد ما يناسبني / شي ثاني) + confirm. Within 2 h: blocked, "راسلنا بالمحادثة" |
| N7 | Reschedule sheet | N4, Chat | Date + slot picker with the same rules as Booking; the order goes back to `pending_confirmation`; blocked within 2 h |
| N8 | Subscription | Home, Profile | Plan card: price and contents from settings (2 cleanings a year + reminders). "اطلب الاشتراك" creates a request; then a status view (requested / active / expired) |
| N9 | Article | Home, Tips | Cover, category, read time, rendered body, CTA "احجز تنظيف" |
| N10 | Edit profile | Profile | Name; "تغيير الرقم" runs OTP on the new number |
| N11 | My reports | Profile | Tickets with status مفتوح / قيد المعالجة / مغلق and a detail view; replies come in Chat |
| N12 | Certificates | Home, Profile | One card per completed order → Report |
| N13 | Settings | Profile | Language (Arabic, disabled), Terms, Privacy, delete account (confirm dialog → soft delete and anonymize personal data) |
| N14 | Terms / Privacy | Login, Settings | Markdown from settings; placeholder text at launch |
| N15 | Public certificate page `/c/[code]` | Share link, QR on PDF | No login. Certificate number, date, tank type/size, district, "شهادة صادرة من شركة زلال"; no name or phone |
| N16 | Out of area / force update / maintenance | System | Full-screen states with a support phone |

## 6. Order lifecycle

An order moves through 8 statuses. Every change goes through one Postgres function, `transition_order(order_id, to_status, payload)`. It checks who may make the change, applies the guard, writes `order_events`, and queues notifications. No client updates `orders.status` directly.

&#91;embedded content: order lifecycle · 8 statuses\]

The main path runs from booking to the certificate. Reschedule loops back to pending confirmation; the red boxes are end states.

| From → To | Who | Guard | Side effects |
| --- | --- | --- | --- |
| (new) → `pending_confirmation` | Customer | Address inside the service area; slot has capacity; uploads done | Reserve slot capacity; alert admins (dashboard sound + push) |
| `pending_confirmation` → `confirmed` | Admin | Subscription coverage verified if `uses_subscription` | Push "تأكد حجزك"; crew may be assigned now or later |
| `pending_confirmation` or `confirmed` → `pending_confirmation` (reschedule) | Customer (≥ 2 h before slot start), Admin (any time) | New slot has capacity | Release the old slot, reserve the new one; push to admins |
| `pending_confirmation` or `confirmed` → `cancelled` | Customer (≥ 2 h before slot start, reason required), Admin (any time, reason required) | — | Release slot; push to the other side |
| `confirmed` → `on_the_way` | Crew | A crew is assigned | Push "الفريق طلع لبيتك"; crew GPS sharing starts |
| `on_the_way` → `arrived` | Crew | — | Push "الفريق وصل"; GPS sharing stops |
| `arrived` → `in_progress` | Crew | At least 1 "before" photo | In-app update |
| `in_progress` → `completed` | Crew | At least 1 "after" photo; cash collected ticked (unless subscription) | Issue certificate + PDF; update `tanks.last_cleaned_at`; schedule reminder; decrement subscription visit; push "شهادتك جاهزة" |
| `confirmed`, `on_the_way` or `arrived` → `no_show` | Crew or Admin | Note required | Chat system message to the customer |
| Any → any | Admin override | Reason required | Logged as an override in `order_events` |

Rules:

- "2 hours before" is measured from the slot start in `Asia/Baghdad` time, computed on the server.
- Slot capacity is held in `slot_bookings` with a unique constraint, so two customers cannot take the last place at once.
- Rating is separate from status. A completed order can be rated once, any time later.

## 7. Data model

All tables live in Postgres with RLS on. Money is stored as integer IQD. Times are `timestamptz`, shown in `Asia/Baghdad`. Orders snapshot the address and prices, so later edits never change history.

> **Note for Claude Code: this schema is a starting point, not a contract.** The tables below show what data v1 needs and roughly how it fits together. Don't copy them column for column. Claude Code owns the final schema design: table and column names, types, enums vs lookup tables, normalization, keys, constraints, indexes and how RLS is structured. Where you see a better design (safer, simpler, faster, or easier to secure with RLS), use it.
>
> What must not change is the behavior this spec describes: the order lifecycle and its guards (section 6), the "one function changes order status" rule, slot capacity that cannot be overbooked, price and address snapshots on orders, integer IQD, RLS on every table, and the access rules below. When you depart from this table, say why in the migration (a short SQL comment) and in the PR description, then update this section so the spec matches the database.

| Table | Key columns | Notes |
| --- | --- | --- |
| `profiles` | `id` (= `auth.users.id`), `role` (customer \| crew \| admin), `full_name`, `phone`, `reminders_enabled`, `deleted_at` | Created by a trigger on signup |
| `crews` | `id`, `name` ("فريق 1"), `user_id`, `active` | One login per crew |
| `service_areas` | `id`, `name`, `polygon` (PostGIS geography) | Karbala seeded; edited in admin |
| `addresses` | `id`, `user_id`, `label` (home \| family \| work), `district`, `landmark`, `location` (point), `is_default`, `deleted_at` | Unique (`user_id`, `label`) |
| `tanks` | `id`, `user_id`, `address_id`, `type` (roof \| ground), `size` (s \| m \| l), `nickname`, `last_cleaned_at` |  |
| `price_list` | `tank_type`, `size`, `price_iqd`, `updated_by` | Primary key (type, size); 6 rows |
| `slots` | `id`, `label`, `start_time`, `end_time`, `capacity`, `weekdays` int\[\], `active` | e.g. "8–10 الصبح" |
| `blocked_dates` | `date`, `reason` | Holidays such as Arbaeen and Ashura |
| `slot_bookings` | `date`, `slot_id`, `seat`, `order_id` | Unique (`date`, `slot_id`, `seat`); seat ≤ capacity |
| `orders` | `id`, `number` (serial, shown as #1024), `customer_id`, `address_id` + snapshot (`district`, `landmark`, `location`), `date`, `slot_id`, `slot_start_at`, `status`, `crew_id`, `total_iqd`, `uses_subscription`, `subscription_id`, `payment_method` ('cash'), `cash_collected`, `customer_note`, `cancel_reason` |  |
| `order_items` | `order_id`, `tank_id`, `tank_type`, `size`, `qty`, `unit_price_iqd` | Price snapshot |
| `order_events` | `order_id`, `from_status`, `to_status`, `actor_id`, `actor_role`, `reason`, `is_override`, `created_at` | Audit trail and timeline |
| `order_media` | `id`, `order_id`, `kind` (customer \| before \| after \| clip), `media_type` (photo \| video), `path`, `duration_s`, `bytes`, `uploaded_by` |  |
| `crew_live_location` | `order_id` (PK), `crew_id`, `location`, `accuracy_m`, `updated_at` | One row per order, upserted; customers subscribe through Realtime |
| `certificates` | `id`, `order_id` (unique), `number` (ZL-1024), `public_code` (8 chars), `issued_at`, `sterilant`, `residual_chlorine_mg_l` (nullable), `next_due_at`, `pdf_path` |  |
| `ratings` | `order_id` (unique), `stars` 1–5, `tags` text\[\], `comment` | ≤ 3 stars opens a ticket |
| `tickets` | `id`, `number` (ZL-T-####), `user_id`, `order_id`, `category`, `description`, `status` (open \| in\_progress \| closed), `source` (app \| rating) |  |
| `ticket_media` | `ticket_id`, `path`, `media_type` |  |
| `chat_threads` | `id`, `user_id` (unique), `last_message_at`, `unread_admin`, `unread_user`, `assigned_admin_id` |  |
| `chat_messages` | `id`, `thread_id`, `sender_id`, `sender_role`, `kind` (text \| media \| system \| auto), `body`, `media_path`, `order_id`, `read_at` |  |
| `notifications` | `id`, `user_id`, `type`, `title`, `body`, `link`, `read_at` | The in-app list |
| `push_subscriptions` | `id`, `user_id`, `endpoint`, `p256dh`, `auth`, `user_agent` | Web Push |
| `subscriptions` | `id`, `user_id`, `status` (requested \| active \| expired \| cancelled), `price_iqd`, `visits_total`, `visits_used`, `tanks_covered`, `starts_on`, `ends_on`, `paid`, `admin_note` | Managed by hand in admin |
| `article_categories` | `id`, `name`, `sort` | Seeded |
| `articles` | `id`, `slug`, `title`, `category_id`, `cover_path`, `body_md`, `read_minutes`, `featured`, `status` (draft \| published), `published_at` | Seeded |
| `settings` | `key`, `value` (jsonb) | Keys listed below |
| `otp_requests` | `phone`, `channel`, `created_at` | Channel choice read by the Send SMS Hook; rate-limit window |
| `admin_audit_log` | `admin_id`, `action`, `entity`, `entity_id`, `diff` | Every admin write |

Settings keys: `sms_enabled`, `company_phone`, `working_hours` ({start, end, days}), `support_response_text`, `cleaning_interval_months` (6), `booking_window_days` (14), `cancel_cutoff_hours` (2), `max_tanks_per_order` (6), `sterilant_text`, `subscription_plan` ({price\_iqd, visits, tanks\_covered, description}), `terms_md`, `privacy_md`, `min_app_version`, `maintenance_mode`.

Access rules (RLS):

- A customer reads and writes only their own rows. Their order rows can be written only through RPC functions.
- A crew reads orders, media and addresses only for orders assigned to it. It writes media, live location and status, all through RPC functions.
- An admin reads and writes everything. Every admin write goes to `admin_audit_log`.

Storage buckets: `order-media`, `chat-media`, `ticket-media` and `certificates` are private, with signed URLs that last 1 hour. `public-content` (article covers) is public. Each bucket also has a size cap and a file-type allow-list (migration `storage_buckets`):

| Bucket | Public | Max size | File types |
| --- | --- | --- | --- |
| `order-media`, `chat-media`, `ticket-media` | No | 100 MB | JPEG, PNG, WebP, HEIC/HEIF photos; MP4, QuickTime (.mov), WebM videos |
| `certificates` | No | 10 MB | PDF |
| `public-content` | Yes | 5 MB | JPEG, PNG, WebP |

Until a phase adds the storage policies for its bucket (with pgTAP tests), only the service role can read or write it. Hosted projects on the Supabase Free plan cap every upload at 50 MB whatever the bucket says, so 50–100 MB videos fail there until the project is on Pro.

## 8. Crew app and admin dashboard

Neither surface has designs. Build both from the same tokens and components as the customer app, in Arabic RTL, keeping them plain and functional. A short design pass in the canvas before phase 3 is optional.

### 8.1 Crew app (`/crew`, mobile PWA)

| # | Screen | Content and rules |
| --- | --- | --- |
| C1 | Login | Same phone + OTP. A crew-role account lands on C2; any other role is refused |
| C2 | My jobs | Today and tomorrow, grouped by slot. Each card shows the order number, slot, district + landmark, tank lines, a customer-note preview, the customer media count and a status chip |
| C3 | Job detail | Map pin with "افتح بخرائط كوكل" (deep link), "اتصل بالزبون", tank lines, note, customer photos/videos, timeline |
| C3a | Status button | One large button that moves the job to its next status: طلعنا → وصلنا → بدينا الشغل (needs a before photo) → خلصنا (opens C4). A secondary action, "الزبون مو موجود", marks a no-show and needs a note |
| C3b | Media | Camera capture (`<input capture>`) for before and after photos, plus optional clips (60 s each). Uploads use a retry queue that survives a page reload |
| C4 | Finish form | Sterilant (prefilled from settings); residual chlorine mg/L (optional); "استلمنا المبلغ \[35,000 د.ع\]" checkbox (hidden for subscription orders); note. Submit completes the job |

GPS rule for v1:

- While a job is `on_the_way`, the crew app runs `watchPosition` and sends a position at most every 15 s. It keeps the screen awake with the Wake Lock API and shows "خلي التطبيق مفتوح لحد ما توصلون".
- A PWA cannot send GPS from the background. That is the main known limitation, and the reason a native crew app may be needed later.

### 8.2 Admin dashboard (`/admin`, desktop-first)

| # | Screen | Content and rules |
| --- | --- | --- |
| A1 | Overview | Today's orders by status; pending confirmations (sound + push alert); unread chats; open tickets; subscription requests |
| A2 | Orders | Table with filters (status, date, district, crew) plus a date × slot board that shows capacity. The order drawer shows details, customer media, the timeline and admin notes. Actions: confirm, cancel (reason), reschedule, assign crew, verify subscription, override status (reason) |
| A3 | Live map | Crews currently on the way, with their order |
| A4 | Chat inbox | Threads sorted by last message, unread first. The conversation pane shows order tags, attachments and canned replies. A side panel shows the customer's orders, addresses, subscription and tickets |
| A5 | Tickets | List and detail; status open → in progress → closed; internal note; jump to chat |
| A6 | Customers | Search by phone or name; profile with orders, addresses, tanks, subscription and tickets |
| A7 | Subscriptions | Request queue → "فعّل" (start date, end = start + 12 months, visits, tanks covered, paid tick); active list; "expiring in 30 days" list; manual visit adjustment |
| A8 | Prices | Edit the 6 price cells (roof/ground × s/m/l) |
| A9 | Schedule | Slots (time, capacity, weekdays, active) and a calendar of blocked dates |
| A10 | Crews | Create a crew (name + phone), activate or deactivate |
| A11 | Content | Articles: markdown editor with preview, cover upload, category, featured, draft or publish. Categories with sort order |
| A12 | Ratings | List with a star filter and the average; a link to any ticket it opened |
| A13 | Settings | SMS fallback toggle; company phone; working hours; response text; cleaning interval; booking window; cancel cutoff; subscription plan; Terms/Privacy markdown; service area polygon editor on a map; maintenance mode |
| A14 | Admins | Invite or remove admins by phone |

## 9. OTP, notifications and integrations

### 9.1 OTP delivery

Supabase Auth generates and checks the code. Our [Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook) only delivers it. The hook payload carries `user.phone` and `sms.otp` but no channel, so the channel the user picked is saved first.

1. Login screen → Server Action `requestOtp(phone, channel)`. It validates the number, applies our rate limit (3 sends per 10 minutes, 10 per day per phone), writes `otp_requests`, then calls `supabase.auth.signInWithOtp({ phone })`.
2. Supabase calls the hook, an Edge Function `send-otp` that verifies the hook signature. It reads the latest `otp_requests` row for that phone:
   - Channel `whatsapp`: send through [OTPIQ](https://otpiq.com/) `POST /sms` with `provider: "whatsapp"`, `smsType: "verification"`.
   - Channel `sms` and `sms_enabled` on: send through the SMS provider (your Iraqi SMS provider, behind an `SmsSender` interface; OTPIQ SMS works as a second implementation).
   - WhatsApp call fails right away and `sms_enabled` is on: retry once over SMS, and record `channel_used`.
3. OTP screen → Server Action `verifyOtp(phone, code)` → `supabase.auth.verifyOtp`. Failures are counted in `otp_requests`; the 5th failure locks the phone for 15 minutes.
4. Supabase Auth settings: OTP length 6, expiry 300 s.

To do before launch: connect the WhatsApp Business number in OTPIQ and get the Arabic authentication template approved. Put API keys only in Supabase secrets.

### 9.2 Notifications

Every event writes a `notifications` row (the in-app list) and sends Web Push to all of that user's `push_subscriptions`. A database trigger on insert calls the Edge Function `send-push`. An endpoint that answers 410 is deleted. Admins get push alerts plus a sound in an open dashboard.

| Event | To | Message (Arabic copy in the app) | Opens |
| --- | --- | --- | --- |
| Booking created | Admins | New booking #N, slot | A2 order |
| Booking confirmed | Customer | تأكد حجزك · \[date slot\] | N4 |
| Cancelled or rescheduled | The other side | Cancelled / new time | N4 or A2 |
| Crew assigned | Crew | New job #N | C3 |
| On the way | Customer | الفريق طلع لبيتك | Tracking |
| Arrived | Customer | الفريق وصل | Job progress |
| Completed | Customer | شهادة التعقيم جاهزة | Report |
| No-show | Customer | ما لكينا أحد بالبيت | Chat |
| Chat message | Customer or admins | First 80 characters | Chat or A4 |
| Ticket created or updated | Admins / customer | Ticket number + status | A5 or N11 |
| Cleaning reminder | Customer (if `reminders_enabled`) | 7 days before due, and on the due date | Booking |
| Subscription requested / activated / expiring in 30 days | Admins / customer / customer |  | A7 or N8 |

The reminder cron runs daily at 10:00 Baghdad time and never sends the same reminder twice.

Push permission: ask with an in-app card on Booking success (N5), never on first open. On iPhone, the card first explains "أضف التطبيق للشاشة الرئيسية", because Safari only allows web push from an installed app.

### 9.3 Other integrations

- Google Maps: one browser key restricted to the app's domains. It enables Maps JavaScript API and Places API (New). The server checks addresses against `service_areas` with PostGIS, with no Google call. No reverse geocoding in v1.
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

### 10.2 Seed data (`supabase/seed.sql`)

| Item | Seed value | Source |
| --- | --- | --- |
| Prices, roof s / m / l | 25,000 / 35,000 / 50,000 IQD | `Booking.dc.html` script |
| Prices, ground s / m / l | 60,000 / 80,000 / 120,000 IQD | `Booking.dc.html` script |
| Size labels | لحد 1,000 لتر / 1,000–2,000 / أكبر | Booking design |
| Slots | 8–10 الصبح, 10–12 الظهر, 4–6 العصر; capacity 2 each; Sat–Thu | Booking design; capacity is a placeholder |
| Service area | Karbala city polygon, drawn in A13 before launch | Placeholder rectangle in the seed |
| Article categories | صحة, نصائح, الصيف, أسئلة شائعة | Tips design + 1 |
| Subscription plan | 2 visits / 12 months, 1 tank, price \[YOUR PRICE\] | To be set by you |
| First admin | Your phone number, via `ADMIN_PHONE` env | — |

Seeded articles. Claude Code drafts the bodies in Iraqi Arabic, 300–500 words each; you review them before launch, especially health statements.

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
- Delete customer-uploaded booking videos 90 days after completion. Keep before/after photos and certificates.
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
  supabase/functions/       # send-otp, send-push, reminders
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
- [ ] Base UI kit: Button, IconButton, Chip, Card, Input, Sheet, TabBar, Stepper, Skeleton, EmptyState
- [ ] Vercel project, preview deploys, Sentry, PostHog; GitHub Actions running lint, typecheck and tests
- [ ] Claude Code setup from `docs/claude-code-setup.md`: SessionStart hook, `.claude/settings.json` hooks, guard scripts (no raw hex, no left/right), project skills; fill in the Commands section of CLAUDE.md

* Done when: an empty app installs to the home screen on Android and iPhone and renders the Welcome screen pixel-close to `Main.dc.html`

**Phase 1 — Accounts and addresses**

- [ ] Schema: profiles, settings, otp\_requests, service\_areas, addresses, tanks; RLS
- [ ] `send-otp` Edge Function (OTPIQ WhatsApp + SMS sender interface + admin toggle)
- [ ] Screens: Welcome, Login, OTP, Name (N1), Location, address list/picker (N2), My tanks (N3); guest mode

* Done when: a real Iraqi number logs in over WhatsApp; turning `sms_enabled` off hides SMS; a pin outside Karbala is refused

**Phase 2 — Booking**

- [ ] Schema: price\_list, slots, blocked\_dates, slot\_bookings, orders, order\_items, order\_events, order\_media; `create_order` + `transition_order` RPC
- [ ] Screens: Booking 1–3, Upload with resumable upload, Booking success (N5), Orders, Order details (N4), Cancel (N6), Reschedule (N7); Home with live cards

* Done when: two parallel bookings cannot overbook the last seat (test); cancelling at 1 h 59 min is refused

**Phase 3 — Admin core and crew app**

- [ ] Admin shell + A1, A2 (confirm, assign, cancel, reschedule, override), A8, A9, A10, A13, A14; admin audit log
- [ ] Crew app C1–C4 with media capture, retry queue and GPS sharing

* Done when: the whole path booking → confirm → assign → on the way → arrived → in progress → completed runs across three devices

**Phase 4 — Live job and certificate**

- [ ] Tracking (Realtime crew location), Job progress (Realtime media), A3 live map
- [ ] Certificates: record on completion, print route, PDF via Chromium, public page N15, Report screen, rating + auto-ticket

* Done when: the PDF renders Arabic correctly, its QR opens N15, and a 2-star rating creates a ticket

**Phase 5 — Communication**

- [ ] Chat (customer) + A4 inbox with Realtime, attachments, order tags, working-hours auto-reply
- [ ] Issue report + My reports (N11) + A5 tickets
- [ ] Notifications: table, in-app list, Web Push (`send-push`), soft permission card, reminders cron

* Done when: every event in 9.2 arrives as push on an installed Android and iPhone PWA

**Phase 6 — Content, subscription, polish**

- [ ] Articles + categories + A11 editor + seeded articles; Tips and Article (N9)
- [ ] Subscription: N8 request, A7 management, checkout toggle, visit decrement
- [ ] Profile, Edit profile (N10), Certificates (N12), Settings (N13) with account deletion, Terms/Privacy placeholders (N14), N16 states
- [ ] QA pass: empty/error/offline states, accessibility (labels, 44 px targets, contrast), Lighthouse PWA ≥ 90, media retention job

* Done when: the launch checklist passes

### 12.4 Launch checklist

- [ ] Prod Supabase project moved to Pro (Free caps uploads at 50 MB and pauses idle projects); set its global upload limit to at least 100 MB (Storage settings)
- [ ] Domain bought and connected; Google Maps key restricted to it
- [ ] OTPIQ WhatsApp number connected and template approved; SMS provider credentials in secrets
- [ ] Karbala polygon drawn; prices, slots, capacity and subscription price set
- [ ] Terms and Privacy text replaced; stamp image uploaded
- [ ] Seeded articles reviewed
- [ ] Admin and crew accounts created; crews trained on the PWA (keep it open while driving)

## 13. Open items

These are assumptions made while writing the spec. Each has a working default, so none blocks Phase 0–2; settle them before the phase noted.

- [ ] **Job media (before Phase 3):** answers 43 and 44 were read together as "before and after photos required, per-step clips optional". Confirm.
- [ ] **Residual chlorine (before Phase 3):** kept as an optional crew field that shows on the certificate only when filled. Keep it or remove it?
- [ ] **Crew calls the customer (before Phase 3):** the crew app has "اتصل بالزبون" from the company-owned crew phone, to help find the house. OK?
- [ ] **No-show policy (before Phase 3):** no fee or block in v1, only a status and a chat message. OK?
- [ ] **Subscription details (before Phase 6):** price, number of tanks covered, and whether one visit covers a multi-tank order.
- [ ] **Operations (before Phase 2):** slot capacity (seeded as 2), working days (seeded Sat–Thu, Friday closed), support hours (seeded 9 AM–9 PM).
- [ ] **SMS provider (before Phase 1):** name and API docs of your Iraqi SMS provider.
- [ ] **Districts (before Phase 1):** free text as designed, or an admin-managed list of Karbala districts for cleaner data?
- [ ] **Media retention (before Phase 6):** delete booking videos 90 days after completion?
- [ ] **Certificate identity (before Phase 4):** company legal name, stamp/signature image, phone for the footer.
- [ ] **Crew and admin designs (optional, before Phase 3):** design them in the canvas first, or let Claude Code build them from the kit?
