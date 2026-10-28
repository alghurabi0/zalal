# Phase 6, task 2: Subscription — plan

Spec §12.3: "Subscription: N8 request, A7 management, checkout toggle, visit decrement". Decision G (§1): the customer requests it in the app; admins activate it and track visits by hand. No online payment (§1 out of scope): the subscription is paid outside the app and ticked "paid" in A7.

Status: **draft, waiting for the owner's answers to the open questions (end of file).** Nothing is built yet. Each question has a recommended default, listed first; the plan below assumes those defaults.

## 1. Findings

What the spec says, and what is already in the code.

- **§1, decision G, out of scope.** "Annual subscription in a simple, manually run form." No payments in the app, no promo codes. Subscription payment happens off the app.
- **§5.5 Home.** Quick action "اشتراك سنوي" → N8. Settled Oct 28, 2026 (task 1): the quick actions come as **one row with task 3**, when N12 exists. So this task adds no Home entry; N8 is reached from Profile (and later Home).
- **§5.8 Profile.** Subscription card with 4 states: none (CTA to N8), requested ("طلبك قيد المراجعة"), active (visits left, next visit, expiry), expired (renew CTA). The canvas (`Profile.dc.html`, `png/Profile.png`) draws only the active state: a navy card, "الاشتراك السنوي", an aqua "فعّال" pill, and three columns "الزيارات المتبقية 1 من 2", "الزيارة الجاية [نيسان 2027]", "ينتهي [تشرين 2027]" (month and year). Profile today is the Phase 1 shell (`src/app/(customer)/profile/page.tsx`); the rest of Profile is task 3, but the card belongs to this task.
- **§5.11 Checkout.** "Active subscription with visits left: a toggle 'استخدم زيارة من اشتراكك'. The order is then flagged `uses_subscription`, the total shows 'مشمول بالاشتراك', and the admin verifies coverage when confirming." The canvas has no toggle (`png/Checkout.png`), so it is built in the same visual language (a card between payment and the breakdown). `confirm-step.tsx` sends `expectedTotal`; `create_order` refuses a different total with `ZL018`.
- **N8.** Plan card: price and contents from settings ("2 cleanings a year + reminders"). "اطلب الاشتراك" creates a request; then a status view (requested / active / expired). Not in the canvas.
- **§6.** `pending_confirmation → confirmed`: "Subscription coverage verified if `uses_subscription`". `in_progress → completed`: "Cash collected ticked (unless subscription) … decrement subscription visit". `transition_order` (latest in migration `certificates`) always requires `cash_collected` and has a "Phase 6" comment there. C4 (`src/app/crew/jobs/[id]/job-actions.tsx`) always shows the cash tick.
- **§7.** `subscriptions`: `id`, `user_id`, `status` (requested | active | expired | cancelled), `price_iqd`, `visits_total`, `visits_used`, `tanks_covered`, `starts_on`, `ends_on`, `paid`, `admin_note`. Setting `subscription_plan` ({price_iqd, visits, tanks_covered, description}). `orders.uses_subscription` and `subscription_id` "come with subscriptions in Phase 6". §3 lists a "subscription expiry" job. §10.2: plan "2 visits / 12 months, 1 tank, price [YOUR PRICE]".
- **§8.2.** A1: subscription requests (a "coming soon" card today, `src/app/admin/page.tsx`). A2: "verify subscription" action ("waits for Phase 6"). A4 panel: subscription ("subscriptionLater" today, `customer-panel.tsx`). A6: profile with subscription, **but A6 (Customers) is in no §12.3 task and isn't built.** A7: request queue → "فعّل" (start date, end = start + 12 months, visits, tanks covered, paid tick); active list; "expiring in 30 days" list; manual visit adjustment. A13: subscription plan ("waits for Phase 6").
- **§9.2.** "Subscription requested / activated / expiring in 30 days → Admins / customer / customer, opens A7 or N8." The copy isn't written yet.
- **§13.** "Subscription details (before Phase 6): price, number of tanks covered, and whether one visit covers a multi-tank order." Open.
- **Code.** `admin_update_settings(patch)` takes any `settings` column, so the plan needs only new columns plus the A13 section. Notifications follow `supabase/CLAUDE.md` (new `notification_type` values, audience, ar.json `Notifications.items`, `describeNotification` / `notificationHref`). The last error code in use is `ZL033`.

