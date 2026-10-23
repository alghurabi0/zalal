// Runs in the browser before the app becomes interactive.
import * as Sentry from "@sentry/nextjs";

import { startAnalytics } from "@/lib/monitoring/analytics";
import { sentryOptions } from "@/lib/monitoring/sentry";

Sentry.init(sentryOptions());
startAnalytics();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
