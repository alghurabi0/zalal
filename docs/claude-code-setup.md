# Claude Code setup and workflow for Zalal

This guide covers the tools, repo config and working loop for building Zalal with Claude Code. The plugins below can be installed now. Section 3 describes the repo config set up in Phase 0; section 4 is the working loop.

## 1. Decisions before Phase 0

| # | Decision | Status |
| --- | --- | --- |
| 1 | Design screenshots | **Decided:** PNGs of each artboard go in `design/png/<Name>.png` (same name as the `.dc.html`). The `.dc.html` files can't render because their `support.js` is missing. |
| 2 | Next.js version | **Decided:** Next.js 16. |
| 3 | Supabase environments | **Decided:** local (Docker) + dev + prod, in separate orgs; Claude never gets prod credentials; CI deploys migrations. Your setup steps are in `docs/supabase-setup.md`. |
| 4 | Open items in spec §13 | Settle the "before Phase 1" items (SMS provider, districts) before Phase 1 starts. |

### Tested in this cloud environment (Oct 23, 2026)

- npm registry, GitHub and Docker Hub: reachable.
- AWS ECR image downloads: blocked, so the Supabase CLI must use `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.
- `supabase.com`, `api.supabase.com`, `mcp.supabase.com`: blocked. The Supabase plugin can't connect until you allow these hosts (`docs/supabase-setup.md` step 6).
- Docker: installed but not running at session start. `dockerd` starts fine (running as root).
- Result: `supabase start` (with studio, imgproxy, logflare, vector, supavisor, edge-runtime and postgres-meta excluded) and `supabase test db` (pgTAP) both work. The first pull is a few GB and takes a few minutes per fresh session.

## 2. Plugins to install (claude.ai → Plugins / `/plugin`)

| Plugin | Why | When |
| --- | --- | --- |
| **supabase** (official, by Supabase) | The MCP server lets Claude inspect tables, policies and logs, run SQL on a dev project, and read the security and performance advisors, which catch missing RLS and unindexed foreign keys. It also bundles a Postgres best-practices skill, which works now. Log in to the **Zalal Dev** org only. The MCP part needs the Supabase hosts allowed in this environment's network settings. | Installed |
| **playwright** (official, by Microsoft) | Lets Claude open the running app at 390×844, click through flows and take screenshots to compare with the designs. Chromium is already installed in cloud sessions. | Installed |
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

## 3. Repo configuration

Sections 3.1–3.4 were set up in Phase 0. Sections 3.5 and 3.6 come later, with the work they serve.

### 3.1 SessionStart hook (cloud sessions)

Cloud sessions start from a fresh clone, so `.claude/hooks/session-start.sh` prepares everything the checks need. It runs only when `CLAUDE_CODE_REMOTE=true`:

- `pnpm install --frozen-lockfile`
- Starts `dockerd` if it isn't running (cloud containers have Docker installed but the daemon stopped) and waits for `docker info`. Local Supabase and the pgTAP tests need it.
- Starts `pnpm db:start` in the background (`.claude/hooks/start-supabase.sh`, log in `/tmp/supabase-start.log`), so the session doesn't wait on the image pull, then writes `.env.local` from the local keys. It exports `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` and `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` for the session.
- `db:start` excludes services tests don't need, `edge-runtime` included. Phase 1 drops `edge-runtime` from that list, when the OTP hook needs it.

### 3.2 `.claude/settings.json` (committed)

- **Allowed without a prompt:** `pnpm lint|guards|typecheck|test|test:e2e|format|format:check|db:start|db:stop|db:reset|db:test|db:types`, `git status|diff|log`, `pnpm exec supabase migration new`.
- **Denied:** reading `.env`, `.env*.local` and `supabase/.env`; editing `design/`; `supabase link`, `db push`, `functions deploy`, `secrets set`, and any `supabase` command with `--linked` or `--project-ref`. Bash deny rules match the command text, so they stop the normal form of a command but aren't a sandbox. A command that merely mentions one of those flags (a commit message, a grep) is refused too; write the message to a file and use `git commit -F`.
- **PreToolUse hook** (`.claude/hooks/protect-files.ts`) on Edit, Write and NotebookEdit: refuses edits to `design/`, to `src/lib/database.types.ts` (run `pnpm db:types`) and to any migration already on `origin/main` (create a new migration instead).
- **PostToolUse hook** (`.claude/hooks/after-edit.ts`) on the same tools: runs Prettier and `eslint --fix` on the changed file, then the guards. Whatever is still wrong goes back to Claude straight away. It takes about 2 seconds per edit.
- Both hooks are TypeScript that Node 22.18+ runs directly, so they work on macOS, Linux and Windows. `tests/unit/claude-hooks.test.ts` covers them.

### 3.3 Guard scripts (enforce the rules in CLAUDE.md)

Rules in prose get missed; rules that fail `pnpm lint` don't. `scripts/guards.ts` runs at the end of `pnpm lint`, so CI, the edit hook and Claude all hit it. `pnpm guards <files>` checks only those files. The rules:

| Rule | Checks |
| --- | --- |
| `no-physical-direction` | `src/`: no `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left/right`, `rounded-l/r/tl/…`, `border-l/r`, `float-`, `scroll-m/p-l/r`, `origin-/bg-/object-left/right` classes (with any variant), no `margin-left`-style CSS properties, no `marginLeft`-style inline styles |
| `no-raw-color` | `src/`: no hex, `rgb(`, `hsl(`, `oklch(`… except `globals.css`, `src/components/illustrations/` and `src/lib/brand.ts` (the manifest colors; a unit test keeps them equal to the tokens) |
| `no-arbitrary-value` | `src/`: no `bg-[#…]`, `rounded-[13px]`, `bg-(--x)` or `[prop:value]` classes. Arbitrary variants like `data-[state=open]:` are fine |
| `no-arabic` | `src/**/*.ts(x)`: no Arabic outside comments; strings belong in `messages/ar.json` |
| `rls-enabled` | `supabase/migrations/`: each `create table` has `enable row level security` in the same file, so a table never ships without RLS |
| `definer-search-path` | `supabase/migrations/`: each `security definer` function sets `search_path = ''` |

Comments are skipped, and `src/lib/database.types.ts` is generated, so it isn't checked. For a justified exception, comment `guard-allow <rule>: <reason>` on the line or the line above. The reason is required. `tests/unit/guards.test.ts` covers each rule.

**Protected paths in CI.** The edit hook can't see changes made from the shell, so `.github/workflows/protected-paths.yml` runs `scripts/protected-paths.ts` on every PR. It fails when the PR changes or deletes a file in `design/` or a migration already on `main`; new files are fine. For a deliberate design update, the owner adds the `protected-change` label to the PR (`docs/deploy-setup.md` §4).

### 3.4 Project skills (`.claude/skills/`)

Each skill is written after its workflow has been done by hand once, then refined.

- **`/build-screen <Name>`**: reads `design/<Name>.dc.html`, its PNG and the spec §5 entry; lists the "Change:" items, kit components, missing tokens and strings first; builds with the UI kit, `ar.json` and all 4 states; ends with a Playwright screenshot at 390×844 compared with the PNG, and a list of departures.
- **`/ship-task`**: runs format, lint, typecheck and unit tests, the protected-paths check, `db:test` and types when SQL changed, and e2e when the UI changed; then `/code-review` (plus `/security-review` where relevant), the doc updates, commits, push and the PR. Only you start it; Claude doesn't load it on its own.
- **`db-change`** (Phase 1, first schema task): create the migration, the RLS policies and the pgTAP tests (allow and deny for each role), regenerate types, and update spec §7 if the design departs from it. It waits until that workflow has been done by hand once.

### 3.5 Subagents (`.claude/agents/`, from Phase 1)

- **`rls-auditor`**: read-only. Given a migration, tries to find ways one customer could read or write another customer's data, or a crew could see orders it isn't assigned to. Writes failing pgTAP tests for what it finds. Add it with the first RLS policies.
- **`design-checker`**: read-only. Compares a screenshot with the design file and its PNG and reports differences (spacing, tokens, copy, RTL mistakes).

### 3.6 Nested CLAUDE.md files (when the folders exist)

These load only when Claude works in that folder, which keeps the root file short:

- `supabase/CLAUDE.md` (Phase 1): SQL conventions. `security definer` functions must `set search_path = ''` (the guards check this), plus naming, `transition_order` rules and pgTAP helpers.
- `src/app/crew/CLAUDE.md` (Phase 3): mobile, one big action button, GPS and Wake Lock rules, the upload retry queue.
- `src/app/admin/CLAUDE.md` (Phase 3): desktop-first, every write goes to the audit log, sound and push alerts.

### 3.7 GitHub

- CI (GitHub Actions): format, lint (with the guards), typecheck, unit tests, `supabase start` + `supabase test db` + a generated-types check, then Playwright. The protected-paths workflow runs alongside. Block merges on red (`docs/deploy-setup.md` §4).
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
