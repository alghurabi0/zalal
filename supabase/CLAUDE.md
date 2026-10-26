# supabase/: SQL conventions

Loaded when Claude works in this folder. The root CLAUDE.md rules still apply. For a schema change, follow the `db-change` skill (`.claude/skills/db-change/SKILL.md`).

## Migrations
- Create with `pnpm exec supabase migration new <name>`. Never edit a migration that is on `origin/main` (the edit hook and the protected-paths CI check refuse it); add a new one.
- Start each file with a comment: what it adds, the spec sections it serves, and every departure from spec §7 with the reason. Update §7 in the same PR.
- Lowercase snake_case. Indexes `<table>_<columns>_idx`, unique indexes `<table>_<columns>_key`. Policy names are plain sentences ("Customers read their tanks; admins read all").
- Tables in `public`. Primary keys: `uuid` (`gen_random_uuid()`) for rows users own or that appear in URLs; `bigint generated always as identity` otherwise. Times are `timestamptz`, money is integer IQD, phones are E.164 checked with `^\+9647[3-9][0-9]{8}$`.
- Text columns get a length check and `= btrim(col)`; the app trims before sending.
- Every table with `updated_at` gets the `private.set_updated_at()` trigger.
- PostGIS lives in `extensions`: write `extensions.geography(point, 4326)`, `extensions.st_covers(…)`. Store `lat`/`lng` and generate the geography from them, so the app never handles PostGIS binary.
- `seed.sql` loads only locally (`db reset`, CI); hosted dev and prod never load it. A row any hosted project needs to work (the settings row, the starting service area, later prices and slots) goes in a migration that skips itself when the row already exists.
- Scheduled jobs: `cron.schedule` in the migration that owns the table. The schedule is UTC; comment the Baghdad time (UTC+3).

