// @ts-check
// Builds the service worker (src/app/sw.ts → public/sw.js) after `next build`.
// This is Serwist's "configurator mode": it runs outside the Next.js bundler,
// so it works with Turbopack and with `cacheComponents`, which
// @serwist/turbopack's route handler does not support.
import { readFileSync } from "node:fs";

import { serwist } from "@serwist/next/config";

// Changes on every `next build`, so the precached offline page is refreshed
// together with the CSS it points to.
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();

export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Precache only what the offline page needs: the page itself, the CSS and
  // the Cairo font files. Pages are never precached (see sw.ts), and the
  // other build files are cached at runtime as they are used.
  precachePrerendered: false,
  globPatterns: [".next/static/**/*.{css,woff2}"],
  additionalPrecacheEntries: [{ url: "/~offline", revision: buildId }],
});
