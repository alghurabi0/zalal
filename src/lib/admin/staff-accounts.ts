import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Makes sure an Auth account exists for this phone (E.164), for A10 and A14
 * (spec §2, §8.2). A new one is created with the Auth admin API, the phone
 * confirmed and no password: the first login sets it (spec §9.1). An
 * existing account is left alone. Who may become a crew or an admin is
 * decided by the admin RPCs that come next (admin_create_crew,
 * admin_set_crew_phone, admin_add_admin), which also audit the change. An
 * account made for an attempt the RPC then refuses stays untouched: nobody
 * has used it, so a retry, or that person's own first login, takes it over.
 *
 * Callers check that the viewer is an admin first: this uses the secret key.
 * Returns false when Auth failed, so the action can report it. `admin` is
 * the secret-key client (a parameter so the integration test can pass its own).
 */
export async function ensureAccount(
  phone: string,
  admin: SupabaseClient<Database> = createAdminClient(),
): Promise<boolean> {
  const { data: existing, error: readError } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (readError) return false;
  if (existing) return true;

  const { error } = await admin.auth.admin.createUser({ phone, phone_confirm: true });
  // Created a moment ago by another admin, or by that person's own login.
  return !error || error.code === "phone_exists";
}
