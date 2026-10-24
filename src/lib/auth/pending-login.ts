import "server-only";

import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";

import { PENDING_LOGIN_COOKIE } from "@/lib/cookies";
import { IRAQI_MOBILE_E164 } from "@/lib/phone";
import { routes } from "@/lib/routes";

// The login between Login and OTP (spec §5.2–5.3). Not a secret: it only
// says which number the OTP screen is for. Editing it gains nothing, since
// the code for that number is still needed. httpOnly keeps it away from page
// scripts and out of URLs.

const pendingLoginSchema = z.object({
  phone: z.string().regex(IRAQI_MOBILE_E164),
  /** The channel the code actually went out on, after any fallback. */
  channel: z.enum(["whatsapp", "sms"]),
  /** When the code was sent (ms since epoch), for the 45 s resend timer. */
  sentAt: z.number().int().positive(),
  smsEnabled: z.boolean(),
  next: z.string().max(512).nullable(),
});

export type PendingLogin = z.infer<typeof pendingLoginSchema>;

// Codes last 5 minutes; a little longer lets "أعد الإرسال" work after that.
const MAX_AGE_S = 15 * 60;

/** The wait between sends; request_otp enforces it, this only drives OTP's timer. */
export const RESEND_AFTER_S = 45;

/** Seconds until OTP may offer "أعد الإرسال" for this login. */
export function secondsUntilResend(pending: PendingLogin, now: number = Date.now()): number {
  return Math.max(0, Math.ceil(RESEND_AFTER_S - (now - pending.sentAt) / 1000));
}

export async function readPendingLogin(): Promise<PendingLogin | null> {
  // OTP's timer reads the clock, which Next allows only at request time.
  await connection();
  const raw = (await cookies()).get(PENDING_LOGIN_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = pendingLoginSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Server Actions only (cookies can be set there). */
export async function writePendingLogin(value: PendingLogin): Promise<void> {
  (await cookies()).set(PENDING_LOGIN_COOKIE, JSON.stringify(value), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: routes.login,
    maxAge: MAX_AGE_S,
  });
}

export async function clearPendingLogin(): Promise<void> {
  (await cookies()).delete({ name: PENDING_LOGIN_COOKIE, path: routes.login });
}
