# Phase 6, task 3: Profile, N10, N12, N13, N14, N16

Plan for spec §12.3 "Profile, Edit profile (N10), Certificates (N12), Settings (N13) with account deletion, Terms/Privacy placeholders (N14), N16 states". Branch `claude/phase6-task3-profile` from `origin/main` after PR 28. This file is deleted when the task ships, and its settled answers move into the spec.

Open questions are at the end (§9). Each has a recommended default listed first. Nothing is built until they are answered.

## 1. Findings

- **Profile** (`src/app/(customer)/profile/page.tsx`) has the name, phone, subscription cards, and the rows عناويني, خزاناتي and بلاغاتي, plus logout. Still missing: "تعديل", طرق الدفع, شهادات التعقيم, الإعدادات, the reminder toggle and the "مركز المساعدة وتواصل معنا" row. The canvas puts the toggle last in the rows card, and help and logout together in a second card.
- **Home** (`src/app/(customer)/page.tsx`) has the header, bell, cards and tips strip. The quick actions row from the canvas is not built: 4 tiles (58 px white squares with an 18 px radius, a chip border and a 26 px teal glyph, and a 12 px label), in the order اشتراك سنوي (star), شهاداتي (shield-check), راسلنا (message-square), بلّغ عن مشكلة (triangle-alert). It sits between the tank card and the tips strip.
- **Terms and Privacy** (`src/components/layout/legal-page.tsx`) show `settings.terms_md` / `privacy_md` as plain paragraphs. When the text is empty they show an empty state, and Back always goes to Login. `MarkdownText` (from Phase 6, task 1) is ready to reuse.
- **Accounts:**
  - `profiles.deleted_at` exists and is honoured in many places: `current_user_role()` returns null, `getViewer()` returns null, `verifyOtp` answers `account_unavailable`, and notifications, crew contact and reminders all skip deleted accounts.
  - Nothing sets `deleted_at` yet, and nothing anonymizes anything.
  - `profiles.phone` is `not null unique`, so as things stand a deleted phone could never sign up again.
  - `orders`, `chat_threads`, `chat_messages` and `certificates`… reference `profiles` with `on delete restrict`, so the soft delete is required.
- **Auth guard:** the Auth admin API's own soft delete writes a hashed email, which `guard_auth_user` refuses (its migration comment says N13 must delete through its own RPC). The trigger `on_auth_user_phone_changed` already copies a new `auth.users.phone` into `profiles.phone`, and the guard doesn't watch `phone`.
- **Phone login:** `verifyOtp` signs in with a password derived from the user id, not the phone. So after a phone change the user keeps the same password and sessions, and simply signs in with the new number.
- **Certificates:** the print page and PDF carry the customer's name, the district, the landmark and a masked phone (§10.1). The public page N15 carries none of these. `loadCertificate` reads one certificate and there is no list query yet. N12 can be built on the existing RLS (customers read their own certificates and orders), with no schema change.
- **Push:** the logout button calls `forgetPush()` for this browser only. Push subscriptions have no API access. They are reached only through `save_push_subscription` / `delete_push_subscription`.
- **Settings:** `min_app_version` (`0.0.0`) and `maintenance_mode` (off) exist. `admin_update_settings` already accepts any column, so A13 needs only UI. `package.json` version is `0.1.0`, and nothing reads it yet.
- **Kit:** `Switch` (from task 2) gives Profile its toggle. `Sheet` gives the confirmations. `EmptyState`, `Skeleton`, `BackButton` and `Card` are reused as they are.
- **Next free error code:** `ZL039`.

## 2. Schema and RLS (one migration, `account_deletion`)

### 2.1 `profiles`
- **`phone` becomes nullable**, with the check `phone is not null or deleted_at is not null`. Departure from §7: a deleted account keeps no phone, so the number is free for a new signup (Q5). The Iraqi-mobile check stays for non-null values. Generated types turn `phone` into `string | null`. Every admin view then shows "حساب محذوف" when the phone is null. That is about 40 files that read a phone; most only read their own live profile, so a narrowing helper covers them.
- `reminders_enabled` already has a column grant. Profile's toggle writes it through a Server Action under the user's RLS.

