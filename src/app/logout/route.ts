import { type NextRequest, NextResponse } from "next/server";

import { clearPendingLogin } from "@/lib/auth/pending-login";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Logout (spec §5.8): ends the session on this device, forgets any login in
 * progress, then shows Welcome. A plain form POST and a 303, so the browser
 * does a full page load: nothing from the account (kept pages, typed values,
 * router cache) survives on a shared crew phone, and no re-render of the
 * page the user left can race the navigation.
 */
export async function POST(request: NextRequest) {
  // Only our own pages may log a user out; a form on another site can't.
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return new NextResponse(null, { status: 403 });
  }
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  await clearPendingLogin();
  return NextResponse.redirect(new URL(routes.welcome, request.url), 303);
}
