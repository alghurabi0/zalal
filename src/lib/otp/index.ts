import "server-only";

import { serverEnv } from "@/lib/env.server";
import { otpSenders } from "@/lib/otp/config";
import {
  type ChangePhoneResult,
  type CodeFailure,
  createOtpService,
  type RequestOtpResult,
  type VerifyOtpResult,
} from "@/lib/otp/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type {
  ChangePhoneResult,
  CodeFailure,
  RequestOtpResult,
  VerifyOtpResult,
} from "@/lib/otp/service";

// Entry points for the Login and OTP Server Actions (spec §5.2, §5.3, §9.1).
// Call them only from a Server Action or route handler: verifyOtp sets the
// session cookies.

function service() {
  return createOtpService({
    admin: createAdminClient(),
    senders: otpSenders(),
    hmacSecret: serverEnv().SUPABASE_SECRET_KEY,
    async signIn(phone, password) {
      const supabase = await createClient();
      return supabase.auth.signInWithPassword({ phone, password });
    },
  });
}

/** Sends a code to `{ phone, channel }` if the limits allow it. */
export function requestOtp(input: unknown): Promise<RequestOtpResult> {
  return service().requestOtp(input);
}

/** Checks `{ phone, code }` and, when it is right, signs the user in. */
export function verifyOtp(input: unknown): Promise<VerifyOtpResult> {
  return service().verifyOtp(input);
}

/** Phone change (N10): checks `{ phone, code }` for the account's current number. */
export function verifyCurrentPhone(input: unknown): Promise<{ ok: true } | CodeFailure> {
  return service().verifyCurrentPhone(input);
}

/** Phone change: whether a number is free for this user before a code goes to it. */
export function newPhoneAvailable(userId: string, phone: unknown) {
  return service().newPhoneAvailable(userId, phone);
}

/** Phone change: checks `{ phone, code }` for the new number, then moves the account to it. */
export function changePhone(userId: string, input: unknown): Promise<ChangePhoneResult> {
  return service().changePhone(userId, input);
}
