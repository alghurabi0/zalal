import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";

/**
 * Supabase client with the secret key. It bypasses RLS, so use it only for
 * work no user may do directly (for example, writing generated files to a
 * private bucket), and check who is asking before calling it. Server code only.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}
