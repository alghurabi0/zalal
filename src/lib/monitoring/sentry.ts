import type * as Sentry from "@sentry/nextjs";

import { deployEnv, monitoringEnv } from "@/lib/env";

type SentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

/**
 * Options shared by the browser, server and edge Sentry SDKs
 * (src/instrumentation-client.ts, src/sentry.*.config.ts).
 *
 * Sentry is off without NEXT_PUBLIC_SENTRY_DSN. It reports errors and a
 * sample of traces, and nothing personal: no user, IP, cookies, headers
 * other than the browser name, request bodies, query strings or local
 * variables. Phone numbers, names and addresses must never reach it.
 */
export function sentryOptions() {
  const dsn = monitoringEnv().NEXT_PUBLIC_SENTRY_DSN;
  const environment = deployEnv();

  return {
    dsn,
    enabled: dsn !== undefined,
    environment,
    // Production traffic is sampled; previews are low traffic, so keep all.
    tracesSampleRate: environment === "production" ? 0.1 : 1,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
  } satisfies SentryInitOptions;
}
