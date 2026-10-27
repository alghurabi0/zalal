/// <reference lib="esnext" />
/// <reference lib="webworker" />
//
// The service worker. `serwist build` (serwist.config.js) bundles it to
// public/sw.js after `next build`.
//
// Caching policy (docs/spec.md §3, PWA):
// - Cached: build assets under /_next/static (hashed names, never stale),
//   fonts, and the icons and brand images in /public.
// - Never cached: pages, RSC payloads, Server Actions and every cross-origin
//   request (Supabase, maps). They always go to the network, so a shared
//   crew phone never shows another account's data or a stale order status.
// - A page that can't load shows the offline page (/~offline) instead of the
//   browser's error screen.
//
// Web Push (spec §9.2): the Edge Function send-push sends a notification's
// type and values; `push` writes the words from ar.json (pushMessage) and
// shows it. A tap opens /notifications/<id>, which marks it read and goes to
// its target, in an open window of the app when there is one.
import { pushMessage } from "@/lib/notifications/push-message";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  type PrecacheEntry,
  Serwist,
  type SerwistGlobalConfig,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Replaced with the precache list by `serwist build`.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const OFFLINE_URL = "/~offline";
const DAY = 24 * 60 * 60;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  // Nothing user-specific is cached, so a new worker can take over open tabs
  // right away.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "next-static",
        plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * DAY })],
      }),
    },
    {
      matcher: ({ sameOrigin, url }) =>
        sameOrigin && /^\/(?:icons\/|brand\/|icon\.svg$|apple-icon\.png$)/.test(url.pathname),
      handler: new StaleWhileRevalidate({
        cacheName: "brand-assets",
        plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 30 * DAY })],
      }),
    },
    {
      // Page loads go to the network; this route exists so a failed load
      // falls back to the offline page below.
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkOnly(),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: OFFLINE_URL,
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

self.addEventListener("push", (event) => {
  let payload: unknown = null;
  try {
    payload = event.data?.json();
  } catch {
    // Shown as a generic notification below.
  }
  const message = pushMessage(payload);
  // Every push must show a notification (browsers revoke push otherwise).
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      lang: "ar",
      dir: "rtl",
      data: { url: message.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  const path =
    typeof data === "object" && data !== null && "url" in data && typeof data.url === "string"
      ? data.url
      : "/";
  // Only paths on this site.
  const url = new URL(path, self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window" });
      const open = windows.find((client) => new URL(client.url).origin === url.origin);
      if (open) {
        await open.focus();
        await open.navigate(url.href);
        return;
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
