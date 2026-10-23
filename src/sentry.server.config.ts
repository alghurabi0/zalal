// Sentry for the Node.js server runtime. Loaded by src/instrumentation.ts.
import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/monitoring/sentry";

Sentry.init(sentryOptions());
