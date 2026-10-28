"use server";

import * as Sentry from "@sentry/nextjs";

import { clearPendingLogin } from "@/lib/auth/pending-login";
import { clearPhoneChange } from "@/lib/auth/phone-change";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Settings (N13): log out on all devices, and account deletion (spec §7
// "Account deletion"; settled Oct 28, 2026). The client forgets this
// browser (analytics, push, the crew queue) and then loads Welcome as a full
// page, as logout does.

/** "سجّل خروج من كل الأجهزة": every session ends and every browser stops getting pushes. */
export async function logoutEverywhere(): Promise<{ ok: boolean }> {
  await requireViewer(routes.settings);
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_my_push_subscriptions");
  if (error) return { ok: false };
  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
  if (signOutError) return { ok: false };
  await clearPendingLogin();
  return { ok: true };
}

export type DeleteAccountResult = { ok: true } | { ok: false; reason: "open_orders" | "failed" };

/** "احذف حسابي": delete_account() anonymizes the account and ends every session. */
export async function deleteMyAccount(): Promise<DeleteAccountResult> {
  await requireViewer(routes.settings);
  const supabase = await createClient();
  const { data: pdfs, error } = await supabase.rpc("delete_account");
  if (error) {
    return { ok: false, reason: error.code === "ZL039" ? "open_orders" : "failed" };
  }

  // The certificate PDFs print the name and phone. The bucket is
  // service-role only; the paths come from the RPC, which detached them.
  if (pdfs.length > 0) {
    const { error: removeError } = await createAdminClient()
      .storage.from("certificates")
      .remove(pdfs);
    // Paths are certificate ids only; nothing personal goes to Sentry.
    if (removeError) Sentry.captureException(new Error("Certificate PDF cleanup failed"));
  }

  // The RPC already ended the sessions; this clears this browser's cookies.
  await supabase.auth.signOut({ scope: "local" });
  await Promise.all([clearPendingLogin(), clearPhoneChange()]);
  return { ok: true };
}
