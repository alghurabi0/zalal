# Vercel, Sentry, PostHog and GitHub setup (for the owner)

Claude can't create these accounts or hold their keys. You do steps 1–6 once, about 30 minutes in total. The code side is already done: `vercel.json`, Sentry and PostHog in the app, and the GitHub Actions workflows. Do `docs/supabase-setup.md` first: Vercel needs the Supabase keys from its step 4.

Until you add the keys, nothing breaks. Sentry and PostHog stay off without them, and the build runs the same.

## How a change reaches users

| Step | What happens | Where it runs |
| --- | --- | --- |
| 1. Claude opens a PR | CI runs lint, types, unit tests, database and integration tests, and Playwright. Vercel builds a **preview** with its own URL, using **dev** Supabase | GitHub Actions, Vercel Preview |
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
   | `OTPIQ_API_KEY` | dev key `sk_dev_…` | live key `sk_live_…` | step 5; mark **Sensitive**. Login fails on Vercel without it |
   | `OTPIQ_SMS_SENDER_ID` | optional | optional | step 5 |
   | `OTPIQ_WHATSAPP_ACCOUNT_ID`, `_PHONE_ID`, `_TEMPLATE` | optional | optional | step 5; all three or none |
   | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | browser key | same key | step 6; without it Location shows a drawn map |

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
   - **Require status checks to pass**: add `Lint, types and unit tests`, `Database and end-to-end tests` and `Protected paths unchanged`. They appear in the list after they have run once, on the PR that adds them.

   `Protected paths unchanged` fails a PR that edits `design/` or a migration already on `main`. When you update the designs on purpose, add the label `protected-change` to that PR (create the label once under **Issues → Labels**); the check re-runs and passes. Claude never adds that label.
   - **Block force pushes.**

   This is the "block merges on red" rule (`docs/claude-code-setup.md` §3.7).
3. **Settings → Actions → General**: keep Actions allowed. The workflows need only read access to the repo.

## 5. OTPIQ (login codes)

The app server sends login codes by WhatsApp, or by SMS, through [OTPIQ](https://app.otpiq.com) (spec §9.1). The key lives only in Vercel's server env, never in the browser or in git. Locally and in CI there is no key: `pnpm dev` prints each code in its terminal instead.

1. In the OTPIQ dashboard, **Project Settings**: create a **Dev Key** with your own phone as the development number. A dev key sends every message to that number, whatever number is typed, so previews can never text a real customer. Put it in Vercel as `OTPIQ_API_KEY` for **Preview**.
2. Copy the project's live API key (`sk_live_…`) into `OTPIQ_API_KEY` for **Production**. The app refuses to start login with a dev key in Production.
3. Add credit (trial accounts only send to your own number). When OTPIQ refuses a send because of the key, credit, spending cap, trial mode or sender ID, Sentry gets an "OTPIQ account problem" error, without the phone number or code.
4. **Settings → Limits**: you can turn on the **phone number** limit as a backstop (for example 5 per 10 minutes; ours is 3 per 10 minutes). Leave the **IP address** limit off: every code is sent from Vercel's servers, so an IP limit would block all users at once.
5. Before launch (spec §12.4): connect the company WhatsApp Business number (**Connect WhatsApp account**) and get the Arabic authentication template approved, then set `OTPIQ_WHATSAPP_ACCOUNT_ID`, `OTPIQ_WHATSAPP_PHONE_ID` and `OTPIQ_WHATSAPP_TEMPLATE` (from **List WhatsApp resources**). Until then codes go out from OTPIQ's own WhatsApp account. An SMS sender ID (`OTPIQ_SMS_SENDER_ID`) needs an Iraqi company license and is optional.

## 6. Google Maps (Location)

Location (spec §5.4) shows a Google map with a search box. Without a key the screen still works with a drawn map, and the pin comes only from "موقعي الحالي", which is how it runs locally and in CI.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project named `zalal` and add a billing account (Google requires one even inside the free tier, spec §11).
2. **APIs & Services → Library**: enable **Maps JavaScript API** and **Places API (New)**.
3. **APIs & Services → Credentials → Create credentials → API key**. Under **Application restrictions** pick **Websites** and add the production domain and `*.vercel.app` previews (for example `https://zalal.iq/*` and `https://zalal-*.vercel.app/*`). Under **API restrictions** allow only the two APIs above. The key reaches the browser, so these restrictions are what protect it.
4. Put the key in Vercel as `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` for **Preview** and **Production**, then redeploy (it is read at build time).
5. Before launch (spec §12.4), replace the `*.vercel.app` entry with the real domain only.

## 7. Check it works

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
- [ ] Google Maps: log in on a preview, add an address. The map loads, search finds a Karbala street, and moving the map moves the saved pin.

## Checklist

- [ ] Vercel Pro, repo imported, env vars set per environment (PostHog in Production only)
- [ ] Region Frankfurt; deploy hook `deploy-prod` created; preview protection on
- [ ] Supabase Auth URLs updated for the Vercel URLs
- [ ] Sentry project in the EU region; DSN, org, project and auth token in Vercel; IP storage off
- [ ] PostHog EU project; key in Vercel Production; client IP discarded; replay off
- [ ] OTPIQ dev key in Vercel Preview, live key in Production; IP limit off; credit added
- [ ] Google Maps key restricted to the app's domains and the two APIs; in Vercel Preview and Production
- [ ] `VERCEL_DEPLOY_HOOK_URL` in the GitHub `production` environment
- [ ] Ruleset on `main` requiring both CI checks
- [ ] First Deploy prod run; production URL opens Welcome