### 2.2 RPCs
| RPC | Who | What | Errors |
| --- | --- | --- | --- |
| `delete_account()` | customer (authenticated, own) | One transaction; the steps are in §2.3. Returns the certificate PDF paths it detached, for the server to delete from Storage. | `42501` not a customer (crew/admin/deleted), `ZL039` `account_has_open_orders` (Q6) |
| `change_login_phone(p_user_id, p_phone)` | `service_role` only | Locks the profile, refuses a phone held by a live account, sets `auth.users.phone` (and `phone_confirmed_at`), and the trigger copies it. Customers only. | `ZL040` `phone_taken`, `22023` `invalid_phone`, `P0002` `account_not_found`, `42501` for a staff account |
| `delete_my_push_subscriptions()` | authenticated, own | Deletes every push subscription of the caller (log out on all devices, Q1). | none |
| (Q4) trigger `private.guard_subscribed_address` | — | Refuses changing `lat`/`lng` of an address whose subscription is requested or active. | `ZL041` `address_subscribed` |

The steps are written test-first in pgTAP, with every role including anon.

### 2.3 What `delete_account()` does (the defaults; Q5–Q8 can change them)
1. Refuses if an order is `pending_confirmation` … `in_progress` (`ZL039`, Q6).
2. `profiles`: `deleted_at = now()`, `full_name = null`, `phone = null`, `reminders_enabled = false`.
3. `auth.users`: `phone = null`, `banned_until = 'infinity'`. It also deletes the user's `auth.sessions` and `auth.refresh_tokens`, so every device is signed out at once. The `auth.identities` phone row is deleted. This is done in SQL rather than through the admin API, so it is all one transaction. The guard isn't touched, because no email is written.
4. Addresses: soft-deleted. `landmark` is replaced by a neutral marker and the pin is rounded to 2 decimals (about 1 km), which keeps area stats without pointing at the house. Their tanks are deleted (as `delete_address` does).
5. Orders stay, as company records: number, dates, slot, tanks, prices, cash and status. The address copy is anonymized like the address. `customer_note` is cleared. `order_media` rows are deleted, so the nightly `media-cleanup` removes the files as unattached.
6. Certificates: the row stays, because the public page N15 shows nothing personal and a printed QR keeps working. `pdf_path` is cleared and the paths are returned for the server to delete (the PDF has the name and phone).
7. Ratings: the stars stay and the comment is cleared.
8. Tickets, ticket media and ticket notes: deleted (Q8). The rows' files are removed by the nightly cleanup.
9. Chat: the thread is deleted with all its messages, and the files are removed by the nightly cleanup (Q2).
10. Subscriptions: a requested one becomes `cancelled`. An active one is `cancelled` with the internal reason "account deleted", and admins are notified (A7 shows it under ended).
11. Notifications and push subscriptions: deleted.
12. Nothing goes to `admin_audit_log`, since it isn't an admin action. A row in a new `account_deletions` table (id, deleted_at, counts only) is optional; I recommend not adding one.

Departures to note in the migration and in §7:
- `profiles.phone` nullable.
- Address and order snapshots anonymized in place.
- `orders.customer_note` cleared.
- `ratings.comment` cleared.

`orders.landmark` keeps its 2–120 check, so the marker is a fixed Latin token (`-deleted-`), which the app shows as "—". No Arabic is stored.

### 2.4 RLS
- No new tables, unless an `account_deletions` table is wanted.
- A deleted account already can't read anything: its sessions are gone, it is banned, and `current_user_role()` returns null. pgTAP still proves that every customer table returns nothing to it if a token survives (an access token lives up to 1 h).
- The rls-auditor runs after the migration. It checks in particular that `delete_account` can't be pointed at another user, that `change_login_phone` is unreachable from the API, and that a stolen session can't use `delete_my_push_subscriptions` to touch anyone else's rows.

## 3. Server code

- `src/lib/account/` holds `deleteAccount()` (a Server Action: RPC, then delete the PDFs with the admin client, then `signOut({ scope: "local" })`, then redirect to Welcome) and `logoutEverywhere()` (`signOut({ scope: "global" })` plus `delete_my_push_subscriptions`, then Welcome).
  - Both are called from client components that first run `resetAnalytics()`, `forgetPush()` and `clearMediaQueue()`, like `LogoutButton`.
