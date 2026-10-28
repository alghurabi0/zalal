// Lighthouse on the main customer screens (spec §12.3 "Lighthouse"; Phase 6,
// task 4). Lighthouse 12+ has no PWA category: installability is checked by
// tests/e2e/pwa.spec.ts instead. This reports the other four categories and
// checks the targets: Accessibility 100, Best practices ≥ 95 and SEO ≥ 90 on
// indexable pages. Performance is reported, not gated (scores swing too much
// between machines). Not run in CI.
//
//   pnpm build && pnpm start          (in another terminal)
//   node scripts/lighthouse.ts [--base http://localhost:3000] [--cookie "<Cookie header>"] [--certificate <code>]
//
// Without --cookie only guest screens run. With a logged-in customer's
// Cookie header (copy it from the browser's devtools) the customer screens
// run too. Lighthouse itself comes from `pnpm dlx` at a pinned version, so
// it isn't a dependency. Chrome: CHROME_PATH, else PLAYWRIGHT_CHROMIUM_PATH,
// else Playwright's Chromium. Writes test-results/lighthouse/<page>.json and
// report.md.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { chromium } from "@playwright/test";

const LIGHTHOUSE = "lighthouse@13.6.0";
const OUT = path.resolve("test-results/lighthouse");

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    cookie: { type: "string" },
    certificate: { type: "string" },
  },
});

type Target = { name: string; path: string; customer?: boolean; indexable?: boolean };

const pages: Target[] = [
  { name: "welcome", path: "/welcome" },
  { name: "guest-home", path: "/" },
  { name: "login", path: "/login" },
  { name: "tips", path: "/tips" },
  ...(values.certificate
    ? [{ name: "public-certificate", path: `/c/${values.certificate}`, indexable: false }]
    : []),
  { name: "home", path: "/", customer: true },
  { name: "orders", path: "/orders", customer: true },
  { name: "book", path: "/book", customer: true },
  { name: "profile", path: "/profile", customer: true },
  { name: "chat", path: "/chat", customer: true },
  { name: "notifications", path: "/notifications", customer: true },
];

const TARGETS = { accessibility: 100, "best-practices": 95, seo: 90 } as const;

type Report = {
  finalDisplayedUrl: string;
  categories: Record<string, { score: number | null }>;
};

const chrome =
  process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM_PATH || chromium.executablePath();
mkdirSync(OUT, { recursive: true });

const rows: string[] = [];
let missed = 0;
for (const page of pages) {
  if (page.customer && !values.cookie) continue;
  // Guests skip Welcome on "/" once they have seen it (spec §5.1).
  const cookie = page.customer ? values.cookie! : "zl_welcomed=1";
  const output = path.join(OUT, `${page.name}.json`);
  execFileSync(
    "pnpm",
    [
      "dlx",
      LIGHTHOUSE,
      `${values.base}${page.path}`,
      "--quiet",
      "--output=json",
      `--output-path=${output}`,
      `--extra-headers=${JSON.stringify({ Cookie: cookie })}`,
      "--chrome-flags=--headless=new --no-sandbox",
      "--only-categories=performance,accessibility,best-practices,seo",
    ],
    { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, CHROME_PATH: chrome } },
  );
  const report = JSON.parse(readFileSync(output, "utf8")) as Report;
  const score = (id: string) => Math.round((report.categories[id]?.score ?? 0) * 100);
  const cells = (["performance", "accessibility", "best-practices", "seo"] as const).map((id) => {
    const value = score(id);
    const target = id === "performance" ? undefined : TARGETS[id];
    // N15 is noindex by design, so its SEO score has no target.
    const gated = target !== undefined && !(id === "seo" && page.indexable === false);
    if (gated && value < target) {
      missed++;
      return `${value} ✗`;
    }
    return String(value);
  });
  const shown = new URL(report.finalDisplayedUrl).pathname;
  rows.push(`| ${page.name} | \`${shown}\` | ${cells.join(" | ")} |`);
  console.log(rows.at(-1));
}

const table = [
  `Lighthouse ${LIGHTHOUSE.split("@")[1]}, mobile (simulated throttling), ${new Date().toISOString()}`,
  "",
  "| Page | URL | Performance | Accessibility | Best practices | SEO |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
  `Targets: Accessibility ${TARGETS.accessibility}, Best practices ≥ ${TARGETS["best-practices"]}, SEO ≥ ${TARGETS.seo} (indexable pages). Performance is not gated.`,
].join("\n");
writeFileSync(path.join(OUT, "report.md"), `${table}\n`);
console.log(
  `\n${missed === 0 ? "All targets met." : `${missed} target(s) missed.`} ${OUT}/report.md`,
);
process.exitCode = missed === 0 ? 0 : 1;
