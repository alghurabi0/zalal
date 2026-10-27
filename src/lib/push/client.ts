import { publicEnv } from "@/lib/env";
import { pushSubscriptionSchema } from "@/lib/schemas/push";
import { createClient } from "@/lib/supabase/browser";

// Web Push in the browser (spec §9.2): whether this device can get it,
// asking for permission, and keeping this browser's subscription saved under
// whoever is logged in (save_push_subscription moves it on a shared phone).
// Browser only: call from effects and event handlers.

/**
 * - unsupported: no VAPID key (local, CI), no service worker (`pnpm dev`) or
 *   no Web Push in this browser
 * - install: an iPhone or iPad in Safari's tab: push needs the app added to
 *   the home screen first (iOS 16.4+)
 * - default: can ask; denied: the user said no (only the browser's settings
 *   change it); subscribed: this browser gets push
 */
export type PushState = "unsupported" | "install" | "default" | "denied" | "subscribed";

export function isIos(): boolean {
  const { userAgent, platform, maxTouchPoints } = navigator;
  // iPadOS reports a Mac; its touch screen gives it away.
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

function isInstalled(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia("(display-mode: standalone)").matches || standalone === true;
}

function vapidKey(): string | undefined {
  return publicEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  const bytes = new Uint8Array(a);
  return bytes.every((byte, index) => byte === b[index]);
}

/**
 * The service worker once it is active. It registers after the page loads,
 * so a first visit waits for it a little; `pnpm dev` has none and gives up.
 */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
}

export async function pushState(): Promise<PushState> {
  if (!vapidKey()) return "unsupported";
  if (isIos() && !isInstalled()) return "install";
  if (!("PushManager" in window) || !("Notification" in window)) return "unsupported";
  const reg = await registration();
  if (!reg) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted" && (await reg.pushManager.getSubscription())) {
    return "subscribed";
  }
  return "default";
}

async function save(subscription: PushSubscription): Promise<boolean> {
  const json = subscription.toJSON();
  const strip = (value: string | undefined) => value?.replace(/=+$/, "");
  const parsed = pushSubscriptionSchema.safeParse({
    endpoint: json.endpoint,
    p256dh: strip(json.keys?.p256dh),
    auth: strip(json.keys?.auth),
  });
  if (!parsed.success) return false;
  const { error } = await createClient().rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.p256dh,
    p_auth: parsed.data.auth,
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  return !error;
}

/** This browser's subscription for the current key, made if missing. */
async function subscribe(reg: ServiceWorkerRegistration, key: string) {
  const serverKey = base64UrlToBytes(key);
  const existing = await reg.pushManager.getSubscription();
  // Made for another key (the owner rotated it): it can't be used any more.
  if (existing && !sameKey(existing.options.applicationServerKey, serverKey)) {
    await existing.unsubscribe();
  } else if (existing) {
    return existing;
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
}

/** Asks for permission (after a tap) and saves this browser for push. */
export async function enablePush(): Promise<"subscribed" | "denied" | "failed"> {
  const key = vapidKey();
  const reg = await registration();
  if (!key || !reg || !("Notification" in window)) return "failed";
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return permission === "denied" ? "denied" : "failed";
    return (await save(await subscribe(reg, key))) ? "subscribed" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * On every visit while logged in: a browser that already allowed push is
 * saved (again) under this account, so a phone that changed hands, a
 * refreshed subscription or a rotated key keep working without asking.
 */
export async function syncPush(): Promise<void> {
  const key = vapidKey();
  if (!key || !("Notification" in window) || Notification.permission !== "granted") return;
  const reg = await registration();
  if (!reg) return;
  try {
    await save(await subscribe(reg, key));
  } catch {
    // Tried again on the next visit.
  }
}

/**
 * Logout: forgets this browser for the account, then unsubscribes it, so the
 * next person on a shared phone never gets the previous account's pushes.
 * Gives up after a few seconds rather than hold the logout.
 */
export async function forgetPush(): Promise<void> {
  // Push off here (no key, no worker): nothing to forget, so no wait.
  if (!vapidKey() || !("serviceWorker" in navigator)) return;
  const work = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;
    await createClient()
      .rpc("delete_push_subscription", { p_endpoint: subscription.endpoint })
      .then(
        () => undefined,
        () => undefined,
      );
    await subscription.unsubscribe();
  };
  await Promise.race([
    work().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}
