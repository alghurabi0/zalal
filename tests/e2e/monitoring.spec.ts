import { expect, test } from "@playwright/test";

import { ANALYTICS_PATH, ERRORS_PATH } from "../../src/lib/monitoring/paths";

import { SUPABASE_URL } from "./helpers/supabase";

// CI and local builds have no Sentry DSN or PostHog key, so neither may send
// anything, not even through our own forwarding paths. Our own Supabase is
// the app's backend, not a tracker (the force-update check reads settings).
test("without keys, the app reports and tracks nothing", async ({ page, baseURL }) => {
  const sent: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const ours =
      url.origin === new URL(baseURL ?? "").origin || url.origin === new URL(SUPABASE_URL).origin;
    if (!ours || url.pathname.startsWith(ERRORS_PATH) || url.pathname.startsWith(ANALYTICS_PATH)) {
      sent.push(request.url());
    }
  });

  await page.goto("/welcome");
  await page.evaluate(() => document.fonts.ready);
  // An uncaught error would go to Sentry if it were on.
  await page.evaluate(() => setTimeout(() => Promise.reject(new Error("e2e: not reported"))));
  await page.waitForTimeout(1000);

  expect(sent).toEqual([]);
});
