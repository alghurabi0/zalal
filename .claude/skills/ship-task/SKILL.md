---
name: ship-task
description: Finish a task from spec §12.3. Runs every check, reviews the diff, updates the docs, commits, pushes and opens the PR. Run it only when the user asks to ship.
disable-model-invocation: true
argument-hint: "[Phase N, task X]"
---

# Ship $ARGUMENTS

Stop and report at the first step that fails. Never skip a check to get green.

## 1. Branch

- `git status` and `git log --oneline origin/main..HEAD`. Work on the session's designated branch, never on `main`.
- If that branch's PR has already merged, the new work belongs on a fresh branch from `origin/main`, not stacked on the merged history.
- Merge `origin/main` in if the branch is behind, then re-run the checks below.

## 2. Checks

Run these and keep the results for the PR description:

1. `pnpm format:check`, `pnpm lint` (ESLint and `scripts/guards.ts`), `pnpm typecheck`, `pnpm test`
2. `node scripts/protected-paths.ts`: no edits to `design/` or merged migrations
3. If `supabase/` changed: `pnpm db:reset`, `pnpm db:test`, then `pnpm db:types` and check `git diff --exit-code src/lib/database.types.ts`. Every new policy has pgTAP tests for allowed and denied cases (anon, customer, other customer, crew, admin).
4. If `src/`, `messages/` or `public/` changed: `pnpm test:e2e`. In cloud sessions, set `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` first. For screens, compare the screenshots with `design/png/<Name>.png`.

## 3. Review

- Run `/code-review` on the branch and fix what it finds, or note why not.
- Run `/security-review` too when the diff touches auth, OTP, RLS, Storage, RPC functions or Edge Functions.
- Re-read the diff (`git diff origin/main...HEAD`): no secrets, no `.env` values, no personal data sent to Sentry or PostHog, no model names.

## 4. Docs

Keep the docs true, in the same PR:

- spec §12.3: tick the task.
- spec §7: update it for every schema departure, and explain the departure in the migration.
- spec §1 (decisions log) for a changed decision; §13 for an open question.
- CLAUDE.md for a new command or convention.
- docs/business-rules.md (Arabic, for the owner) for a new or changed business rule: a limit, a time, a price, who may do what, or a setting's default.

## 5. Commit and push

- One commit per logical change, with a clear message and the attribution lines the session gives you.
- `git push -u origin <branch>`. Retry only on network errors (2s, 4s, 8s, 16s).

## 6. Pull request

Open it against `main` with the GitHub tools. Title: `Phase N, task X: <what it does>`. Body, in this order:

- One sentence: what this PR does and which spec task it covers.
- **What's in it**: the main changes, grouped, in plain words.
- **Departures**: from the canvas (with the reason) and from spec §7 (with the reason). Omit if none.
- **New libraries**: name, exact version, and why it's needed. Omit if none.
- **Tests**: each command from step 2 and its result, the e2e checks added, screenshots compared, and which checks weren't needed and why.
- **Notes**: follow-ups, known gaps, and the docs updated.
- End with the attribution lines the session gives you.

Then give the user the PR link and offer to watch it for CI and review comments.
