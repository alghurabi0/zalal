import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";

/**
 * Supabase client for client components. It acts as the logged-in user (or a
 * guest), so RLS decides what it can read and write. createBrowserClient
 * reuses one instance per page.
 */
export function createClient() {
  const env = publicEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
