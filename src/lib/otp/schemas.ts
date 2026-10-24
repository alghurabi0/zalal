import { z } from "zod";

import type { Database } from "@/lib/database.types";
import { phoneInputSchema, toWesternDigits } from "@/lib/phone";

// Shared by the Login and OTP screens and the server (spec §5.2, §5.3).

export type OtpChannel = Database["public"]["Enums"]["otp_channel"];

export const otpChannelSchema = z.enum(["whatsapp", "sms"]) satisfies z.ZodType<OtpChannel>;

export const OTP_LENGTH = 6;

/** A typed code: 6 digits, Western or Arabic-Indic. Parses to Western digits. */
export const otpCodeSchema = z
  .string()
  .transform((value) => toWesternDigits(value).trim())
  .pipe(z.string().regex(/^\d{6}$/, "invalid_code"));

export const requestOtpInputSchema = z.object({
  phone: phoneInputSchema,
  channel: otpChannelSchema,
});

export const verifyOtpInputSchema = z.object({
  phone: phoneInputSchema,
  code: otpCodeSchema,
});

export type RequestOtpInput = z.input<typeof requestOtpInputSchema>;
export type VerifyOtpInput = z.input<typeof verifyOtpInputSchema>;
