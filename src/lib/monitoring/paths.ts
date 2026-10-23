// Same-origin paths that next.config.ts forwards to Sentry and PostHog, so
// ad blockers don't drop the requests. Neutral names on purpose: blockers
// match paths like /sentry, /analytics or /ingest. The service worker never
// caches them (src/app/sw.ts handles only static files and page loads).

/** Browser errors, forwarded to Sentry by src/app/sentry-tunnel/route.ts. */
export const ERRORS_PATH = "/zl-e";

/** Analytics events and the PostHog config, forwarded to PostHog EU. */
export const ANALYTICS_PATH = "/zl-a";
