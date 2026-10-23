import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";

/**
 * Supabase client for Server Components, Server Actions and route handlers.
 * It reads the session from the request cookies and acts as that user, so RLS
 * applies. Create one per request. cookies() is request data, so callers in a
 * page must sit under a <Suspense> boundary (cacheComponents).
 */
export async function createClient() {
  const env = publicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can't set cookies. That's fine as long as
            // proxy.ts refreshes the session (added with login in Phase 1).
          }
        },
      },
    },
  );
}
