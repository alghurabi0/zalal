"use server";

import { createClient } from "@/lib/supabase/server";

/** Ends the session on this device and clears its cookies. */
export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
}
