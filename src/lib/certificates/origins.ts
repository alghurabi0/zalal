import "server-only";

import type { CertificateEnv } from "@/lib/env.server";

// Two addresses the certificate needs (spec §10.1):
// - where headless Chromium opens the print page: this deployment itself, so
//   the PDF is made by the same code version;
// - the public address the QR code and the share link open (N15): the
//   production domain in production, the deployment elsewhere.

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

/**
 * Off Vercel (local, CI) the request's own host is used, but only a local
 * one: Chromium must never be pointed at a host taken from a request header.
 */
function requestOrigin(host: string | null, proto: string | null): string | null {
  if (!host || !LOCAL_HOST.test(host)) return null;
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

export function printOrigin(
  env: CertificateEnv,
  host: string | null,
  proto: string | null,
): string | null {
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return requestOrigin(host, proto);
}

export function publicOrigin(
  env: CertificateEnv,
  host: string | null,
  proto: string | null,
): string | null {
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return requestOrigin(host, proto);
}
