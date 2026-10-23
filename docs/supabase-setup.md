# Supabase setup (for the owner)

Claude can't create Supabase projects or see your dashboard: this cloud environment blocks `supabase.com`, and project creation needs your account and billing. You do steps 1–6 once, about 30 minutes in total. Everything else (schema, RLS, functions, buckets, seed) is code that Claude writes in `supabase/` and CI deploys.

## How the environments fit together

| Environment | Where it runs | Who uses it | How migrations get there |
| --- | --- | --- | --- |
| **Local** | Docker, inside each Claude session and on your laptop | Claude, tests, CI | `supabase db reset` |
| **Dev** (staging) | Supabase project `zalal-dev` | Vercel preview deploys, you testing on a phone | GitHub Action, automatically on every merge to `main` |
| **Prod** | Supabase project `zalal-prod` | Real customers | GitHub Action, **only when you start it by hand** and approve it |

Claude never holds prod credentials. Claude works locally; GitHub Actions push migrations to dev and prod.

## 1. Create two organizations (this keeps prod out of Claude's reach)

In [supabase.com/dashboard](https://supabase.com/dashboard), create two **organizations**, not just two projects:

- **Zalal Dev** on the **Free** plan. Free projects pause after a week without traffic; un-pause from the dashboard when needed.
- **Zalal** on the **Pro** plan ($25/month, spec §11). Prod lives here.

Why two orgs: when you connect the Supabase plugin, its login is granted per organization. Grant it only **Zalal Dev**, and Claude can't reach prod even by mistake.

## 2. Create the projects

In each org, create one project:

| Setting | Dev | Prod |
| --- | --- | --- |
| Name | `zalal-dev` | `zalal-prod` |
| Region | Central EU (Frankfurt) `eu-central-1` | same |
| Database password | Generate one and store it in your password manager | Generate a **different** one and store it |

Write down each **project ref**, the 20-character id in the project URL (`https://supabase.com/dashboard/project/<ref>`).

### 2a. If you connected the projects to GitHub (Supabase's GitHub integration)

Check **Project Settings → Integrations → GitHub** in each project:

- **Dev:** keeping it connected is fine and simpler. With "Deploy to production" on and the production branch set to `main`, Supabase applies migrations to dev on every merge, so CI won't need a `deploy-dev.yml`. Keep **automatic branching off** (preview branches cost extra and aren't needed).
- **Prod:** **disconnect it**, or at least turn "Deploy to production" off. Otherwise every merge to `main` changes the live database with no approval step. Prod migrations go through the manual, approved GitHub Action instead.
- Set the Supabase directory to `supabase` (the default).

## 3. Auth settings (both projects)

Go to **Authentication → Sign In / Providers**:

- **Phone**: enable. Leave the SMS provider unset for now; Phase 1 adds our own **Send SMS Hook** (WhatsApp/SMS via OTPIQ), configured under **Authentication → Hooks**.
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

Also create a **personal access token** at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens), named `zalal-github-ci`. CI uses it to push migrations.

## 5. Put the secrets where they belong

**GitHub** (repo → Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | the personal access token |
| `SUPABASE_DEV_PROJECT_REF` / `SUPABASE_DEV_DB_PASSWORD` | dev ref and password |
| `SUPABASE_PROD_PROJECT_REF` / `SUPABASE_PROD_DB_PASSWORD` | prod ref and password |

Then go to repo → Settings → **Environments** and create an environment named `production` with **Required reviewers = you**. The prod deploy workflow waits for your click.

**Vercel** (project → Settings → Environment Variables), after Phase 0 creates the Next.js app. Create **one** Vercel project (not one per environment): its Production environment points to prod Supabase and its Preview environment to dev. Set these by hand rather than with the Supabase ↔ Vercel integration, which syncs a single Supabase project into every environment.

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

- `supabase init`, `supabase/config.toml` (phone sign-up on and the Send SMS Hook wired up locally, mirroring step 3 where the CLI supports it), and the migrations for extensions and buckets.
- The SessionStart hook for cloud sessions starts Docker and runs `supabase start` with `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`. In this environment the default image registry (AWS ECR) is blocked, but Docker Hub works. This was tested: `supabase start` and `supabase test db` (pgTAP) both run in a cloud session.
- GitHub Actions:
  - `ci.yml` on every PR: lint, typecheck, unit tests, `supabase start` + `supabase test db`, Playwright.
  - `deploy-dev.yml` on push to `main`: `supabase link --project-ref $SUPABASE_DEV_PROJECT_REF` → `supabase db push` → `supabase functions deploy`. Skip this file if the dev project's GitHub integration already deploys on merge (step 2a).
  - `deploy-prod.yml`, manual (`workflow_dispatch`), uses the `production` environment so you approve it: the same steps against prod.
- `supabase/seed.sql` loads into local and dev only, never into prod. Prod gets its first admin from the `ADMIN_PHONE` seed script (spec §10.2) and real prices and slots from the dashboard.

## Checklist

- [ ] Two orgs: Zalal Dev (Free), Zalal (Pro)
- [ ] `zalal-dev` and `zalal-prod` in Frankfurt; passwords saved
- [ ] Phone auth on, email off, OTP 6 / 300 s, URLs set (both projects)
- [ ] Personal access token created
- [ ] GitHub secrets + `production` environment with you as required reviewer
- [ ] (After Phase 0) Vercel env vars for Preview and Production
- [ ] (Optional) Supabase domains allowed in this environment's network settings; plugin logged in to Zalal Dev only
