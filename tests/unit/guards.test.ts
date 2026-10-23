import { describe, expect, it } from "vitest";

import { checkFile, run, scopeOf, utilityOf, type RuleId } from "../../scripts/guards";

const rules = (file: string, text: string): RuleId[] => checkFile(file, text).map((v) => v.rule);
const tsx = (text: string) => rules("src/components/x.tsx", text);
const css = (text: string) => rules("src/app/x.css", text);
const sql = (text: string) => rules("supabase/migrations/20260101000000_x.sql", text);

describe("scopeOf", () => {
  it("covers src code, css and migrations only", () => {
    expect(scopeOf("src/app/page.tsx")).toBe("source");
    expect(scopeOf("src/lib/dates.ts")).toBe("source");
    expect(scopeOf("src/app/globals.css")).toBe("css");
    expect(scopeOf("supabase/migrations/1_x.sql")).toBe("sql");
    expect(scopeOf("supabase/seed.sql")).toBeNull();
    expect(scopeOf("tests/e2e/kit.spec.ts")).toBeNull();
    expect(scopeOf("src/lib/database.types.ts")).toBeNull();
  });
});

describe("utilityOf", () => {
  it("strips variants, important and negative markers", () => {
    expect(utilityOf("md:hover:-ml-2!").utility).toBe("ml-2");
    expect(utilityOf("data-[state=open]:animate-in").utility).toBe("animate-in");
    expect(utilityOf("supports-[display:grid]:grid").utility).toBe("grid");
  });
});

describe("no-physical-direction", () => {
  it.each([
    "ml-2",
    "-mr-1",
    "md:pl-4",
    "pr-safe-4",
    "left-0",
    "-right-2",
    "text-left",
    "text-right",
    "rounded-l",
    "rounded-tr-card",
    "border-l",
    "border-r-2",
    "float-right",
    "scroll-ml-2",
    "origin-top-left",
    "bg-right",
  ])("flags %s", (cls) => {
    expect(tsx(`<div className="flex ${cls}" />`)).toContain("no-physical-direction");
  });

  it.each([
    "ms-2",
    "-me-1",
    "ps-4",
    "pe-safe-4",
    "start-0",
    "end-2",
    "text-start",
    "rounded-s",
    "rounded-e-card",
    "border-s",
    "border-light",
    "rounded-full",
    "inset-x-0",
  ])("allows %s", (cls) => {
    expect(tsx(`<div className="flex ${cls}" />`)).toEqual([]);
  });

  it("flags left/right CSS properties", () => {
    expect(css(".a { margin-left: 4px; }")).toEqual(["no-physical-direction"]);
    expect(css(".a { left: 0; }")).toEqual(["no-physical-direction"]);
    expect(css(".a { text-align: right; }")).toEqual(["no-physical-direction"]);
    expect(css(".a { margin-inline-start: 4px; inset-inline-end: 0; }")).toEqual([]);
  });

  it("flags left/right inline styles", () => {
    expect(tsx("<div style={{ marginLeft: 4 }} />")).toEqual(["no-physical-direction"]);
    expect(tsx(`<div style={{ textAlign: "right" }} />`)).toEqual(["no-physical-direction"]);
    expect(tsx("<div style={{ marginInlineStart: 4 }} />")).toEqual([]);
  });

  it("ignores comments", () => {
    expect(tsx("// never ml-2, use ms-2\nconst a = 1;")).toEqual([]);
    expect(tsx("/* text-left */ const a = 1;")).toEqual([]);
  });
});

describe("no-raw-color", () => {
  it("flags hex and color functions", () => {
    expect(tsx(`<div className="bg-navy" style={{ color: "#0b2545" }} />`)).toContain(
      "no-raw-color",
    );
    expect(tsx(`const c = "#fff";`)).toEqual(["no-raw-color"]);
    expect(css(".a { color: rgb(0 0 0); }")).toEqual(["no-raw-color"]);
    expect(css(".a { color: oklch(0.5 0.1 200); }")).toEqual(["no-raw-color"]);
  });

  it("allows tokens, ids and entities", () => {
    expect(tsx(`<a href="#main" className="text-teal">x</a>`)).toEqual([]);
    expect(tsx(`<span>&#123;</span>`)).toEqual([]);
    expect(css(".a { color: var(--color-navy); }")).toEqual([]);
  });

  it("allows the theme, illustrations and brand colors", () => {
    expect(rules("src/app/globals.css", "--color-navy: #0b2545;")).toEqual([]);
    expect(rules("src/components/illustrations/w.tsx", `<path fill="#1b4a7a" />`)).toEqual([]);
    expect(rules("src/lib/brand.ts", `navy: "#0b2545",`)).toEqual([]);
  });
});

