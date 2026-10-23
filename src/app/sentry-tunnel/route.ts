// Browser errors reach Sentry through this route, so ad blockers don't drop
// them. next.config.ts (tunnelRoute) maps the public path to it. It forwards
// only the event, never the request's cookies or headers, and only for our
// own DSN.
export { POST } from "@sentry/nextjs/tunnel";
