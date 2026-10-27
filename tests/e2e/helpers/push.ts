import type { Page } from "@playwright/test";

// Web Push in e2e (spec §9.2). The server gets this VAPID public key
// (playwright.config.ts), so the app offers push. Its private half was never
// kept: nothing is sent. Headless Chromium can't reach a push service, so
// stubPush() replaces the browser's permission prompt and PushManager with a
// fake that hands out an FCM-looking subscription (kept for the tab across
// page loads); saving it still goes through the real save_push_subscription
// RPC.

export const E2E_VAPID_PUBLIC_KEY =
  "BLpFkrb8Yetz2tU20em3uFjLsnRLM19lznvby68lJnSuC-V6Wn4DSnfg46Tt2j1ayx8tnI2ur4HA1yXOl2-eUS0";

/** The endpoint the fake subscription gets on this page. */
export async function stubPush(page: Page, endpoint: string) {
  await page.addInitScript((url) => {
    const PERM = "e2e_push_permission";
    const SUB = "e2e_push_subscribed";
    Object.defineProperty(Notification, "permission", {
      get: () => (sessionStorage.getItem(PERM) ?? "default") as NotificationPermission,
    });
    Notification.requestPermission = async () => {
      sessionStorage.setItem(PERM, "granted");
      return "granted";
    };
    const keys = { p256dh: `B${"a".repeat(86)}`, auth: "b".repeat(22) };
    const subscription = {
      endpoint: url,
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: url, keys }),
      unsubscribe: async () => {
        sessionStorage.removeItem(SUB);
        return true;
      },
    } as unknown as PushSubscription;
    PushManager.prototype.getSubscription = async () =>
      sessionStorage.getItem(SUB) ? subscription : null;
    PushManager.prototype.subscribe = async () => {
      sessionStorage.setItem(SUB, "1");
      return subscription;
    };
  }, endpoint);
}