## 2. Schema and RLS

One migration, `subscriptions` (made with `supabase migration new subscriptions`).

### 2.1 Types

- `subscription_status` enum: `requested`, `active`, `declined`, `cancelled`.

### 2.2 `subscriptions`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid PK | |
| `user_id` | uuid → profiles | the customer |
| `status` | `subscription_status` | |
| `requested_at` | timestamptz | `now()` |
| `price_iqd` | integer, null until activated | > 0; the plan price when activated, editable in the "فعّل" form |
| `visits_total` | smallint, null until activated | 1–12 |
| `tanks_covered` | smallint, null until activated | 1 – `max_tanks_per_order` |
| `starts_on`, `ends_on` | date, null until activated | `ends_on` = `starts_on` + 12 months − 1 day, set by the RPC (check) |
| `visits_adjustment` | smallint, default 0 | A7's manual adjustment (+ gives visits back, − takes them) |
| `paid` | boolean, default false | A7 tick, information for the admin |
| `activated_at`, `ended_at` | timestamptz | activation; decline or cancel |
| `expiry_notified_on` | date | server-only: the "expiring in 30 days" push went for this `ends_on` |
| `created_at`, `updated_at` | timestamptz | `set_updated_at` trigger |

Constraints: an active row has every plan column and its dates (check); one live subscription per customer: a unique partial index on `user_id` where status = `requested`, and at most one active row whose period hasn't ended is enforced in the RPCs under a row lock on the customer's profile (a partial unique index can't see "not ended").

**Departures from §7 (each explained in the migration and in §7):**

1. **No stored `expired` status.** "Expired" is `active` with `ends_on` before today in Baghdad, computed by `private.subscription_state(…)` and the app. So there is no window after midnight when a stale row still reads active, and no job has to flip it. The nightly job only sends the 30-day notice.
2. **`declined` is new**: an admin refusing a request (wrong number, outside the area) is different from ending an active subscription (`cancelled`).
3. **No `visits_used` counter.** Visits used = completed orders on the subscription + `visits_adjustment`; visits held = orders on it that are still open (pending through in progress). So an override out of completed gives the visit back by itself, and two bookings can't spend the same last visit. "Decrement on completion" (§6) is this count.
4. **No `admin_note` column.** RLS can't hide one column from the customer while admins read it (as with `order_event_notes`, `ticket_notes`), so notes go in `subscription_notes`.
5. **`requested_at`, `activated_at`, `ended_at`, `expiry_notified_on`** are new (A7's queue order, the audit, the 30-day notice).

### 2.3 `subscription_notes`

`id` (identity), `subscription_id`, `author_id`, `note` (1–1,000, trimmed), `created_at`. Admins read; nobody writes directly; written by the A7 RPCs (the activate, adjust, decline and cancel reasons, and "أضف ملاحظة"). New table, as `ticket_notes`.

### 2.4 `orders`

- `subscription_id` uuid null, foreign key (`subscription_id`, `customer_id`) → `subscriptions` (`id`, `user_id`), so an order can only use its own customer's subscription (`unique (id, user_id)` on subscriptions).
- **Departure:** no `uses_subscription` column; it is `subscription_id is not null` (one source of truth). The app reads it as "covered".
- Column grants: `subscription_id` is read with the order (customer, assigned crew, admins). Crews never read `subscriptions`; the id only tells C3/C4 the job is covered.

### 2.5 Settings (replaces `subscription_plan`)

Typed columns, as every other setting (**departure** from the one jsonb `subscription_plan`):

- `subscription_price_iqd` integer null (> 0). **Null = not offered yet**: N8 shows the plan without "اطلب الاشتراك" and `request_subscription` refuses (`ZL037`). The owner sets it in A13 before launch (§12.4 already lists "subscription price set").
- `subscription_visits` smallint default 2 (1–12).
- `subscription_tanks` smallint default 1 (1–6).
- No `description`: the plan's words live in ar.json (N8), with the numbers from these columns. No Arabic in the database, as for notifications.
- `seed.sql` sets a local price (the owner's number, Q1) so local and CI can request.

### 2.6 RLS and grants

| Table | anon | customer | other customer | crew | admin | service role |
| --- | --- | --- | --- | --- | --- | --- |
| `subscriptions` | none | read own | none | none | read all | — |
| `subscription_notes` | none | none | none | none | read all | — |
| `orders.subscription_id` | — | with own order | — | with assigned order | all | — |

No INSERT, UPDATE or DELETE grants on either table: only the RPCs below write them. `subscriptions` joins the Realtime publication (uuid key; screens subscribe to INSERT and UPDATE), so N8, the Profile card and A7/A1 update live. pgTAP covers allowed and denied for anon, customer, other customer, crew, admin on every policy and RPC, plus Realtime through `realtime.apply_rls()`. The `rls-auditor` runs after the migration.

## 3. RPCs, rules and error codes

### 3.1 Customer

- `request_subscription()` → the subscription id. Customers only (`42501` otherwise). Refused while the plan has no price (`ZL037` `subscription_not_offered`) or while the customer has a request, or an active subscription that ends more than 30 days from today (`ZL035` `subscription_exists`). Snapshots nothing: the price and plan are set at activation. Notifies admins (`subscription_requested`). Retry-safe: a second call while requested returns the same row rather than `ZL035`.
- `create_order(…, p_use_subscription boolean default false)`: a new parameter at the end (the old signature is dropped; the app is updated in the same PR). When true, it locks the customer's subscription row and checks, in this order, with `ZL034` `subscription_unavailable` and the reason as message: `no_subscription` (no active one), `outside_subscription_period` (the slot date isn't within `starts_on`–`ends_on`), `no_visits_left` (total − used − held ≤ 0), `subscription_tanks_exceeded` (the order's tank count > `tanks_covered`, Q2). The `expected_total` check stays as it is (the total is still the lines' sum, see 3.4).
- `transition_order`, customer reschedule of a covered order: the new date must stay inside the period (`ZL034` `outside_subscription_period`); staff may move it anywhere.

### 3.2 Admin (security definer, audited with `private.log_admin_action`)

- `admin_activate_subscription(id, starts_on, visits_total, tanks_covered, price_iqd, paid, note)`: a `requested` row → `active`. `starts_on` not before today in Baghdad unless it continues a previous subscription; `ends_on` computed. Refuses another status (`ZL036` `invalid_subscription_status`) and an overlap with the customer's other active subscription (`ZL035`). Notifies the customer (`subscription_activated`). Logs `subscription.activate`.
- `admin_update_subscription(id, paid)`: the paid tick (`subscription.update`, only what changed).
- `admin_adjust_subscription_visits(id, delta, reason)`: delta ≠ 0, reason required; the result can't make used + held exceed total or go below 0 left (`22023` `invalid_adjustment`). Logs `subscription.adjust` with old and new visits left.
- `admin_end_subscription(id, reason)`: `requested` → `declined`, `active` → `cancelled`; reason required (`ZL011` `reason_required`). Open orders using it keep their coverage (the admin removes it per order, below). Notifies the customer on a decline (Q9). Logs `subscription.decline` / `.cancel`.
- `admin_add_subscription_note(id, note)`: `subscription.note`.
- `admin_set_order_subscription(order_id, use boolean)`: A2's "verify subscription" outcome. While the order is pending or confirmed: `false` drops coverage (the order becomes a cash order at its total); `true` puts the customer's active subscription on it with the same checks as `create_order` (`ZL034`). Logs `order.subscription`. Status unchanged.
- `transition_order`, admin `pending_confirmation → confirmed` of a covered order: re-runs the coverage checks except "visits left" counts this order as already held; failing → `ZL034`, and the drawer offers "شيل الاشتراك" (drop coverage) or cancel. That is the server side of "verify coverage".

### 3.3 Completion (visit decrement)

- `transition_order` → `completed`: the cash tick is not required when `subscription_id` is set (crew and override), and `cash_collected` stays false. Nothing else is written: the completed order is the visit used (2.2, departure 3).
- No-show and cancel use no visit (Q5).

### 3.4 Money

`total_iqd` keeps the lines' sum at list prices (the value of the visit, for reports); what the crew collects is 0 when covered. Checkout, N4, Orders, C3/C4 and the A2 drawer show "مشمول بالاشتراك" in place of the amount to pay.

### 3.5 Reads

- `subscription_summary()` (customers, security invoker): the caller's latest subscription with its state (`none` / `requested` / `active` / `expired` / `declined` / `cancelled`), visits total, used, held and left, period, and the next visit (Q11). Used by N8, Profile and Checkout, so the counting lives in SQL once.
- `admin_subscriptions(filter, search, limit)` (admins, `42501` otherwise): A7's lists (requests oldest first; active; expiring within 30 days; ended) with the customer's name and phone and the same counts.
- `private.subscription_visits(id)` (helper used by the above and `create_order` / `transition_order`).

### 3.6 Nightly job

`private.send_subscription_expiry_notices(day)` via pg_cron `subscriptions-expiring` at 07:13 UTC (10:13 Baghdad, beside the cleaning reminders): active subscriptions whose `ends_on` is 30 days away or less and not yet noticed for that `ends_on` (`expiry_notified_on`), a live account. Catches up after a missed run. Runs as postgres only.

### 3.7 Error codes (added to `supabase/CLAUDE.md`)

- `ZL034` `subscription_unavailable` (messages `no_subscription`, `outside_subscription_period`, `no_visits_left`, `subscription_tanks_exceeded`)
- `ZL035` `subscription_exists`
- `ZL036` `invalid_subscription_status`
- `ZL037` `subscription_not_offered`
- `P0002` `subscription_not_found`; `22023` `invalid_visits`, `invalid_tanks`, `invalid_price`, `invalid_start`, `invalid_adjustment`, `invalid_note`

### 3.8 Notifications (§9.2)

New `notification_type` values, audience in the generated column, words in ar.json `Notifications.items` (drafts for the owner), a case in `describeNotification` / `notificationHref`:

| Type | To | Draft copy | Opens |
| --- | --- | --- | --- |
| `subscription_requested` | Admins | طلب اشتراك جديد · [name] · [phone] | A7 requests |
| `subscription_activated` | Customer | تفعّل اشتراكك السنوي · [visits] زيارات لحد [ends_on] | N8 |
| `subscription_expiring` | Customer | اشتراكك يخلص قريباً · ينتهي يوم [ends_on]. تكدر تجدده هسه. | N8 |
| `subscription_declined` (Q9) | Customer | ما كدرنا نفعّل اشتراكك · راسلنا بالمحادثة إذا عندك سؤال. | Chat |

## 4. Screens

### Customer

- **N8 Subscription** (`/subscription`, new; guests see the plan, "اطلب الاشتراك" goes through login, Q12). Back to where it came from; no tab bar. States:
  - none / declined / cancelled: the plan card (price `formatIQD`, "زيارتين تنظيف وتعقيم بالسنة", "لخزان واحد", "تذكير بموعد التنظيف", "شهادة تعقيم بكل زيارة"; numbers from settings), "اطلب الاشتراك", and a line on paying (Q4). Without a price: the plan without the button, "الاشتراك قريباً".
  - requested: "طلبك قيد المراجعة" with the request date and "نتواصل وياك لتفعيله", "راسلنا".
  - active: the Profile card's numbers, the period, the visits list (orders using it, to N4), "احجز زيارة" (Booking); renew from 30 days before the end.
  - expired: "انتهى اشتراكك" with "جدّد الاشتراك".
  - loading skeleton, error ("اعد المحاولة"), offline as everywhere. Live through Realtime.
- **Profile card** (`profile/page.tsx`): the canvas's active card; the other three states in the same navy card with one line and a CTA. Taps open N8.
- **Checkout** (`confirm-step.tsx`): when `subscription_summary()` says active with a visit left, the slot date inside the period and the tank count ≤ tanks covered, a card "استخدم زيارة من اشتراكك" with a switch and "باقي لك 1 من 2 زيارات". The kit has no switch yet: a new `Switch` in `src/components/ui/` (on `/kit`), drawn like Profile's reminder toggle in the canvas, which task 3 then reuses. On: the breakdown keeps the lines, and the total row reads "مشمول بالاشتراك". When the subscription can't cover this booking (too many tanks, date after the end), the card shows why, disabled. `ZL034` from the server shows the reason and turns the toggle off. The toggle is part of the draft (`useSubscription`) and resets the request id like any other change.
- **N4, Orders card, Booking success:** "مشمول بالاشتراك" in place of the amount.

### Crew

- **C3** shows "مشمول بالاشتراك" in place of the amount; **C4** hides the cash tick for covered jobs (§8.1 says so) and sends no cash flag.

### Admin

- **A7 Subscriptions** (`/admin/subscriptions`, new nav item "الاشتراكات" with the request count): tabs in the URL: الطلبات (oldest first), الفعّالة, تنتهي خلال 30 يوم, المنتهية (expired, declined, cancelled); search by name or phone. Rows: customer (to A4 conversation), phone, dates, visits used / total, paid. The drawer (`?subscription=`): the customer, the state, the plan numbers, the orders that used or hold a visit (to A2), the notes, and the actions: فعّل (start date, visits, tanks, price prefilled from the plan, paid, note), دُفع tick, عدّل الزيارات (+/−, reason), ارفض الطلب / الغي الاشتراك (reason), أضف ملاحظة.
- **A1:** "طلبات الاشتراك" replaces the "coming soon" card: count and the 5 oldest, each to the A7 drawer, with "كل الطلبات".
- **A2 drawer:** for a covered order, a "الاشتراك" block: state, period, visits left, paid, a link to A7, and the verify result (covered / why not). Actions while pending or confirmed: "شيل الاشتراك" (drop coverage) and, for an uncovered order of a customer with a usable subscription, "استخدم الاشتراك". Confirm shows the `ZL034` reason when coverage fails. The table and board mark covered orders.
- **A4 panel:** the subscription's state, visits left and period, linking to A7 (replaces "subscriptionLater").
- **A13:** a "الاشتراك السنوي" section: price (empty = not offered), visits, tanks covered.
- **Audit log:** labels and the "الاشتراكات" filter for `subscription.*`, and `order.subscription`.
- **Admin shell:** refreshes on subscription inserts and updates (as for tickets); a new request plays the chime like a new ticket.

## 5. Tests

Written first (db-change skill): the pgTAP files fail before the migration exists.

### pgTAP (`supabase/tests/database/`)

- `subscriptions.test.sql`: table and notes RLS for anon, customer, other customer, crew, admin; no direct writes; Realtime `apply_rls`; checks and the one-request index.
- `request_subscription.test.sql`: roles, not offered, exists, renewal window, retry, admin notification.
- `admin_subscriptions.test.sql`: activate / update / adjust / end / note / `admin_subscriptions` reads: roles, statuses, overlap, adjustment bounds, audit rows (only what changed), notifications.
- `create_order_subscription.test.sql`: each `ZL034` reason, the last visit taken once, held visits counted, another customer's subscription impossible.
- `transition_order_subscription.test.sql`: completion without cash for covered orders (crew and override), still required otherwise; visit used on completion and given back on an override out of completed; no-show and cancel use none; confirm re-checks coverage; customer reschedule outside the period refused.
- `admin_set_order_subscription.test.sql`, `subscription_expiry_notices.test.sql` (30 days, once per `ends_on`, catch-up, deleted accounts), and `rls_audit_private_execute` stays green.

### Integration (`tests/integration/`)

- Two `create_order` calls at once on the last visit: one booking is covered, the other gets `ZL034` (`no_visits_left`).

### Unit (`tests/unit/`)

- `subscription.test.ts`: the state and next-visit helpers, Zod schemas, the error mapping, `describeNotification` for the new types.

### e2e (`tests/e2e/subscription.spec.ts`; helpers `createSubscription()` in `tests/e2e/helpers/admin.ts`)

1. Guest opens N8, sees the plan, "اطلب الاشتراك" goes through login and back.
2. Customer requests: N8 and the Profile card read "طلبك قيد المراجعة"; requesting again isn't offered.
3. Admin activates in A7 (A1 lists the request; the audit log has the row); the customer's Profile shows the canvas card ("1 من 2" after one visit).
4. Checkout with the toggle: total "مشمول بالاشتراك"; the order is created covered; too many tanks shows the disabled reason.
5. Admin confirms; crew completes without a cash tick; visits left drops; N4 shows covered.
6. Admin drops coverage in A2 → C4 asks for cash again.
7. A7 adjust visits, decline a request, the expiring tab, the A13 plan section (price empty hides "اطلب الاشتراك").
8. Screenshots at 390×844 of the Profile card against `png/Profile.png`, and of N8 and the Checkout toggle (no canvas: checked against the kit and Checkout's look).

## 6. Docs to update (same PR)

- spec §5.5 (N8 entry from Home still with task 3), §5.8 (the card, built), §5.11 (toggle, built), N8 row, §6 (completion and confirm rules for covered orders; the "Phase 6" note), §7 (`subscriptions`, `subscription_notes`, `orders.subscription_id`, the settings, access rules, error codes, the departures), §8.1 (C3/C4), §8.2 (A1, A2, A4, A7, A13, audit log, "Phase 6, task 2 (built)"), §9.2 (the rows and copy), §10.2 (the plan seed), §12.3 (tick), §13 (close "Subscription details" with the answers; add A6 if it stays unscheduled), §3 (the job).
- `supabase/CLAUDE.md`: error codes, the subscription RPCs in the audited list, the notes table.
- CLAUDE.md: the `createSubscription()` e2e helper.
- Delete this plan in the PR, as with task 1.

## 7. Open questions

Each has a recommended default first. The plan above assumes the defaults.

1. **Plan numbers.** What are the price, the visits per year and the tanks covered? Default: 2 visits / 12 months / 1 tank (§10.2), the price set by you in A13 (until then "اطلب الاشتراك" is hidden and N8 says "قريباً"). For local, CI and `seed.sql` I'd use **60,000 IQD** unless you give the real number.
2. **Multi-tank orders.** Does one visit cover an order with more tanks than the subscription covers? Default: **no; the toggle is offered only when the order's tank count ≤ tanks covered** (one visit = one order of up to that many tanks; the customer books other tanks as a separate paid order). Alternative: the covered tanks are free and the rest are paid in cash at list prices on the same order (more work in Checkout, C4 and the totals, and a rule for which tanks are covered).
3. **Addresses.** Is a subscription tied to one address? Default: **no, any of the customer's addresses** (one home in practice). Alternative: tied to the address chosen when requesting.
4. **Payment.** How is the subscription paid, and must it be paid before it can be used? Default: **paid outside the app (cash to the company or to the crew at the first visit); "paid" is a tick for the admin only and doesn't block use**; A7 shows unpaid subscriptions. Alternative: only a paid subscription covers visits.
5. **What uses a visit.** Default: **only a completed order uses one; a no-show or a cancel uses none** (no-show has no penalty, §13). An open covered order holds a visit, so the customer can't book more covered orders than visits left.
6. **Period.** Default: **the slot date must fall within the period (start to start + 12 months − 1 day); unused visits lapse at the end** (no carry-over). Staff can still move a covered order past the end.
7. **Start date.** Default: **the admin picks it in "فعّل", today by default** (or the day after the previous one ends, for a renewal); not before today otherwise.
8. **Renewal.** Default: **a customer can request a new one from 30 days before the end, or after it expires**; it starts after the current one ends.
9. **Declining and cancelling.** Default: **the admin can decline a request or cancel an active subscription, with an internal reason; the customer gets a "ما كدرنا نفعّل اشتراكك · راسلنا" notification on a decline (none on a cancel, which support handles in chat); the customer can't withdraw a request in the app (they ask in chat).** Refunds are outside the app.
10. **Admin-made subscriptions.** Can the admin create one for a customer who never requested in the app (a phone call)? Default: **no in v1; the customer requests in the app** (decision G). Alternative: "أضف اشتراك" in A7 by phone.
11. **"الزيارة الجاية" on the Profile card.** Default: **the date of the soonest open covered order if there is one; otherwise the month when the next cleaning is due (the last covered cleaning + `cleaning_interval_months`, or the start date when none is used yet); shown as month and year as in the canvas.**
12. **N8 for guests.** Default: **guests can open N8 and see the plan; "اطلب الاشتراك" goes through login** (decision 11: guests browse prices). N8 is reached from Profile in this task and from Home's quick actions with task 3 (settled Oct 28, 2026).
13. **Checkout toggle default.** Default: **off; the customer turns it on** (the spec says "a toggle"). Alternative: on whenever the subscription can cover the booking.
14. **The plan's description.** Default: **fixed words in ar.json with the numbers from settings** (no free-text description setting), drafted as in section 4 for your review. Alternative: a Markdown description edited in A13.
15. **A6 Customers.** It is in §8.2 but in no §12.3 task. Default: **out of this task; the subscription shows in the A4 panel, the A2 drawer and A7, and I add A6 to §13 as unscheduled** for you to place (task 3 or the QA pass). Alternative: build a minimal A6 here.
