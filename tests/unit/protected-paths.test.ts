import { describe, expect, it } from "vitest";

import { parseNameStatus, protectedChanges } from "../../scripts/protected-paths";

describe("protected-paths", () => {
  it("parses git name-status output", () => {
    expect(parseNameStatus("M\tdesign/Main.dc.html\nA\tsrc/x.ts\n")).toEqual([
      { status: "M", path: "design/Main.dc.html" },
      { status: "A", path: "src/x.ts" },
    ]);
  });

  it("flags changed or deleted design files and migrations", () => {
    const problems = protectedChanges([
      { status: "M", path: "design/Main.dc.html" },
      { status: "D", path: "design/png/Main.png" },
      { status: "M", path: "supabase/migrations/20261023121553_extensions.sql" },
      { status: "T", path: "supabase/migrations/20261023121557_storage_buckets.sql" },
    ]);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/read-only/);
    expect(problems[2]).toMatch(/add a new migration/);
  });

  it("allows new files and changes elsewhere", () => {
    expect(
      protectedChanges([
        { status: "A", path: "supabase/migrations/20261101000000_profiles.sql" },
        { status: "A", path: "design/png/New.png" },
        { status: "M", path: "supabase/seed.sql" },
        { status: "M", path: "src/app/layout.tsx" },
      ]),
    ).toEqual([]);
  });
});
