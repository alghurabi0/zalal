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
