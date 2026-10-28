import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";

import { serverEnv } from "@/lib/env.server";
import { PHONE_CHANGE_COOKIE } from "@/lib/cookies";
import { IRAQI_MOBILE_E164 } from "@/lib/phone";
import { routes } from "@/lib/routes";

// The phone change in progress (N10, spec §9.1; settled Oct 28, 2026): a
// code to the account's current number first, then one to the new number.
// Unlike the pending login, this cookie says something a client mustn't
// forge: that the current number was proved. So it is signed with the
// server secret, bound to the user, and lasts 15 minutes from the start.

const phoneChangeSchema = z.object({
  userId: z.uuid(),
  /** "current": proving the account's number; "new": the new number. */
  step: z.enum(["current", "new"]),
  /** The number the latest code went to; null on "new" before one is sent. */
  phone: z.string().regex(IRAQI_MOBILE_E164).nullable(),
  channel: z.enum(["whatsapp", "sms"]),
  /** When the latest code went out (ms since epoch), for the resend timer. */
  sentAt: z.number().int().nonnegative(),
  smsEnabled: z.boolean(),
  expiresAt: z.number().int().positive(),
});

export type PhoneChange = z.infer<typeof phoneChangeSchema>;

export const PHONE_CHANGE_TTL_MS = 15 * 60 * 1000;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret)
    .update(`zalal-phone-change:v1:${payload}`)
    .digest("base64url");
}

export function encodePhoneChange(secret: string, value: PhoneChange): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

/** The change, only when the signature holds, it hasn't expired and it is this user's. */
export function decodePhoneChange(
  secret: string,
  token: string | undefined,
  userId: string,
  now: number,
): PhoneChange | null {
  const [, payload, signature] = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token ?? "") ?? [];
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = phoneChangeSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
    if (!parsed.success) return null;
    if (parsed.data.userId !== userId || parsed.data.expiresAt <= now) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function readPhoneChange(userId: string): Promise<PhoneChange | null> {
  // The resend timer reads the clock, which Next allows only at request time.
  await connection();
  const token = (await cookies()).get(PHONE_CHANGE_COOKIE)?.value;
  return decodePhoneChange(serverEnv().SUPABASE_SECRET_KEY, token, userId, Date.now());
}

/** Server Actions only (cookies can be set there). */
export async function writePhoneChange(value: PhoneChange): Promise<void> {
  (await cookies()).set(
    PHONE_CHANGE_COOKIE,
    encodePhoneChange(serverEnv().SUPABASE_SECRET_KEY, value),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: routes.changePhone,
      maxAge: Math.max(1, Math.ceil((value.expiresAt - Date.now()) / 1000)),
    },
  );
}

export async function clearPhoneChange(): Promise<void> {
  (await cookies()).delete({ name: PHONE_CHANGE_COOKIE, path: routes.changePhone });
}
