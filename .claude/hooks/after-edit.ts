// PostToolUse hook on file edits (docs/claude-code-setup.md §3.2). Formats the
// changed file with Prettier, applies ESLint fixes, then runs the guards on it.
// Anything left over goes back to Claude (exit 2), so a problem shows up right
// after the edit instead of in CI. The edit itself has already happened.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

type HookInput = { tool_input?: { file_path?: string; notebook_path?: string } };

// Same as in protect-files.ts. Kept here so each hook runs on its own with Node.
function relativePath(input: HookInput): string | null {
  const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!path) return null;
  const rel = relative(ROOT, isAbsolute(path) ? path : resolve(ROOT, path))
    .split("\\")
    .join("/");
  return rel.startsWith("../") || rel === ".." || isAbsolute(rel) ? null : rel;
}

const ESLINT_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

export type Step = "prettier" | "eslint" | "guards";

/** The checks to run for a repo-relative path. */
export function stepsFor(rel: string): Step[] {
  if (rel.startsWith("node_modules/") || rel.startsWith(".next/")) return [];
  const steps: Step[] = ["prettier"];
  if (ESLINT_EXT.has(extname(rel))) steps.push("eslint");
  steps.push("guards");
  return steps;
}

function runNode(script: string, args: string[]) {
  const r = spawnSync(process.execPath, [resolve(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

const COMMANDS: Record<Step, (rel: string) => { ok: boolean; output: string }> = {
  prettier: (rel) =>
    runNode("node_modules/prettier/bin/prettier.cjs", [
      "--write",
      "--ignore-unknown",
      "--log-level",
      "warn",
      rel,
    ]),
  eslint: (rel) =>
    runNode("node_modules/eslint/bin/eslint.js", ["--fix", "--no-warn-ignored", rel]),
  guards: (rel) => runNode("scripts/guards.ts", [rel]),
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let rel: string | null = null;
  try {
    rel = relativePath(JSON.parse(readFileSync(0, "utf8")) as HookInput);
  } catch {
    process.exit(0);
  }
  if (!rel || !existsSync(resolve(ROOT, rel))) process.exit(0);

  const problems: string[] = [];
  for (const step of stepsFor(rel)) {
    const { ok, output } = COMMANDS[step](rel);
    if (!ok) problems.push(`${step}:\n${output}`);
  }
  if (problems.length) {
    console.error(`Fix these in ${rel} (CLAUDE.md rules):\n\n${problems.join("\n\n")}`);
    process.exit(2);
  }
}
