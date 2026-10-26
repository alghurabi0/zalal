import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { connection } from "next/server";

import { serverEnv } from "@/lib/env.server";

// The headless browser that makes a certificate PDF has no session. The
// server hands it a token for one certificate, in a cookie on our own origin
// (never the URL, so it stays out of logs), and the print page accepts it in
// place of a login. The token is an HMAC of the certificate id and an expiry,
// keyed with the server secret, and lasts 5 minutes.

export const PRINT_TOKEN_COOKIE = "zl_print";
export const PRINT_TOKEN_TTL_MS = 5 * 60 * 1000;

function sign(secret: string, certificateId: string, expiresAt: number): string {
  return createHmac("sha256", secret)
    .update(`zalal-certificate-print:v1:${certificateId}:${expiresAt}`)
    .digest("base64url");
}

export function createPrintToken(secret: string, certificateId: string, now: number): string {
  const expiresAt = now + PRINT_TOKEN_TTL_MS;
  return `${expiresAt}.${sign(secret, certificateId, expiresAt)}`;
}

/** True only for an unexpired token made for this certificate. */
export function verifyPrintToken(
  secret: string,
  certificateId: string,
  token: string | undefined,
  now: number,
): boolean {
  if (!token) return false;
  const [, expiry, signature] = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token) ?? [];
  if (!expiry || !signature) return false;
  const expiresAt = Number(expiry);
  if (expiresAt < now || expiresAt > now + PRINT_TOKEN_TTL_MS) return false;
  const expected = Buffer.from(sign(secret, certificateId, expiresAt));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Whether this request carries a valid print token for the certificate
 * (the print page, src/app/certificates/[id]/print). Reads the cookie, so
 * callers in a page sit under <Suspense>.
 */
export async function hasPrintToken(certificateId: string): Promise<boolean> {
  await connection();
  const token = (await cookies()).get(PRINT_TOKEN_COOKIE)?.value;
  return verifyPrintToken(serverEnv().SUPABASE_SECRET_KEY, certificateId, token, Date.now());
}
