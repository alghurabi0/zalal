import "server-only";

import { z } from "zod";

// Server-only secrets. `server-only` makes the build fail if a client
// component imports this file.
const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });
  return cached;
}

// An unset value and an empty one both mean "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

// OTP delivery through OTPIQ (spec §9.1), parsed apart from serverEnv so a
// missing OTPIQ key breaks only login. Without a key, codes are printed to
// the server terminal, which is allowed only off Vercel (local dev and CI).
// Previews use an OTPIQ dev key (`sk_dev_…`, every message goes to the
// owner's phone); production needs a live key (docs/deploy-setup.md).
const otpEnvSchema = z
  .object({
    OTPIQ_API_KEY: optional(
      z.string().regex(/^sk_(live|dev)_\S+$/, "must start with sk_live_ or sk_dev_"),
    ),
    // Optional: a registered SMS sender ID (OTPIQ allows 11 characters).
    OTPIQ_SMS_SENDER_ID: optional(z.string().min(1).max(11)),
    // Optional, all three or none: our own WhatsApp Business number.
    OTPIQ_WHATSAPP_ACCOUNT_ID: optional(z.string().min(1)),
    OTPIQ_WHATSAPP_PHONE_ID: optional(z.string().min(1)),
    OTPIQ_WHATSAPP_TEMPLATE: optional(z.string().min(1)),
    // Set by Vercel on every deploy; unset locally and in CI.
    VERCEL_ENV: optional(z.enum(["production", "preview", "development"])),
  })
  .superRefine((env, ctx) => {
    const whatsapp = [
      env.OTPIQ_WHATSAPP_ACCOUNT_ID,
      env.OTPIQ_WHATSAPP_PHONE_ID,
      env.OTPIQ_WHATSAPP_TEMPLATE,
    ];
    if (whatsapp.some((v) => v !== undefined) && whatsapp.some((v) => v === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["OTPIQ_WHATSAPP_ACCOUNT_ID"],
        message: "set OTPIQ_WHATSAPP_ACCOUNT_ID, _PHONE_ID and _TEMPLATE together, or none",
      });
    }
    const onVercel = env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
    if (onVercel && env.OTPIQ_API_KEY === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["OTPIQ_API_KEY"],
        message: "required on Vercel",
      });
    }
    if (env.VERCEL_ENV === "production" && env.OTPIQ_API_KEY?.startsWith("sk_dev_")) {
      ctx.addIssue({
        code: "custom",
        path: ["OTPIQ_API_KEY"],
        message: "production needs a live key; a dev key sends every code to one phone",
      });
    }
  });

export type OtpEnv = z.infer<typeof otpEnvSchema>;

let cachedOtp: OtpEnv | undefined;

export function otpEnv(): OtpEnv {
  cachedOtp ??= otpEnvSchema.parse({
    OTPIQ_API_KEY: process.env.OTPIQ_API_KEY,
    OTPIQ_SMS_SENDER_ID: process.env.OTPIQ_SMS_SENDER_ID,
    OTPIQ_WHATSAPP_ACCOUNT_ID: process.env.OTPIQ_WHATSAPP_ACCOUNT_ID,
    OTPIQ_WHATSAPP_PHONE_ID: process.env.OTPIQ_WHATSAPP_PHONE_ID,
    OTPIQ_WHATSAPP_TEMPLATE: process.env.OTPIQ_WHATSAPP_TEMPLATE,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
  return cachedOtp;
}