describe("no-arbitrary-value", () => {
  it.each([
    "bg-[#0b2545]",
    "rounded-[13px]",
    "w-[calc(100%-2px)]",
    "bg-(--x)",
    "[mask-type:alpha]",
  ])("flags %s", (cls) => {
    expect(tsx(`<div className="${cls}" />`)).toContain("no-arbitrary-value");
  });

  it("allows arbitrary variants and ordinary code", () => {
    expect(tsx(`<div className="data-[state=open]:animate-in [&>svg]:size-4" />`)).toEqual([]);
    expect(tsx("const a: string[] = [items[0], map['x']];")).toEqual([]);
    expect(tsx("type T = { [key: string]: number };")).toEqual([]);
  });
});

describe("no-arabic", () => {
  it("flags Arabic in code and JSX text", () => {
    expect(tsx(`const t = "احجز";`)).toEqual(["no-arabic"]);
    expect(tsx(`<p>احجز</p>`)).toEqual(["no-arabic"]);
    expect(rules("src/lib/schema.ts", `z.string().min(1, "مطلوب")`)).toEqual(["no-arabic"]);
  });

  it("ignores comments", () => {
    expect(tsx(`// copy: "اعد المحاولة"\nconst a = 1;`)).toEqual([]);
  });
});

describe("rls-enabled", () => {
  it("flags a table without RLS", () => {
    expect(sql("create table public.orders (id uuid primary key);")).toEqual(["rls-enabled"]);
  });

  it("accepts RLS in the same file, in any spelling", () => {
    expect(
      sql(`
        create table if not exists orders (id uuid);
        alter table public.orders enable row level security;
        CREATE TABLE "Public"."Mixed" (id int);
        ALTER TABLE "Public"."Mixed" ENABLE ROW LEVEL SECURITY;
        create table private.jobs (id int);
        alter table only private.jobs enable row level security;
      `),
    ).toEqual([]);
  });

  it("matches the schema", () => {
    expect(
      sql(`
        create table private.orders (id uuid);
        alter table public.orders enable row level security;
      `),
    ).toEqual(["rls-enabled"]);
  });

  it("ignores comments and temp tables", () => {
    expect(sql("-- create table x (id int);\n/* create table y (id int); */")).toEqual([]);
    expect(sql("create temp table scratch (id int);")).toEqual([]);
  });

  it("reports the line of the create", () => {
    const [v] = checkFile("supabase/migrations/1_x.sql", "-- one\n\ncreate table t (id int);");
    expect(v?.line).toBe(3);
  });
});

describe("definer-search-path", () => {
  const fn = (opts: string) => `
    create or replace function public.f() returns void
    language plpgsql ${opts}
    as $$ begin perform 1; end; $$;
  `;

  it("flags security definer without an empty search_path", () => {
    expect(sql(fn("security definer"))).toEqual(["definer-search-path"]);
    expect(sql(fn("security definer set search_path = public"))).toEqual(["definer-search-path"]);
  });

  it("accepts an empty search_path and invoker functions", () => {
    expect(sql(fn("security definer set search_path = ''"))).toEqual([]);
    expect(sql(fn("security definer set search_path to ''"))).toEqual([]);
    expect(sql(fn("security invoker"))).toEqual([]);
    expect(sql(fn(""))).toEqual([]);
  });

  it("only reads the function header, not its body", () => {
    expect(
      sql(`
        create function public.g() returns text language sql
        as $body$ select 'security definer; set search_path = ''''' $body$;
      `),
    ).toEqual([]);
  });
});

describe("guard-allow", () => {
  it("skips a rule on the same line or the line after", () => {
    expect(tsx(`const c = "#fff"; // guard-allow no-raw-color: canvas API needs a string`)).toEqual(
      [],
    );
    expect(
      tsx(`// guard-allow no-physical-direction: map tiles are LTR\n<div className="left-0" />`),
    ).toEqual([]);
    expect(
      sql("-- guard-allow rls-enabled: internal, never exposed\ncreate table private.t (id int);"),
    ).toEqual([]);
  });

  it("doesn't skip other rules or later lines", () => {
    expect(tsx(`const c = "#fff"; // guard-allow no-arabic: wrong rule`)).toEqual(["no-raw-color"]);
    expect(tsx(`// guard-allow no-raw-color: x\n\nconst c = "#fff";`)).toEqual(["no-raw-color"]);
  });

  it("needs a known rule and a reason", () => {
    expect(tsx(`const c = "#fff"; // guard-allow no-raw-color`)).toEqual([
      "no-raw-color",
      "guard-allow-reason",
    ]);
    expect(tsx(`const a = 1; // guard-allow no-such-rule: x`)).toEqual(["guard-allow-reason"]);
  });
});

describe("the repo", () => {
  it("passes its own guards", () => {
    expect(run([])).toEqual([]);
  });
});