## Access: privileges, then RLS
- Supabase grants every privilege on new `public` tables and sequences to `anon` and `authenticated`, and EXECUTE on new `public` functions. So, for each table: `enable row level security`, `revoke all … from anon, authenticated` (and the same on its identity sequence), then grant only what each role needs. Use column grants to keep server-owned columns (`role`, `phone`, `deleted_at`, `last_cleaned_at`, …) out of reach. For each function, `revoke execute … from public, anon[, authenticated]` and grant it back to the roles that call it.
- Policies name their role (`to authenticated`, `to anon, authenticated`) and wrap calls so they run once per query: `(select auth.uid())`, `(select private.is_admin())`, `(select private.current_user_role()) = 'customer'`.
- Role helpers are in `private` (not exposed by the API): `private.current_user_role()` (null for guests and deleted accounts), `private.is_admin()` and `private.current_crew_id()` (the caller's crew while it is active and the account is still a crew; null otherwise).
- Postgres makes every new function executable by PUBLIC, and `alter default privileges in schema … revoke` can't undo that. End each migration that adds `private` functions with `revoke execute on all functions in schema private from public;`, then grant back only what policies call. `tests/database/rls_audit_private_execute.test.sql` fails if a migration forgets.
- Ownership across tables: when a child row carries `user_id`, reference the parent by `(id, user_id)` (see `tanks`), so a wrong policy still can't attach a row to someone else's parent.
- On UPDATE, Postgres also checks the new row against the SELECT policies. If a SELECT policy hides soft-deleted rows, a plain update can't soft-delete; do it in a `security definer` RPC (see `delete_address`).
- Admin writes never go through table policies. They are `security definer` RPCs that check the role and call `private.log_admin_action(action, entity, entity_id, diff)` (`transition_order`, `assign_crew`, `admin_update_prices`, `admin_create_slot` / `admin_update_slot`, `admin_block_date` / `admin_unblock_date`, `admin_update_settings`, `admin_save_service_area`; crews come in Phase 3 part C). Log only what changed, with old and new values; a save that changes nothing logs nothing. Admin-only reads that need a clear refusal (`admin_slot_board`, `admin_schedule_conflicts`, `admin_service_areas`) are `security invoker` with an explicit `private.is_admin()` check that raises `42501`.
- `orders.status` changes only through `transition_order()` (spec §6). No role has INSERT, UPDATE or DELETE on any order table; `create_order()` and `transition_order()` are the only writers. Child tables (`order_items`, `order_events`, `order_media`) read through `exists (select 1 from public.orders …)`, so the orders policy decides.
- Slot places: take one only with `private.reserve_seat(order_id, date, slot_id)` and free it with `private.release_seat(order_id)`. It queues on a transaction-level advisory lock per slot and day, checks the current capacity, then inserts the lowest free seat; the `slot_bookings` key stays as the backstop. Check a day and slot with `private.bookable_slot(date, slot_id, customer_rules)`.
- Storage policies go in the migration of the tables that own the files, scoped by `bucket_id`, and in `storage_buckets.test.sql`'s `policies_are` list. Direct SQL deletes from `storage.objects` are refused unless `storage.allow_delete_query` is on (the Storage API sets it); tests set it to check the delete policy.

## Functions
- RPCs the app calls go in `public`; trigger functions and helpers go in `private`.
- Prefer `security invoker`. Use `security definer` only when the caller must not have the table privilege. Then: `set search_path = ''` (the guards check it), fully qualified names everywhere, and an explicit `auth.uid()` check inside.
- Server-only RPCs (OTP limits) grant EXECUTE to `service_role` only. The app calls them with the admin client.
- `auth.users` has a guard trigger (`private.guard_auth_user`, migration `auth_user_guard`): no new email (a row that already has one keeps it), and a password changes only inside `public.set_login_password(user_id, password)` (service role), which marks its own transaction with the setting `zalal.password_set_for`. Never set a password through the Auth admin API (the trigger refuses it); call that RPC. Tests that insert into `auth.users` must not set `email`.
- Auth hooks are Postgres functions in `private`, granted EXECUTE to `supabase_auth_admin` only (which has USAGE on `private` for that). The Send SMS Hook `private.refuse_auth_sms` refuses every send: phone codes are made and checked by the server (spec §9.1), and users are created through the Auth admin API, since sign-ups are off.
- Errors the app shows: `raise exception using errcode = …, message = '<snake_case_code>'`. The app maps the code to an `ar.json` string. Codes in use:
  - `ZL001` `outside_service_area`
  - `ZL002` `password_change_not_allowed` and `ZL003` `email_not_allowed` (the `auth.users` guard; Auth's API reports them as a failed update, the app never shows them)
  - `ZL004` `slot_unavailable` (inactive, wrong weekday, blocked, outside the window, or inside the cutoff), `ZL005` `slot_full`, `ZL006` `change_too_late` (customer cancel or reschedule inside the cutoff), `ZL007` `too_many_tanks`, `ZL008` `too_many_files`, `ZL009` `upload_not_found` (missing, unfinished, someone else's, or already attached)
  - `ZL010` `invalid_transition`; `ZL011` a missing requirement: `before_photo_required`, `after_photo_required`, `cash_not_collected`, `crew_not_assigned`, `reason_required`
  - `ZL012` `address_in_use` (`delete_address` while an active order uses it)
  - `ZL013` `crew_inactive` (assigning a switched-off crew, or one whose account is no longer a crew), `ZL014` `crew_change_not_allowed` (changing the crew after the crew arrived, or removing it while on the way)
  - `ZL015` `slot_exists` (a new slot with the times of another, switched off or not), `ZL016` `invalid_area` (a service area that isn't a valid polygon inside Iraq, or has more than 5,000 points), `ZL017` `last_active_area` (switching off the only active area), `ZL018` `price_changed` (`create_order`'s `expected_total` no longer matches the prices)
  - `P0002` for a missing or hidden row (`address_not_found`, `otp_request_not_found`, `crew_not_found`, `tank_not_found`, `price_not_found`, `order_not_found`, `slot_not_found`, `blocked_date_not_found`, `service_area_not_found`); `42501` `not_allowed` for the wrong role; `22023` for input the app's Zod schema should already have refused (`invalid_items`, `duplicate_tank`, `cancel_reason_required`, `new_slot_required`, `same_slot`, `invalid_prices`, `date_in_past`, `unknown_setting`, …)
  
  New business errors take the next `ZL0nn`.
- Every `update` and `delete` needs a `where`, even on the one-row `settings` table (`where s.id`): PostgREST loads pg-safeupdate, which refuses them otherwise (`21000`). pgTAP doesn't load it, so only a call over the API (e2e, integration) catches a missing one.
- Results the app branches on (allowed or not, retry time) are OUT parameters, not exceptions (see `request_otp`).

## pgTAP tests (`tests/database/`)
- One file per table or RPC, `<name>.test.sql`, opening with a comment that states the rules. Start with `begin;` and `\ir _helpers.psql`, end with `select * from finish(); rollback;`.
- Helpers: `tests.create_user(phone[, role])`, `tests.user_id(phone)` (usable inside `$$…$$`), `tests.authenticate_as(id)`, `tests.authenticate_as_anon()`, `tests.authenticate_as_service_role()`, `tests.clear_authentication()`.
- Booking fixtures (insert as the test runner, before authenticating): `tests.create_address(user_id[, label])`, `tests.create_crew(phone)` (a crew account and its `crews` row), `tests.create_slot(start, end[, capacity])` (every weekday), `tests.create_order(customer_id[, status, slot_start_at, crew_id, slot_id])` (holds a place unless cancelled; `slot_start_at` is stored as given, so a test can place it anywhere relative to `now()`), `tests.create_object(bucket, name, owner[, mimetype, size])` (a finished upload). Keep ids by name with `insert into tests.ids` and `tests.id(name)`.
- Concurrency (two bookings at once) can't be tested in one pgTAP transaction; it lives in `tests/integration/booking-capacity.test.ts`.
- Cover allowed and denied for anon, customer, another customer, crew and admin on every policy, plus the service role where the server writes.
- Expected errors: `42501` permission or RLS `with check`, `23514` check, `23505` unique, `23503` foreign key, `23502` not null. A row hidden by RLS doesn't error; test it with `is_empty($$ update … returning 1 $$)`.
- `now()` is fixed inside the test's transaction: backdate rows to test time windows. To backdate `updated_at`, disable its trigger around the update.
- Don't depend on seed data: replace it in the test (for example `delete from public.service_areas` and insert a test area).
- Write the tests first and watch them fail. Fix the `plan(n)` count last.
