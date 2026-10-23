import { monitoringEnv } from "@/lib/env";

import { ANALYTICS_PATH } from "./paths";

/**
 * Starts PostHog in the browser (src/instrumentation-client.ts). It is off
 * without NEXT_PUBLIC_POSTHOG_KEY, which only the Vercel Production
 * environment sets, so previews and local runs send nothing.
 *
 * Privacy (spec §3): page views and clicks only, with no element text, no
 * session recording and no profile until Phase 1 identifies a logged-in user
 * by their user id (never their phone). Logout must call posthog.reset(),
 * because crew phones are shared.
 */
export function startAnalytics() {
  const key = monitoringEnv().NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  // Loaded after the page, so it never delays the first render.
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: ANALYTICS_PATH,
      ui_host: "https://eu.posthog.com",
      defaults: "2026-08-30",
      person_profiles: "identified_only",
      // Clicked elements can show names, phones or addresses.
      mask_all_text: true,
      mask_personal_data_properties: true,
      disable_session_recording: true,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      // Nothing above needs PostHog's extra scripts, so don't load them.
      disable_external_dependency_loading: true,
      // Sentry reports errors.
      capture_exceptions: false,
    });
  });
}
