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
