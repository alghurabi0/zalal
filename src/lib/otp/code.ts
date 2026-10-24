import "server-only";

import { createHmac, randomInt } from "node:crypto";

import { OTP_LENGTH } from "@/lib/otp/schemas";

/** A uniformly random 6-digit code (spec decision 10). */
export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

/**
 * What otp_requests stores and check_otp compares: an HMAC of the phone and
 * code, keyed with a server secret, so a database dump can't be brute-forced
 * through the million possible codes. Rotating the secret only invalidates
 * codes from the last 5 minutes.
 */
export function hashOtpCode(secret: string, phone: string, code: string): string {
  return createHmac("sha256", secret).update(`zalal-otp:v1:${phone}:${code}`).digest("hex");
}

/**
 * The password the server signs a user in with after a correct code (spec
 * §9.1): an HMAC of the user id, keyed with the server secret. Nobody types
 * or sees it, and it can't be worked out without the secret. It stays the
 * same across logins on purpose: setting a new one (set_login_password)
 * signs the user out on every other device.
 */
export function signInPassword(secret: string, userId: string): string {
  return createHmac("sha256", secret).update(`zalal-signin:v1:${userId}`).digest("base64url");
}
