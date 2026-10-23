---
name: db-change
description: Make a schema change in supabase/ — tables, columns, enums, RLS policies, RPC functions, triggers, cron jobs or seed data. Writes the pgTAP tests first (allow and deny for every role), then the migration, regenerates database.types.ts, runs the RLS audit and updates spec §7. Use for any task that adds or changes SQL.
argument-hint: <what changes, e.g. "price_list and slots">
---

# Database change: $ARGUMENTS

Follow CLAUDE.md and `supabase/CLAUDE.md` throughout. Schema, RLS and auth changes need an approved plan before any SQL.

## 1. Read and plan

- Spec §7 (data model and access rules), the §6 lifecycle rules if orders are involved, and any §5/§8/§9 entry that the tables serve. Check §13 for open questions on them; ask rather than guess a business rule.
- The existing migrations the change builds on (`ls supabase/migrations`), and `supabase/tests/database/_helpers.psql`.
- In the plan, list per table: columns and types, constraints, indexes, who may read and write which columns, the RPCs and triggers, and each departure from §7 with its reason. For a real design choice, give 2 options with trade-offs and a recommendation.
- Make sure local Supabase is up (`pnpm db:test` runs). If `pnpm db:start` timed out but `docker ps` shows the containers healthy, it is up.

## 2. Tests first

- One `supabase/tests/database/<name>.test.sql` per table or RPC, in the format `supabase/CLAUDE.md` describes.
- For every policy: allowed and denied cases for anon, customer, another customer, crew and admin, plus the service role where the server writes. Also each constraint, trigger rule and RPC result, and that every table has RLS on.
- Run `pnpm db:test` and confirm the new files fail (and the old ones still pass) before writing the migration.

## 3. Migration

- `pnpm exec supabase migration new <name>`, one file per area. Header comment with the spec sections and departures.
- Per table: `enable row level security`, `revoke all … from anon, authenticated`, minimal (column) grants, policies with `(select …)` wrappers, indexes on foreign keys and policy columns, `updated_at` trigger.
- Per function: `search_path = ''`, qualified names, explicit EXECUTE grants after revoking the Supabase defaults.
- Seed rows for local and dev go in `supabase/seed.sql`; rows prod also needs (like the settings row) go in the migration.

## 4. Verify

1. `pnpm db:reset`, then `pnpm db:test` until it passes. Fix the `plan(n)` counts last.
2. Check one path through the real services, not just SQL: for example create a user through the Auth admin API, or call an RPC over REST with the publishable and secret keys (`pnpm exec supabase status -o env` prints the local keys).
3. `pnpm db:types` and commit `src/lib/database.types.ts`. Never edit it by hand.
4. `pnpm lint` (the guards check RLS and `search_path`), `pnpm typecheck`, `pnpm test`.
5. Run the `rls-auditor` subagent on the new migrations. Keep any test it writes; fix the migration until it passes.

## 5. Docs

- Spec §7: make the table list, settings keys and access rules match the database, with a short note for each departure.
- Spec §13: add any business question that came up; tick what was settled.
- `supabase/CLAUDE.md`: add any new convention, error code or helper.
- Commit tests and migrations together, docs separately.
