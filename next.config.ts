import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import packageJson from "./package.json" with { type: "json" };

import { monitoringEnv } from "./src/lib/env";
import { ANALYTICS_PATH, ERRORS_PATH } from "./src/lib/monitoring/paths";

// Fails the build on a malformed Sentry DSN or PostHog key, instead of
// shipping an app that silently reports nothing.
monitoringEnv();

const POSTHOG_HOST = "https://eu.i.posthog.com";
const POSTHOG_ASSETS_HOST = "https://eu-assets.i.posthog.com";

const nextConfig: NextConfig = {
  // Settings (N13) shows it, and the force-update screen (N16) compares it
  // with settings.min_app_version (src/lib/app-version.ts).
  env: { NEXT_PUBLIC_APP_VERSION: packageJson.version },
  cacheComponents: true,
  partialPrefetching: true,
  // PostHog through our own domain (src/lib/monitoring/analytics.ts). The
  // specific rules must come before the catch-all.
  async rewrites() {
    return [
      {
        source: `${ANALYTICS_PATH}/static/:path*`,
        destination: `${POSTHOG_ASSETS_HOST}/static/:path*`,
      },
      {
        source: `${ANALYTICS_PATH}/array/:path*`,
        destination: `${POSTHOG_ASSETS_HOST}/array/:path*`,
      },
      { source: `${ANALYTICS_PATH}/:path*`, destination: `${POSTHOG_HOST}/:path*` },
    ];
  },
  // PostHog's API paths end in a slash (/e/); a redirect would drop events.
  skipTrailingSlashRedirect: true,
  // Certificate PDFs (src/lib/certificates/pdf.ts): @sparticuz/chromium finds
  // its compressed browser through import.meta.url, which the file tracer
  // can't follow, so ship its bin/ with the two functions that print: the
  // crew job page (its completion action) and the PDF download.
  outputFileTracingIncludes: {
    "/crew/jobs/\\[id\\]": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/orders/\\[id\\]/certificate/pdf": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Uploads source maps to Sentry when SENTRY_AUTH_TOKEN, SENTRY_ORG and
// SENTRY_PROJECT are set (Vercel build env only, docs/deploy-setup.md), then
// deletes them from the build so they are never served. Without them the
// build just skips the upload.
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  tunnelRoute: ERRORS_PATH,
  // No session replay, so leave its code out of the bundle.
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
    excludeReplayWorker: true,
  },
});
