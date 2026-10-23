# Claude Code setup and workflow for Zalal

This guide covers the tools, repo config and working loop for building Zalal with Claude Code. The plugins below can be installed now. Everything in sections 3 and 4 is done in Phase 0, once `package.json` exists.

## 1. Before Phase 0: decide these

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Design screenshots | The `design/*.dc.html` files load a `support.js` that isn't in the repo, so neither Claude nor a browser can render them. Export a PNG of each artboard from the canvas into `design/png/<Name>.png` (390×844, 2×). Claude can then compare its screenshots against them. This is the most useful thing you can add. |
| 2 | Next.js version | Use the current stable major (16 at the time of writing) rather than 15, provided Serwist and Sentry support it. Starting on an old major means a migration later. |
| 3 | Supabase environments | Local Supabase (Docker) for development and tests, a hosted **dev** project for previews, and a separate **prod** project. Claude never gets prod credentials. Only you or CI on `main` push migrations to prod. |
| 4 | Open items in spec §13 | Settle the "before Phase 1" items (SMS provider, districts) before Phase 1 starts. |

## 2. Plugins to install (claude.ai → Plugins / `/plugin`)

| Plugin | Why | When |
| --- | --- | --- |
| **supabase** (official, by Supabase) | The MCP server lets Claude inspect tables, policies and logs, run SQL on a dev project, and read the security and performance advisors, which catch missing RLS and unindexed foreign keys. It also bundles a Postgres best-practices skill. Connect it to the **dev** project only, read-only where possible. | Now |
| **playwright** (official, by Microsoft) | Lets Claude open the running app at 390×844, click through flows and take screenshots to compare with the designs. Chromium is already installed in cloud sessions. | Now |
| **Axe Accessibility** (by Deque) | Scan → fix → verify loop for WCAG issues. The spec's Phase 6 QA asks for labels, 44px targets and contrast. | Phase 1 onward |
| **sentry** (official) | Lets Claude read real production errors and stack traces when debugging. | When Sentry is live (Phase 0 setup, useful from Phase 2) |

Skip the community Supabase plugins: they overlap with the official one. There is no Vercel plugin in the catalog; the `vercel` CLI covers it. Optionally, add a docs MCP (for example Context7) so Claude reads current docs for Next.js, Supabase, Tailwind v4 and Serwist instead of relying on memory.

### Built-in skills you already have

- `/code-review`: run on every branch before you open the PR.
- `/security-review`: run on every PR that touches auth, OTP, RLS, Storage, RPC functions or Edge Functions.
- `/simplify`: run after a big feature lands, to clean up duplication.
- `frontend-design`: for the crew app and admin dashboard, which have no designs.
- `design:accessibility-review`, `design:ux-copy`: QA passes and empty/error-state copy. Review any Arabic copy yourself.
- `session-start-hook`: generates the cloud SessionStart hook (section 3.1).

## 3. Repo configuration (Phase 0)

### 3.1 SessionStart hook (cloud sessions)

Cloud sessions start from a fresh clone, so `.claude/hooks/session-start.sh` must prepare everything the checks need:

- `pnpm install --frozen-lockfile`
- Start Docker if it isn't running. Cloud containers have Docker installed but the daemon stopped, so start `dockerd` in the background and wait for `docker info` to succeed. Local Supabase and the pgTAP RLS tests need it.
- `pnpm exec supabase start` (installs the Supabase CLI as a dev dependency so the version is pinned)

Ask Claude: "use the session-start-hook skill to set this up".

### 3.2 `.claude/settings.json` (committed)

- **Permissions, allow:** `pnpm lint|typecheck|test|test:e2e|db:reset|db:test|db:types`, `git status|diff|log`, `supabase migration new`.
- **Permissions, deny or ask:** reading `.env*`, `supabase db push`, anything with `--linked` or a prod project ref.
- **PostToolUse hook** on Edit/Write: run Prettier and `eslint --fix` on the changed file, so formatting never costs a review round.
- **PreToolUse hook** on Edit/Write: refuse edits under `design/` and to any migration already on `main` (a new migration is required instead).

### 3.3 Guard scripts (enforce the rules in CLAUDE.md)