- Phone change goes in `src/lib/otp`, the only place phone codes live. It adds `requestPhoneChangeOtp` and `verifyPhoneChange`, which reuse `request_otp` / `check_otp` and the senders, and then call `change_login_phone` instead of signing in. The pending number goes in an httpOnly cookie (like `pending-login`), never the URL. With Q3's default, the current number gets a code first, and only then the new number.
- A refused new number returns `phone_taken`. Asking for the user's own number again is refused before any code is sent.

## 4. Screens (each with its loading, empty, error and offline states)

| Screen | Route | Contents | States |
| --- | --- | --- | --- |
| Profile | `/profile` | The canvas: "تعديل" link (N10). The rows card: عناويني, خزاناتي, طرق الدفع (read-only "كاش · الدفع الإلكتروني قريباً", no chevron), شهادات التعقيم (count, to N12), بلاغاتي, الإعدادات (N13), and "تذكير بموعد التنظيف" with `Switch` (optimistic, reverts with a toast on failure). A second card holds "مركز المساعدة وتواصل معنا" (Chat) and logout. | Skeleton as today; error via `error.tsx`; offline banner; nothing empty (the rows always show) |
| Edit profile N10 | `/profile/edit` | Name field (N1's rules and schema, prefilled) with "حفظ". The phone (ltr) with "تغيير الرقم". Back to Profile, no tab bar. | Skeleton; save error inline; offline disables save |
| Change phone | `/profile/phone`, `/profile/phone/verify` | Login's phone field and channel buttons, then OTP's code screen, reused as components. With Q3: step 1 is the code to the current number, step 2 the new number and its code. Success returns to N10 with a toast "تغيّر رقمك". | Errors from the OTP flow, plus `phone_taken` and "same number" |
| Certificates N12 | `/profile/certificates` | One card per completed order with a certificate, newest first: certificate number, service date, district, tanks summary and next due date. Each opens Report (`routes.certificate(orderId)`). | Skeleton cards; empty: "ماكو شهادات بعد" + "احجز تنظيف"; error; offline |
| Settings N13 | `/profile/settings` | Language "العربية" (disabled, with a note "لغات ثانية قريباً"), شروط الاستخدام, سياسة الخصوصية, "سجّل خروج من كل الأجهزة" (Q1, confirm sheet), "احذف حسابي" (danger, opens §4.1), and the app version at the bottom. | Static, no data, apart from the version |
| Terms / Privacy N14 | `/terms`, `/privacy` | Rendered with `MarkdownText`. Back goes to `?from=` (`settings` or `login`, through a whitelist), defaulting to Login. Empty text shows placeholder copy from ar.json (Q9) instead of the empty state. | Skeleton; error; offline |
| Home quick actions | `/` | The canvas row of 4 tiles, linking to N8, N12, Chat and Issue, for logged-in customers only (Q10). | Part of Home's skeleton |
| N16 out of area | Location | Full-screen state when the first address in onboarding is outside the area (Q11): illustration, "بعد ما نخدم منطقتك، حالياً بس كربلاء", support phone (tap to call, hidden while unset), "غيّر الموقع" back to the map. Outside onboarding the inline message stays. | — |
| N16 maintenance | customer surface | When `maintenance_mode` is on, a full-screen "التطبيق بالصيانة" with the support phone, for customers and guests. Crews and admins work as usual (Q12). Read in the customer layout through a cached settings read (`use cache`, a short life, and a revalidated tag when A13 saves). | — |
| N16 force update | every surface | A client check: the build's version (`NEXT_PUBLIC_APP_VERSION` from `package.json`, set at build) against `settings.min_app_version`, on start and when the app returns to the foreground. If lower, a full-screen "حدّث التطبيق" whose button updates the service worker and reloads. | — |
| A13 | `/admin/settings` | A new section, "التطبيق": maintenance mode (Switch with a confirm), and the minimum app version (x.y.z, with the current version shown next to it). | As the other sections |

### 4.1 Delete account flow (N13)
1. The sheet lists what goes and what stays, in plain words: "نمسح اسمك ورقمك وعناوينك ومحادثاتك وبلاغاتك. طلباتك وشهاداتك تبقى عند الشركة بدون معلوماتك".
2. With an open order it shows `ZL039` up front, from the server's answer at page load and again from the RPC, with a link to Orders.
3. "احذف حسابي" (danger), then a second confirmation step in the same sheet ("متأكد؟ ما نكدر نرجعه").
4. On success, a full page load to Welcome with a toast "انحذف حسابك".

## 5. Tests

- **pgTAP:**
  - `delete_account.test.sql`: every step in §2.3, plus anon, customer, other customer, crew, admin and deleted-account callers, `ZL039`, and that the user's tables read empty for a lingering token.
  - `change_login_phone.test.sql`: only `service_role` may call it, `ZL040`, a staff account is refused, and the profile copies the phone.
  - `push_subscriptions` additions for `delete_my_push_subscriptions` (own rows only).
  - `profiles` check: phone null only when deleted.
  - Q4's trigger (if kept): customer refused, district and landmark still editable, admin path.
  - `rls_audit_private_execute` stays green.
- **Integration (real Auth):**
  - Delete, then the old session's refresh fails and the access token reads nothing.
  - The same phone signs up again as a new, empty account.
  - The full phone-change flow: the old number no longer logs in, the new one reaches the same account, and a taken number is refused.
  - The global logout ends a second session.
- **Unit:** the phone-change service with fake senders, the version comparison, and the `from` whitelist.
- **e2e (390×844):**
  - Profile rows and the toggle persisting.
  - Edit name.
  - Phone change through the outbox.
  - N12 list with `createCertificate` and the empty state.
  - Settings: Terms and Privacy render Markdown and Back returns to Settings.
  - Delete account, including blocked by an open order; then login with the same phone shows Name (N1).
  - Logout everywhere.
  - Home quick actions.
  - Maintenance on (customer sees N16, admin doesn't).
  - Force update (`min_app_version` above the build).
  - Out of area in onboarding.
  - A13's new section (1280×800).
  - Helpers: `setSettings()` already exists in `tests/e2e/helpers/supabase.ts`; I'll reset the two settings in `afterEach`, because maintenance is global. Those tests then run serially in their own file, so they can't hit parallel tests.
- **Screenshots** of Profile and Home at 390×844, compared with the PNGs.

## 6. Docs to update
- **spec:**
  - §1 decision 12 (phone change with two codes, if Q3 holds), §5.5 (quick actions built), §5.8 (built), N10, N12, N13, N14 and N16 ("Built" notes).
  - §7: `profiles.phone`, the RPCs, the deletion rules, the address trigger.
  - §8.2: A13 "التطبيق", and A6 per Q13.
  - §9.1: phone change, as built. §9.2: logout everywhere clears push.
  - §12.3: tick the task. §13: settle the items in Q1, Q2, Q4, Q13 and the deletion rules.
- `supabase/CLAUDE.md`: ZL039–ZL041, the new RPCs, and the deletion rule ("a new table holding personal data adds itself to `delete_account`").
- `CLAUDE.md`: any new e2e helper (`deleteAccount`?) and the `NEXT_PUBLIC_APP_VERSION` note. The rule for bumping `package.json` version when a release needs `min_app_version` goes in `docs/deploy-setup.md`.
- `.env.example`: nothing new (the version comes from `package.json` at build).

## 7. Order of work (commits)
1. pgTAP tests (fail), then migration `account_deletion`, then `db:types`, then the rls-auditor.
2. Phone change in `src/lib/otp`, plus unit and integration tests.
3. Profile rows and toggle, N10 and phone change, N12, N13 with deletion and logout everywhere, N14.
4. Home quick actions.
5. N16 (maintenance, force update, out of area) and the A13 section.
6. e2e, screenshots and docs.

## 8. Risks
- Making `profiles.phone` nullable touches many typed reads. Admin screens need a "حساب محذوف" fallback everywhere a customer shows: A1, A2, A4, A5, A7, A12 and the audit log.
- Writing `auth.users`, `auth.sessions` and `auth.refresh_tokens` from SQL depends on Auth's schema. The integration test pins it, and the hosted projects run the same Auth version as local through the CLI.
- An access token outlives a global logout or a deletion by up to 1 h. RLS already returns nothing to a deleted account, and a logged-out-everywhere token stays valid until it expires. That is accepted (as §13 does today).

## 9. Open questions (recommended default first)

1. **Log out on all devices (§13 "Push after a session ends").** (a) Yes, a row in N13: a global sign-out plus deleting all of the user's push subscriptions. (b) No; keep it accepted for v1.
2. **Chat after deletion (§13).** (a) Delete the thread, its messages (staff replies included) and its files. (b) Keep the thread for support history but clear the customer's text and files. (c) Keep it as is, readable by admins.
3. **Phone change verification.** Decision 12 says "phone change = new OTP". But a stolen session could then move the account to the thief's number, which would lock the owner out for good. (a) A code to the current number, then a code to the new number. Someone who lost their old number makes a new account; there is no admin tool in v1. (b) The new number only, as written.
4. **Moving a subscribed address (§13).** (a) Refuse moving the pin while the address's subscription is requested or active (`ZL041`); district and landmark stay editable. (b) Keep it accepted for v1, as today. (c) Allow it but show the address's edits in A7.
5. **The Auth user and re-signup.** (a) Ban the Auth user, clear its phone and end its sessions. The profile becomes an anonymous shell, and the same phone can later sign up as a brand-new, empty account. (b) Same, but the phone stays blocked (it can never sign up again). (c) Hard-delete the Auth user. That is not possible while orders reference the profile, so it would mean moving orders to a placeholder "deleted customer" profile.
6. **Open orders at deletion.** (a) Refuse while any order is pending … in progress (`ZL039`), and the customer cancels first, or asks in Chat inside the 2 h cutoff. (b) Cancel the open ones automatically (but not inside the cutoff, and not once the crew is on the way).
7. **Orders, addresses and certificates.** (a) Keep orders and certificate rows as company records: anonymize the address copy (landmark removed, pin rounded to about 1 km, district kept), clear the order note and rating comment, delete the order media, and delete the certificate PDFs (they print the name and phone). The public N15 page keeps working. (b) Keep everything except name and phone. (c) Remove orders entirely. That loses business history and slot records.
8. **Tickets.** (a) Delete the customer's tickets with their files and notes. (b) Keep them for complaint stats, with the description cleared. That would make `description` nullable, a departure.
9. **N14 placeholder text.** (a) While `terms_md` / `privacy_md` are empty, show a short placeholder from ar.json ("هذه الصفحة قيد الإعداد…" plus the company phone when set); nothing is written to the database, and the owner replaces it in A13 before launch (§12.4). (b) Seed placeholder Markdown into settings with a migration that skips non-empty values.
10. **Home quick actions for guests.** (a) Logged-in customers only, since guests already get the price list, and 3 of the 4 tiles need a login. (b) Show them to guests too, going through login.
11. **N16 "out of area": where.** (a) A full-screen state only when the first address in onboarding is outside the area (the moment a new user learns we can't serve them), with "غيّر الموقع". Later addresses keep the inline message. (b) Every time Location refuses a pin. (c) Keep the inline message only and drop the full-screen state.
12. **Maintenance mode: who it stops.** (a) Customers and guests see N16 on every customer screen; crews and admins keep working (jobs in progress); there is no database refusal (it's an operations switch, not a business rule). (b) It also stops crews. (c) `create_order` also refuses during maintenance (a new `ZL` code).
13. **A6 Customers (§13).** (a) Out of v1: A4's panel and A7's search cover it, and the spec moves A6 to a v2 note. (b) The QA pass. (c) This task, as a search plus a read-only profile page.
14. **Force update.** (a) Compare the build's `package.json` version with `min_app_version` on every surface. The owner bumps the version for a release that must reach everyone, and then raises the setting in A13. (b) Drop force update from v1: Vercel serves new code on the next navigation, and the service worker updates itself.
15. **Account deletion for staff.** (a) Customers only (crews have no N13, and admins are removed in A14). (b) Also let an admin delete their own account.
