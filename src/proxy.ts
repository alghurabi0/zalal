import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { WELCOMED_COOKIE } from "@/lib/cookies";
import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";
import { exemptFromMaintenance, requiresLogin, routes, withNext } from "@/lib/routes";

const ONE_YEAR_S = 60 * 60 * 24 * 365;

// Maintenance mode (N16, A13), read at most every 10 s per server instance,
// so the switch costs no query on most requests. A failed read counts as
// off: a database hiccup must not take the app down.
const MAINTENANCE_TTL_MS = 10_000;
let maintenance: { readAt: number; on: boolean } | null = null;

async function maintenanceOn(
  supabase: ReturnType<typeof createServerClient<Database>>,
): Promise<boolean> {
  if (maintenance && Date.now() - maintenance.readAt < MAINTENANCE_TTL_MS) return maintenance.on;
  const { data, error } = await supabase.from("settings").select("maintenance_mode").single();
  maintenance = { readAt: Date.now(), on: !error && data.maintenance_mode };
  return maintenance.on;
}

/**
 * Runs before every page:
 * - refreshes the Supabase session and writes the new cookies, so Server
 *   Components (which can't set cookies) always see a valid one;
 * - sends a guest on a page that needs a login to Login, with `next` set so
 *   they come back (pages check again on the server);
 * - sends a logged-in user away from Welcome and Login;
 * - shows Welcome on first open only;
 * - while maintenance mode is on (A13), shows N16's maintenance screen in
 *   place of customer pages, at the same URL, so a reload after it ends
 *   lands where the user was. Staff surfaces and Login stay open.
 */
export async function proxy(request: NextRequest) {
  const env = publicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Cache-Control: a response that sets session cookies is never cached.
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  // Validates the session (and refreshes it when it has expired).
  const { data } = await supabase.auth.getClaims();
  const loggedIn = Boolean(data?.claims.sub);
  const { pathname, search } = request.nextUrl;

  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    // Keep a refreshed session.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  };

  if (!exemptFromMaintenance(pathname) && (await maintenanceOn(supabase))) {
    const rewrite = NextResponse.rewrite(new URL(routes.maintenance, request.url));
    for (const cookie of response.cookies.getAll()) rewrite.cookies.set(cookie);
    rewrite.headers.set("Cache-Control", "private, no-store");
    return rewrite;
  }

  if (!loggedIn && requiresLogin(pathname)) {
    return redirectTo(withNext(routes.login, `${pathname}${search}`));
  }

  if (
    loggedIn &&
    (pathname === routes.welcome ||
      pathname === routes.login ||
      pathname.startsWith(`${routes.login}/`))
  ) {
    return redirectTo(routes.home);
  }

  const welcomed = {
    name: WELCOMED_COOKIE,
    value: "1",
    maxAge: ONE_YEAR_S,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
  } as const;

  if (pathname === routes.home && !loggedIn && !request.cookies.has(WELCOMED_COOKIE)) {
    const redirect = redirectTo(routes.welcome);
    redirect.cookies.set(welcomed);
    return redirect;
  }

  // Welcome opened directly counts as seen too, so "تصفح بدون تسجيل" reaches Home.
  if (pathname === routes.welcome && !request.cookies.has(WELCOMED_COOKIE)) {
    response.cookies.set(welcomed);
  }

  return response;
}

export const config = {
  matcher: [
    // Pages only. Leaves out Next's files, the Sentry and PostHog forwarding
    // paths (/zl-e, /zl-a, which must reach their handlers untouched), the
    // offline page and anything with a file extension (sw.js, icons,
    // manifest, brand images).
    "/((?!_next/|zl-e|zl-a|~offline|sentry-tunnel|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
