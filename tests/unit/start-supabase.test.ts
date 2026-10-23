// .claude/hooks/start-supabase.sh, run with fake pnpm, docker, node and sleep
// first on PATH, so no Docker or Supabase is needed.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../.claude/hooks/start-supabase.sh");

// Each fake logs its call to calls.log. pnpm fails its first $FAKE_START_FAILURES
// calls; docker inspect answers "starting" for its first $FAKE_STARTING_POLLS
// calls, then "healthy".
const FAKES: Record<string, string> = {
  pnpm: `echo "pnpm $*" >> "$FAKE_DIR/calls.log"
n=$(grep -c '^pnpm' "$FAKE_DIR/calls.log")
if [ "$n" -le "\${FAKE_START_FAILURES:-0}" ]; then
  echo "supabase_db_zalal container is not ready: starting" >&2
  exit 1
fi`,
  docker: `echo "docker $1" >> "$FAKE_DIR/calls.log"
if [ "$1" = info ]; then [ "\${FAKE_DOCKER_DOWN:-0}" = 1 ] && exit 1; exit 0; fi
if [ "$1" = inspect ]; then
  n=$(grep -c '^docker inspect' "$FAKE_DIR/calls.log")
  if [ "$n" -le "\${FAKE_STARTING_POLLS:-0}" ]; then echo starting; else echo healthy; fi
fi`,
  node: `echo "node $*" >> "$FAKE_DIR/calls.log"`,
  sleep: `true`,
};

function run(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "start-supabase-"));
  const bin = join(dir, "bin");
  const project = join(dir, "project");
  mkdirSync(bin);
  mkdirSync(join(project, "supabase"), { recursive: true });
  writeFileSync(join(project, "supabase/config.toml"), 'project_id = "zalal"\n');
  writeFileSync(join(dir, "calls.log"), "");
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const r = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CLAUDE_PROJECT_DIR: project,
      FAKE_DIR: dir,
      ...env,
    },
  });
  const calls = readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n").filter(Boolean);
  return { ...r, calls };
}

const count = (calls: string[], prefix: string) => calls.filter((c) => c.startsWith(prefix)).length;

describe.skipIf(process.platform === "win32")("start-supabase hook", () => {
  it("starts Supabase and writes .env.local", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(count(r.calls, "pnpm db:start")).toBe(1);
    expect(r.calls).toContain("node scripts/write-env-local.mjs");
    expect(r.stdout).toContain("Supabase is ready.");
  });

  it("waits for a booting database, then retries", () => {
    const r = run({ FAKE_START_FAILURES: "1", FAKE_STARTING_POLLS: "3" });
    expect(r.status).toBe(0);
    expect(count(r.calls, "pnpm db:start")).toBe(2);
    expect(count(r.calls, "docker inspect")).toBe(4);
    expect(r.calls.at(-1)).toBe("node scripts/write-env-local.mjs");
    expect(r.stderr).toContain("attempt 1 of 3");
    expect(r.stdout).toContain("Supabase is ready.");
  });

  it("gives up after 3 attempts without writing .env.local", () => {
    const r = run({ FAKE_START_FAILURES: "99" });
    expect(r.status).toBe(1);
    expect(count(r.calls, "pnpm db:start")).toBe(3);
    expect(r.calls).not.toContain("node scripts/write-env-local.mjs");
    expect(r.stderr).toContain("failed to start after 3 attempts");
    expect(r.stdout).not.toContain("Supabase is ready.");
  });

  it("skips Supabase when Docker isn't running", () => {
    const r = run({ FAKE_DOCKER_DOWN: "1" });
    expect(r.status).toBe(1);
    expect(count(r.calls, "pnpm")).toBe(0);
    expect(r.stderr).toContain("Docker isn't running");
  });

  it("is executable, since session-start.sh runs it directly", () => {
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });
});
