import { z } from "zod";

// Values that may reach the browser. Next.js inlines NEXT_PUBLIC_* only when
// they are read by their full name, so each one is listed by hand.
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cached: PublicEnv | undefined;

/** Reads and validates the public env vars on first use, so a missing value fails loudly. */
export function publicEnv(): PublicEnv {
  cached ??= publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return cached;
}

// An unset value and an empty one both mean "off".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

// Sentry and PostHog are optional: without their keys (local, CI, or before
// the accounts exist) they stay off and the app works the same.
const monitoringEnvSchema = z.object({
  NEXT_PUBLIC_SENTRY_DSN: optional(z.url()),
  NEXT_PUBLIC_POSTHOG_KEY: optional(z.string().min(1)),
  // Set by Vercel on every deploy; unset locally and in CI.
  NEXT_PUBLIC_VERCEL_ENV: optional(z.enum(["production", "preview", "development"])),
});

export type MonitoringEnv = z.infer<typeof monitoringEnvSchema>;

let cachedMonitoring: MonitoringEnv | undefined;

export function monitoringEnv(): MonitoringEnv {
  cachedMonitoring ??= monitoringEnvSchema.parse({
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  });
  return cachedMonitoring;
}

/** "production" and "preview" on Vercel; "local" everywhere else. Tags Sentry events. */
export function deployEnv(): "production" | "preview" | "local" {
  const env = monitoringEnv().NEXT_PUBLIC_VERCEL_ENV;
  return env === "production" || env === "preview" ? env : "local";
}
