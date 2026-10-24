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

- **Phone**: enable. Leave the SMS provider unset for now; Phase 1 adds our own **Send SMS Hook** (WhatsApp/SMS via OTPIQ), configured under **Authentication → Hooks**.
- **Phone → Confirm phone**: on. Otherwise a phone + password signup gets a session without any OTP, skipping our send limits.
- **Email**: disable (v1 has no email).
- OTP expiry `300` seconds, OTP length `6` (spec §9.1).
- Leave "Allow new users to sign up" on.

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

  Leave everything else off. Set Edge Function secrets (OTPIQ and SMS keys) by hand in the dashboard rather than from CI, so the token needs no Secrets access. If a CI run later fails with a 403, its log names the endpoint; add just that permission, read-only where possible.
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

- Done (task 2): `supabase init`, and `supabase/config.toml` mirroring step 3: phone sign-up on, email sign-up off, 6-digit OTP valid 300 s, 45 s between resends, site URL `http://localhost:3000`. The Send SMS Hook section is in place but off until Phase 1 adds `send-otp`. Migrations enable PostGIS, pg_cron and pg_net and create the five buckets.
- Done (task 2): the SessionStart hook for cloud sessions installs packages, starts Docker and runs `supabase start` in the background with `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`. In this environment the default image registry (AWS ECR) is blocked, but Docker Hub works.
- `config.toml` only configures local Supabase. Hosted auth settings stay as you set them in step 3; CI never runs `supabase config push`.
- Done (task 5): GitHub Actions in `.github/workflows/`:
  - `ci.yml` on every PR and push to `main`: Prettier check, lint, typecheck, unit tests, `supabase start` + `supabase test db`, a check that `database.types.ts` matches the schema, and Playwright.
  - `deploy-dev.yml` after CI passes on `main` (or by hand from `main`): `supabase link` → `supabase db push` → `supabase functions deploy`, with the `SUPABASE_DEV_*` repository secrets. The steps live in `.github/actions/supabase-deploy/`.
  - `deploy-prod.yml`, manual (`workflow_dispatch`, `main` only), uses the `production` environment so you approve it: the same steps against prod, then the Vercel deploy hook releases the app (`docs/deploy-setup.md`).
- `supabase/seed.sql` loads into local and dev only, never into prod. Prod gets its first admin from the `ADMIN_PHONE` seed script (spec §10.2) and real prices and slots from the dashboard.

## Checklist

- [ ] Two orgs: Zalal Dev (Free), Zalal (Pro)
- [ ] `zalal-dev` and `zalal-prod` in Frankfurt; passwords saved
- [ ] Phone auth on with Confirm phone on, email off, OTP 6 / 300 s, URLs set (both projects)
- [x] Supabase GitHub integration off for both projects (GitHub Actions deploy instead)
- [ ] Two personal access tokens, each scoped to one project (Project Settings and API Gateway Keys read, Migrations and Edge Functions read-write)
- [ ] `production` environment (you as reviewer, `main` only) holding the prod secrets; dev secrets as repository secrets
- [ ] Vercel, Sentry, PostHog and the `main` ruleset: `docs/deploy-setup.md`
- [ ] (Optional) Supabase domains allowed in this environment's network settings; plugin logged in to Zalal Dev only
