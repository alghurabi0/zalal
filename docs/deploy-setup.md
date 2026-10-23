# Vercel, Sentry, PostHog and GitHub setup (for the owner)

Claude can't create these accounts or hold their keys. You do steps 1–5 once, about 30 minutes in total. The code side is already done: `vercel.json`, Sentry and PostHog in the app, and the GitHub Actions workflows. Do `docs/supabase-setup.md` first: Vercel needs the Supabase keys from its step 4.

Until you add the keys, nothing breaks. Sentry and PostHog stay off without them, and the build runs the same.

## How a change reaches users

| Step | What happens | Where it runs |
| --- | --- | --- |
| 1. Claude opens a PR | CI runs lint, types, unit tests, database tests and Playwright. Vercel builds a **preview** with its own URL, using **dev** Supabase | GitHub Actions, Vercel Preview |
| 2. You merge to `main` | CI runs again. When it passes, **Deploy dev** applies new migrations and Edge Functions to dev Supabase. Vercel does **not** deploy `main` (`vercel.json`) | GitHub Actions |
| 3. You release | Actions → **Deploy prod** → Run workflow, then approve it. It migrates **prod** Supabase first, then tells Vercel to build `main` for **Production** | GitHub Actions, Vercel Production |

Why the release is manual: if Vercel shipped every merge, the live app could go out before its database changes and break. Deploy prod always runs database first, then app.

Two things to know:

- **Previews of PRs that change the schema.** Dev Supabase gets a PR's migrations only after the merge, so until then that PR's preview runs against the old schema. Screens that need the new tables only work on the preview after the merge.
- **Previews are private.** Vercel protects preview URLs by default. Open them on your phone while logged in to Vercel.

## 1. Vercel

