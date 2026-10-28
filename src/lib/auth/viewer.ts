import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import type { Database } from "@/lib/database.types";
import { routes, withNext } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export type Role = Database["public"]["Enums"]["app_role"];

export type Viewer = {
  id: string;
  role: Role;
  phone: string;
  fullName: string | null;
};

/**
 * The logged-in user and their profile, or null for a guest. Reads the
 * session from the request cookies, so callers in a page sit under a
 * <Suspense> boundary. One lookup per request.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, phone, full_name, deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Profile read failed: ${error.message}`);
  // A deleted account has no phone either (delete_account).
  if (!profile || profile.deleted_at !== null || profile.phone === null) return null;

  return { id: profile.id, role: profile.role, phone: profile.phone, fullName: profile.full_name };
});

/**
 * For pages that need a login: the viewer, or a redirect to Login that comes
 * back to `returnTo`. proxy.ts does the same first; this is the second check.
 * Pages for one role pass it, and anyone else goes to their own surface.
 */
export async function requireViewer(returnTo: string, role: Role = "customer"): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(withNext(routes.login, returnTo));
  if (viewer.role !== role) redirect(surfaceFor(viewer.role));
  return viewer;
}

/** The surface a role opens after login (spec §2). */
export function surfaceFor(role: Role): string {
  if (role === "crew") return routes.crew;
  if (role === "admin") return routes.admin;
  return routes.home;
}
