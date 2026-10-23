import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { stepsFor } from "../../.claude/hooks/after-edit";
import { protectedReason, relativePath } from "../../.claude/hooks/protect-files";

const ROOT = resolve(__dirname, "../..");
const never = () => false;
const always = () => true;

describe("protect-files hook", () => {
  it("refuses design/ and the generated types", () => {
    expect(protectedReason("design/Main.dc.html", never)).toMatch(/read-only/);
    expect(protectedReason("design/png/Main.png", never)).toMatch(/read-only/);
    expect(protectedReason("src/lib/database.types.ts", never)).toMatch(/db:types/);
  });

  it("refuses migrations on main and allows new ones", () => {
    const file = "supabase/migrations/20261023121553_extensions.sql";
    expect(protectedReason(file, always)).toMatch(/migration new/);
    expect(protectedReason(file, never)).toBeNull();
  });

  it("allows everything else", () => {
    expect(protectedReason("src/app/layout.tsx", always)).toBeNull();
    expect(protectedReason("designs.md", always)).toBeNull();
    expect(protectedReason("supabase/seed.sql", always)).toBeNull();
  });

  it("reads the path from Edit and NotebookEdit input", () => {
    expect(relativePath({ tool_input: { file_path: resolve(ROOT, "design/x.html") } }, ROOT)).toBe(
      "design/x.html",
    );
    expect(relativePath({ tool_input: { notebook_path: "src/a.ipynb" } }, ROOT)).toBe(
      "src/a.ipynb",
    );
    expect(relativePath({ tool_input: { file_path: "/tmp/elsewhere.ts" } }, ROOT)).toBeNull();
    expect(relativePath({}, ROOT)).toBeNull();
  });

  const hook = (input: unknown) =>
    spawnSync(process.execPath, [resolve(ROOT, ".claude/hooks/protect-files.ts")], {
      input: JSON.stringify(input),
      encoding: "utf8",
    });

  it("answers deny as JSON when run as a hook", () => {
    const r = hook({ tool_name: "Edit", tool_input: { file_path: resolve(ROOT, "design/x") } });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
  });

  it("stays silent for allowed files and bad input", () => {
    const r = hook({ tool_name: "Edit", tool_input: { file_path: resolve(ROOT, "src/x.ts") } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    const bad = spawnSync(process.execPath, [resolve(ROOT, ".claude/hooks/protect-files.ts")], {
      input: "not json",
      encoding: "utf8",
    });
    expect(bad.status).toBe(0);
  });
});

describe("after-edit hook", () => {
  it("lints code, formats everything, and guards every file", () => {
    expect(stepsFor("src/app/page.tsx")).toEqual(["prettier", "eslint", "guards"]);
    expect(stepsFor("scripts/guards.ts")).toEqual(["prettier", "eslint", "guards"]);
    expect(stepsFor("messages/ar.json")).toEqual(["prettier", "guards"]);
    expect(stepsFor("supabase/migrations/1_x.sql")).toEqual(["prettier", "guards"]);
    expect(stepsFor("node_modules/x/index.js")).toEqual([]);
  });

  it("does nothing for files outside the repo", () => {
    const r = spawnSync(process.execPath, [resolve(ROOT, ".claude/hooks/after-edit.ts")], {
      input: JSON.stringify({ tool_input: { file_path: "/tmp/nowhere.ts" } }),
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
  });
});
