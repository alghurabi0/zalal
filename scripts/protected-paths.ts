// Fails when a branch changes files that must never change by hand (CLAUDE.md):
// - design/: read-only canvas exports
// - a migration already on the base branch: add a new migration instead
// Adding files is fine (a new migration, a new design export).
//
//   node scripts/protected-paths.ts [base]   base defaults to origin/main
//
// CI runs it on every PR (.github/workflows/protected-paths.yml). The Claude Code
// edit hook (.claude/hooks/protect-files.ts) catches the same edits earlier, but
// it can't see changes made from the shell.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Change = { status: string; path: string };

/** Parses `git diff --name-status --no-renames` output. */
export function parseNameStatus(output: string): Change[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status = "", path = ""] = line.split("\t");
      return { status: status.slice(0, 1), path };
    });
}

const WHAT: Record<string, string> = { M: "changed", D: "deleted", T: "changed type" };

/** Changes to existing protected files, as messages. */
export function protectedChanges(changes: Change[]): string[] {
  return changes
    .filter((c) => c.status !== "A")
    .filter((c) => c.path.startsWith("design/") || /^supabase\/migrations\//.test(c.path))
    .map((c) => {
      const what = WHAT[c.status] ?? `status ${c.status}`;
      return c.path.startsWith("design/")
        ? `${c.path} ${what}: design/ is read-only`
        : `${c.path} ${what}: merged migrations never change; add a new migration instead`;
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] ?? "origin/main";
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const mergeBase = git("merge-base", base, "HEAD");
  const diff = git(
    "diff",
    "--name-status",
    "--no-renames",
    mergeBase,
    "HEAD",
    "--",
    "design",
    "supabase/migrations",
  );
  const problems = protectedChanges(parseNameStatus(diff));
  for (const p of problems) console.error(p);
  if (problems.length) {
    console.error(
      `\n${problems.length} protected file(s) changed since ${base}. If this is a deliberate ` +
        'design update by the owner, add the "protected-change" label to the PR.',
    );
    process.exit(1);
  }
  console.log(`No protected files changed since ${base}.`);
}