1. Sign up at [vercel.com](https://vercel.com) and choose **Pro** ($20/month, spec §11). The free Hobby plan forbids commercial use.
2. **Add New → Project** → import the GitHub repo `alghurabi0/zalal`. Vercel detects Next.js and pnpm. Leave the build, install and output settings as they are: `pnpm build` also builds the service worker.
3. Skip the env vars on the import screen, because they can't be split by environment there. If the import starts a first deploy, let it finish or fail; it doesn't matter. Then open **Settings → Environment Variables** and add the rows below. Untick **Development** for every row.

   | Variable | Preview | Production | Notes |
   | --- | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | dev URL | prod URL | `docs/supabase-setup.md` step 5 |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | dev key | prod key | same |
   | `SUPABASE_SECRET_KEY` | dev key | prod key | same; mark **Sensitive** |
   | `NEXT_PUBLIC_SENTRY_DSN` | DSN | same DSN | step 2 |
   | `SENTRY_ORG` | org slug | same | step 2 |
   | `SENTRY_PROJECT` | `zalal` | same | step 2 |
   | `SENTRY_AUTH_TOKEN` | token | same token | step 2; mark **Sensitive** |
   | `NEXT_PUBLIC_POSTHOG_KEY` | — | project key | step 3; **Production only**, so previews don't pollute the numbers |

   Leave **Settings → Environment Variables → Automatically expose System Environment Variables** on. The app reads `NEXT_PUBLIC_VERCEL_ENV` from it to tag Sentry events as `production` or `preview`.
4. **Settings → Functions → Function Region**: `vercel.json` already pins `fra1` (Frankfurt, next to Supabase). Check it shows Frankfurt.
5. **Settings → Git → Deploy Hooks**: create a hook named `deploy-prod` for branch `main`. Copy its URL; it goes into GitHub in step 4. Treat it like a password: anyone with it can start a production build.
6. **Settings → Deployment Protection**: keep **Vercel Authentication** on for previews (the default). Production must stay public.
7. When the first preview build passes, run **Deploy prod** once (step 4 must be done) to create the first Production deployment. Then add your domain under **Settings → Domains** when you have one.

Then finish the Supabase step that waited on Vercel (`docs/supabase-setup.md` step 3, Authentication → URL Configuration): set prod's Site URL to the production URL, and add `https://<project>-*-<team-slug>.vercel.app/**` to dev's Redirect URLs.

## 2. Sentry (errors)

1. Sign up at [sentry.io](https://sentry.io). The free **Developer** plan is enough (spec §11). When asked for a data storage location, choose **EU (Frankfurt)**. It can't be changed later.
2. Create a project: platform **Next.js**, name `zalal`. One project serves both environments; events carry an `environment` tag (`production` or `preview`).
3. **Project Settings → Client Keys (DSN)**: copy the DSN into `NEXT_PUBLIC_SENTRY_DSN`. The DSN is not a secret; it only allows sending events.
4. **Settings → Developer Settings → Organization Tokens**: create a token named `vercel-sourcemaps`. It goes into `SENTRY_AUTH_TOKEN`. The build uses it to upload source maps, so stack traces show real file names, and then removes the maps from the deploy. `SENTRY_ORG` is the org slug from your Sentry URL, `SENTRY_PROJECT` is `zalal`.
5. **Project Settings → Security & Privacy**: turn on **Prevent Storing of IP Addresses**, and keep **Data Scrubber** on. The app already sends no user, IP, cookies, request bodies or query strings (spec §3); this is a second lock.
6. **Alerts**: the default "new issue" email alert is enough to start.

To let Claude read production errors when debugging, install the **sentry** plugin (`docs/claude-code-setup.md` §2).

## 3. PostHog (product analytics)

1. Sign up on **EU Cloud** at [eu.posthog.com](https://eu.posthog.com). The free tier is enough (spec §11).
2. Name the project `Zalal`. **Project Settings → General**: copy the **Project token** (`phc_…`) into `NEXT_PUBLIC_POSTHOG_KEY`, for **Production only**.
3. **Project Settings**:
   - **Discard client IP data**: on.
   - **Session replay**: leave off. The app turns recording off as well.
   - **Autocapture**: leave on. The app records clicks and page views without any element text, because a tapped card can show a name, phone or address.

Events go through the app's own domain (`/zl-a`), so ad blockers don't drop them. Logged-in users get a profile from Phase 1, identified by their user id, never by phone number.

## 4. GitHub

1. **Settings → Environments → `production`** (created in `docs/supabase-setup.md` step 5): add the environment secret `VERCEL_DEPLOY_HOOK_URL` with the hook URL from step 1.5. Until it exists, Deploy prod migrates the database and skips the app.
2. **Settings → Rules → Rulesets → New branch ruleset**, named `main`:
   - Enforcement: **Active**. Target: the default branch.
   - **Require a pull request before merging.**
   - **Require status checks to pass**: add `Lint, types and unit tests` and `Database and end-to-end tests`. They appear in the list after CI has run once, on the PR that adds them.
   - **Block force pushes.**

   This is the "block merges on red" rule (`docs/claude-code-setup.md` §3.7).
3. **Settings → Actions → General**: keep Actions allowed. The workflows need only read access to the repo.

## 5. Check it works

- [ ] A PR shows two green checks and a Vercel preview link. The preview opens Welcome.
- [ ] After a merge, **Deploy dev** runs and passes (Actions tab).
- [ ] **Deploy prod** waits for your approval, then migrates prod and starts a Vercel Production build.
- [ ] Sentry: send a test event through the app's error path, with your DSN and production URL filled in:

  ```sh
  printf '{"dsn":"<DSN>"}\n{"type":"event"}\n{"message":"Sentry check","level":"info"}\n' |
    curl -X POST --data-binary @- https://<production-url>/zl-e
  ```

  Within a minute Sentry shows a "Sentry check" issue. Under **Settings → Source Maps**, each build has an uploaded bundle. (Errors thrown from the browser console don't count; Sentry ignores them.)
- [ ] PostHog: open the production URL. **Activity** shows a `$pageview` within a minute.

## Checklist

- [ ] Vercel Pro, repo imported, env vars set per environment (PostHog in Production only)
- [ ] Region Frankfurt; deploy hook `deploy-prod` created; preview protection on
- [ ] Supabase Auth URLs updated for the Vercel URLs
- [ ] Sentry project in the EU region; DSN, org, project and auth token in Vercel; IP storage off
- [ ] PostHog EU project; key in Vercel Production; client IP discarded; replay off
- [ ] `VERCEL_DEPLOY_HOOK_URL` in the GitHub `production` environment
- [ ] Ruleset on `main` requiring both CI checks
- [ ] First Deploy prod run; production URL opens Welcome
