# Supabase setup (for the owner)

Claude can't create Supabase projects or see your dashboard: this cloud environment blocks `supabase.com`, and project creation needs your account and billing. You do steps 1–6 once, about 30 minutes in total. Everything else (schema, RLS, functions, buckets, seed) is code that Claude writes in `supabase/` and CI deploys.

## How the environments fit together

| Environment | Where it runs | Who uses it | How migrations get there |
| --- | --- | --- | --- |
| **Local** | Docker, inside each Claude session and on your laptop | Claude, tests, CI | `supabase db reset` |
| **Dev** (staging) | Supabase project `zalal-dev` | Vercel preview deploys, you testing on a phone | GitHub Action, automatically on every merge to `main` |
| **Prod** | Supabase project `zalal-prod` | Real customers | GitHub Action, **only when you start it by hand** and approve it; the same run then releases the app (`docs/deploy-setup.md`) |

Claude never holds prod credentials. Claude works locally; GitHub Actions push migrations to dev and prod.

## 1. Create two organizations (this keeps prod out of Claude's reach)

In [supabase.com/dashboard](https://supabase.com/dashboard), create two **organizations**, not just two projects:

- **Zalal Dev** on the **Free** plan. Free projects pause after a week without traffic; un-pause from the dashboard when needed.
- **Zalal** on the **Pro** plan ($25/month, spec §11). Prod lives here.

> **Current state (Oct 23, 2026): both orgs are on Free.** That's fine while building, with two limits to know: Free caps every upload at **50 MB** (the app allows 100 MB videos, spec §5.10, so larger ones fail), and Free projects pause after a week without traffic. Move the prod org to Pro before launch (spec §12.4), then set **Storage → Settings → Upload file size limit** to at least 100 MB.

Why two orgs: when you connect the Supabase plugin, its login is granted per organization. Grant it only **Zalal Dev**, and Claude can't reach prod even by mistake.

## 2. Create the projects

In each org, create one project:

| Setting | Dev | Prod |
| --- | --- | --- |
| Name | `zalal-dev` | `zalal-prod` |
| Region | Central EU (Frankfurt) `eu-central-1` | same |
| Database password | Generate one and store it in your password manager | Generate a **different** one and store it |

Write down each **project ref**, the 20-character id in the project URL (`https://supabase.com/dashboard/project/<ref>`).

### 2a. Keep Supabase's own GitHub integration off

**Current state (Oct 23, 2026): neither project is connected**, and they should stay that way. GitHub Actions deploy both: `deploy-dev.yml` after every merge that passes CI, and `deploy-prod.yml` only when you start and approve it. If a project were connected with "Deploy to production" on, it would apply migrations on every merge, around CI and, for prod, around your approval. If you ever connect one, keep "Deploy to production" and automatic branching off in **Project Settings → Integrations → GitHub**.

## 3. Auth settings (both projects)

Go to **Authentication → Sign In / Providers**:

- **Phone**: enable. Leave the SMS provider unset. Our server makes, sends (OTPIQ) and checks login codes itself, then signs the user in with a password only the server knows (spec §9.1). Supabase only keeps the sessions.
- **Phone → Confirm phone**: on. The server creates users already confirmed; any other phone signup would need a Supabase code, which the hook below refuses.
- **Email**: disable (v1 has no email).
- OTP expiry `300` seconds, OTP length `6`. Unused now, but keep them matching decision 10.
- **"Allow new users to sign up": off.** The server creates users through the admin API after checking the code, which works with sign-ups off. With them on, anyone could create accounts directly.

After the `otp_server_codes` migration has reached the project (dev: after the merge that brings it; prod: after the next **Deploy prod**), go to **Authentication → Hooks → Send SMS hook**:

- Type **Postgres**, schema `private`, function `refuse_auth_sms`, and enable it. It refuses every send, so a client calling Supabase's `/otp` directly gets no code, and Supabase never holds a phone code that could be guessed at its `/verify` endpoint. If the dashboard doesn't list the `private` schema, tell Claude; a `public` wrapper can be added.

Go to **Authentication → Rate Limits**: raise **token refreshes** to the highest value offered. It is counted per IP and also covers sign-ins, and every login comes from the app server's few IPs, not from the user's phone. Our own per-phone limits (spec §9.1) protect sending; the password Supabase checks is a random 43-character value, so a higher limit gives an attacker nothing.

Go to **Authentication → URL Configuration**. This matters little for Zalal: phone OTP is verified in-app and never follows a redirect link (only email links and OAuth do). So you don't need Vercel to finish this step:

- **Now:** set Site URL to `http://localhost:3000` in both projects, and add `http://localhost:3000/**` to Redirect URLs in dev.
- **After Phase 0 creates the Vercel project:** set prod's Site URL to the production URL (and your real domain later). In dev, add `https://<project>-*-<team-slug>.vercel.app/**` for preview deploys.

Go to **Authentication → Sessions**: leave session time-box and inactivity timeout **off**, so customers stay logged in and rarely need a paid OTP (spec §11).

Don't enable extensions (PostGIS, pg_cron, pg_net) or create Storage buckets in the dashboard. Claude does those in migrations, so local, dev and prod always match.

## 4. Get the keys

In each project, go to **Project Settings → API Keys**. Use the new-style keys:

- **Publishable key** (`sb_publishable_…`): safe in the browser.
- **Secret key** (`sb_secret_…`): server only, never in the browser or in git.

Also create **two personal access tokens** at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens). CI uses them to push migrations and deploy Edge Functions. Give each token as little as it needs:

- `zalal-ci-dev`: scoped to the **`zalal-dev` project** (choose project scope, not organization, so a future project in the org isn't covered automatically).
- `zalal-ci-prod`: scoped to the **`zalal-prod` project**.
- Permissions, the same for both:

  | Permission | Access | Used by |
  | --- | --- | --- |
  | Project Settings | Read | `supabase link` |
  | API Gateway Keys (`api_gateway_keys_read`) | Read | `supabase link` |
  | Migrations | Read-write | `supabase db push` |
  | Edge Functions | Read-write | `supabase functions deploy` |

  Leave everything else off. If an Edge Function ever needs a secret, set it by hand in the dashboard rather than from CI, so the token needs no Secrets access. (The OTPIQ key is not one: login codes are sent by the app server, so it lives in Vercel, `docs/deploy-setup.md` step 5.) If a CI run later fails with a 403, its log names the endpoint; add just that permission, read-only where possible.
- Set an expiry (for example 1 year) and put the renewal date in your calendar.

Why two: a token that can reach both orgs with full access turns any leak (a bad workflow change, a compromised action) into a prod leak. With two tokens, only the approved prod job ever holds the prod token.

## 5. Put the secrets where they belong

**GitHub**: dev secrets are repository secrets, and prod secrets are **environment secrets** that only the approved prod job can read.

1. Go to repo → Settings → **Environments** → create `production`:
   - **Required reviewers**: you.
   - **Deployment branches**: "Selected branches", `main` only.
   - **Environment secrets** (on this page, not the repo-wide list):

     | Secret | Value |
     | --- | --- |
     | `SUPABASE_ACCESS_TOKEN` | `zalal-ci-prod` token |
     | `SUPABASE_PROJECT_REF` | prod ref |
     | `SUPABASE_DB_PASSWORD` | prod database password |
     | `VERCEL_DEPLOY_HOOK_URL` | added later, `docs/deploy-setup.md` step 4 |

2. Go to repo → Settings → Secrets and variables → **Actions** → Repository secrets (used by CI and the dev deploy):

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_DEV_ACCESS_TOKEN` | `zalal-ci-dev` token |
   | `SUPABASE_DEV_PROJECT_REF` | dev ref |
   | `SUPABASE_DEV_DB_PASSWORD` | dev database password |

3. Make sure **no prod value is in the repository secrets list**. If you added one there earlier, delete it.

The prod deploy workflow uses `environment: production`, so it pauses for your approval and only then receives the prod secrets.

**Vercel** (project → Settings → Environment Variables). `docs/deploy-setup.md` step 1 has the full list, with Sentry and PostHog. Create **one** Vercel project (not one per environment): its Production environment points to prod Supabase and its Preview environment to dev. Set these by hand rather than with the Supabase ↔ Vercel integration, which syncs a single Supabase project into every environment.

| Variable | Preview (→ dev) | Production (→ prod) |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<dev-ref>.supabase.co` | `https://<prod-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | dev publishable key | prod publishable key |
| `SUPABASE_SECRET_KEY` | dev secret key | prod secret key |

Never paste keys into a Claude chat. Claude doesn't need them; local Supabase has its own throwaway keys.

## 6. Connect the Supabase plugin to dev (optional but useful)

The plugin's server (`mcp.supabase.com`) is currently **blocked** by this cloud environment's network policy, so it failed to connect in this session. To use it:

1. In the Claude app, open this environment's settings (the cloud environment menu in the session title bar → **Edit**). Under **Network access**, add these to the allowed domains: `mcp.supabase.com`, `api.supabase.com`, `supabase.com`, `*.supabase.co`. Keep "Allow package managers" ticked. See [docs](https://code.claude.com/docs/en/cloud-environments#network-access).
2. When the plugin asks you to log in, choose the **Zalal Dev** organization only.

With that, Claude can read dev's tables, policies, logs and the security advisor. Claude still changes the schema only through migrations in git.

## 7. What Claude sets up in Phase 0 (no action from you)

- Done (task 2): `supabase init`, and `supabase/config.toml` mirroring step 3: phone sign-up on, email sign-up off, 6-digit OTP valid 300 s, 45 s between resends, site URL `http://localhost:3000`. Migrations enable PostGIS, pg_cron and pg_net and create the five buckets.
- Done (Phase 1, task 2): sign-ups off and the Send SMS Hook set to `private.refuse_auth_sms` in `config.toml`, as in step 3. Locally the CLI also needs a built-in SMS provider turned on before it enables phone login at all, so `config.toml` turns on Twilio with placeholder values that are never used (Supabase always calls the hook first). Hosted projects don't need that.
- Done (task 2): the SessionStart hook for cloud sessions installs packages, starts Docker and runs `supabase start` in the background with `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`. In this environment the default image registry (AWS ECR) is blocked, but Docker Hub works.
- `config.toml` only configures local Supabase. Hosted auth settings stay as you set them in step 3; CI never runs `supabase config push`.
- Done (task 5): GitHub Actions in `.github/workflows/`:
  - `ci.yml` on every PR and push to `main`: Prettier check, lint, typecheck, unit tests, `supabase start` + `supabase test db`, a check that `database.types.ts` matches the schema, and Playwright.
  - `deploy-dev.yml` after CI passes on `main` (or by hand from `main`): `supabase link` → `supabase db push` → `supabase functions deploy`, with the `SUPABASE_DEV_*` repository secrets. The steps live in `.github/actions/supabase-deploy/`.
  - `deploy-prod.yml`, manual (`workflow_dispatch`, `main` only), uses the `production` environment so you approve it: the same steps against prod, then the Vercel deploy hook releases the app (`docs/deploy-setup.md`).
- `supabase/seed.sql` loads into local databases only (`pnpm db:reset`, CI). Hosted dev and prod never load it: the deploy runs migrations only, so rows a hosted project needs (the settings row, the starting service area) come from migrations. Prod gets its first admin from the `ADMIN_PHONE` seed script (spec §10.2) and real prices and slots from the dashboard.

## 8. Media cleanup job (both projects, once)

Nightly jobs delete files that were uploaded but never booked, sent or attached (spec §7 Storage): booking and crew media, chat files, ticket files and article covers. CI deploys the Edge Function `media-cleanup` and the migration `media_cleanup` that schedules them, but the jobs send nothing until the project has two secrets. Do this per project after the code reaches it: dev after the merge, prod after the next **Deploy prod**. Use a different secret for each project, and never paste it into a Claude chat.

1. Make a random secret on your computer: `openssl rand -base64 32`.
2. **Edge Functions → Secrets**: add `MEDIA_CLEANUP_SECRET` with that value. (`SUPABASE_URL` and the service keys are already there; Supabase adds them.)
3. **Database → Vault → Add new secret**, twice. Vault keeps them encrypted; the SQL editor would keep the value in its history.
   - Name `project_url`, value `https://<project-ref>.supabase.co`
   - Name `media_cleanup_secret`, the same value as step 2
4. Check it in the **SQL editor**:

   ```sql
   select private.invoke_media_cleanup('crew');
   -- a few seconds later: 200 and {"folder":"crew","deleted":…,"failed":0,"more":false}
   select status_code, content from net._http_response order by id desc limit 1;
   ```

   A 401 means `MEDIA_CLEANUP_SECRET` is missing or differs from the Vault value (the function says which in its logs). A null from the first line means a Vault secret is missing or misnamed. Later runs show under **Integrations → Cron** (jobs `media-cleanup-customer`, `media-cleanup-chat`, `media-cleanup-crew`, `media-cleanup-ticket` and `media-cleanup-content`, between 03:17 and 04:17 Baghdad time) and in the function's logs, which hold counts only.

To change the secret, update both places (steps 2 and 3) together. The CI tokens need no new permission.

## 9. Web Push (both projects, once)

New notifications go out as Web Push through the Edge Function `send-push` (spec §9.2). CI deploys the function and the migration `notifications`, but nothing is pushed until the project has its keys; the in-app list works without them. Do this per project after the code reaches it, with a different key pair and secret for each project, and never paste a private key or secret into a Claude chat.

1. Make a VAPID key pair on your computer: `npx web-push@3.6.7 generate-vapid-keys`. It prints a public and a private key.
2. Make a random secret: `openssl rand -base64 32`.
3. **Edge Functions → Secrets**: add
   - `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` from step 1
   - `VAPID_SUBJECT`: `mailto:` and an address you read (push services write to it if something is wrong), e.g. `mailto:owner@example.com`
   - `SEND_PUSH_SECRET` from step 2
4. **Database → Vault → Add new secret**: name `send_push_secret`, the same value as `SEND_PUSH_SECRET`. (`project_url` is already there from step 8.)
5. In Vercel, set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to the **public** key of the matching project: dev's for Preview, prod's for Production (`docs/deploy-setup.md` step 1), then redeploy.
6. Check it: on the deployed app, book a test order on an Android phone (or add the app to an iPhone's home screen first) and tap "فعّل الإشعارات" on Booking success; confirming the order in the dashboard should arrive as a push. The function's logs show counts only (`{"job":"send-push","notifications":1,"sent":1,…}`); a 401 means `SEND_PUSH_SECRET` and the Vault value differ, a 503 that a VAPID secret is missing.

Changing the key pair later makes every saved browser invalid: each one renews itself the next time its user opens the app. To change the secret, update steps 3 and 4 together.

## Checklist

- [ ] Two orgs: Zalal Dev (Free), Zalal (Pro)
- [ ] `zalal-dev` and `zalal-prod` in Frankfurt; passwords saved
- [ ] Phone auth on with Confirm phone on, email off, OTP 6 / 300 s, URLs set (both projects)
- [ ] Sign-ups off, Send SMS hook set to `private.refuse_auth_sms`, token refresh limit raised (both projects, after the migration reaches them)
- [x] Supabase GitHub integration off for both projects (GitHub Actions deploy instead)
- [ ] Two personal access tokens, each scoped to one project (Project Settings and API Gateway Keys read, Migrations and Edge Functions read-write)
- [ ] `production` environment (you as reviewer, `main` only) holding the prod secrets; dev secrets as repository secrets
- [ ] Vercel, Sentry, PostHog and the `main` ruleset: `docs/deploy-setup.md`
- [ ] Media cleanup secrets in both projects (step 8), after the code reaches each one
- [ ] Web Push keys and secret in both projects, and each public key in Vercel (step 9)
- [ ] (Optional) Supabase domains allowed in this environment's network settings; plugin logged in to Zalal Dev only