Rules in prose get missed; rules that fail `pnpm lint` don't. Add a small `scripts/guards.ts` and run it from `pnpm lint`, so both CI and Claude hit it:

- No physical direction classes or properties in `src/` (`ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right`, `rounded-l`, `rounded-r`, `margin-left`, …).
- No hex colors or `rgb(` in `src/`, except the theme CSS and files under `src/components/illustrations/`.
- No Arabic characters (`\p{Script=Arabic}`) in `.tsx` files; strings belong in `messages/ar.json`.
- Every `create table` in `supabase/migrations/` has a matching `enable row level security`.

### 3.4 Project skills (`.claude/skills/`)

Write each one after the first time its workflow is done by hand, then refine it.

- **`build-screen <Name>`**: read `design/<Name>.dc.html`, its PNG and the spec §5 entry. List the "Change:" items first, then build with the UI kit, put strings in `ar.json` and add all 4 states. Finish by taking a Playwright screenshot at 390×844 and listing differences from the design.
- **`db-change`**: create the migration, the RLS policies and the pgTAP tests (allow and deny for each role), regenerate types, and update spec §7 if the design departs from it.
- **`ship-task`**: run lint, typecheck and tests, then `db:test`, then `/code-review`, then commit and open the PR with the "why" for any new library.

### 3.5 Subagents (`.claude/agents/`)

- **`rls-auditor`**: read-only. Given a migration, tries to find ways one customer could read or write another customer's data, or a crew could see orders it isn't assigned to. Writes failing pgTAP tests for what it finds.
- **`design-checker`**: read-only. Compares a screenshot with the design file and its PNG and reports differences (spacing, tokens, copy, RTL mistakes).

### 3.6 Nested CLAUDE.md files

These load only when Claude works in that folder, which keeps the root file short:

- `supabase/CLAUDE.md`: SQL conventions. `security definer` functions must `set search_path = ''`, plus naming, `transition_order` rules and pgTAP helpers.
- `src/app/crew/CLAUDE.md`: mobile, one big action button, GPS and Wake Lock rules, the upload retry queue.
- `src/app/admin/CLAUDE.md`: desktop-first, every write goes to the audit log, sound and push alerts.

### 3.7 GitHub

- CI (GitHub Actions): lint, typecheck, unit tests, `supabase start` + `supabase test db`, then Playwright smoke tests. Block merges on red.
- Install the Claude GitHub App (`/install-github-app`) so `@claude` can answer review comments and fix CI on PRs.

## 4. The working loop

1. **Start each task fresh.** Use a new session (or `/clear`) and a new branch, with one task from spec §12.3 per session. Prompt: *"Read CLAUDE.md. Do Phase N, task X. Plan first."*
2. **Plan, then approve.** Use plan mode for anything touching schema, RLS, auth or more than a few files. Push back on the plan here, before code exists; it's much cheaper.
3. **Test first for rules.** Write transition guards, slot capacity, the 2 h cutoff, OTP limits and RLS as failing tests before the code.
4. **Build, then verify visually.** For screens, Claude screenshots at 390×844 and compares with the design PNG before saying it's done.
5. **Review.** Run `/code-review`, plus `/security-review` where relevant. Then open the PR; CI must be green.
6. **You merge.** Read the PR description and check the preview deploy on your phone (RTL, Arabic copy, touch targets).
7. **Keep docs true.** A changed decision goes in spec §1 or §13 in the same PR.

Tips:

- **Size tasks to one PR.** Split a phase into PR-sized tasks. "Build Booking step 1" is a good task; "Phase 2" is not.
- **Run parallel sessions carefully.** UI work and DB work can run in separate cloud sessions on separate branches. Don't run two sessions that both add migrations at once: their timestamps and dependencies collide.
- **Watch context size.** Long sessions drift. When a session gets long, ask Claude to summarize progress into the PR description and continue in a fresh one.
- **Ask for options on schema.** For schema and architecture, ask Claude to propose 2 options with trade-offs before choosing. This fits the §7 note that the schema is a starting point.
- **Real-device checks are yours.** OTP over WhatsApp, PWA install, iPhone push and GPS while driving can't be tested in a container. Each phase's "Done when" item needs you with a phone.
