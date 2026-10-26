"use server";

import * as Sentry from "@sentry/nextjs";

import { type AdminEditFailure, editFailure } from "@/lib/admin/edit-errors";
import { ensureAccount } from "@/lib/admin/staff-accounts";
import { requireViewer } from "@/lib/auth/viewer";
import { CURRENT_STATUSES } from "@/lib/orders/status";
import { routes } from "@/lib/routes";
import {
  type AddAdminInput,
  addAdminSchema,
  type RemoveAdminInput,
  removeAdminSchema,
} from "@/lib/schemas/admin-staff";
import { createClient } from "@/lib/supabase/server";

// A14's actions (spec §8.2). The account comes from the Auth admin API when
// the phone has none; admin_add_admin and admin_remove_admin, called as the
// admin, decide and audit.

const report = (message: string) => Sentry.captureMessage(message, "error");

async function admin() {
  await requireViewer(routes.adminAdmins, "admin");
  return createClient();
}

/**
 * `added` is false when the phone was already an admin. `openOrders`: the
 * account's own open orders as a customer, which stay as they are.
 */
export async function addAdmin(
  input: AddAdminInput,
): Promise<{ status: "done"; added: boolean; openOrders: number } | AdminEditFailure> {
  const parsed = addAdminSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  if (!(await ensureAccount(parsed.data.phone))) {
    report("admin account create failed");
    return { status: "error", error: "failed" };
  }
  const { data: added, error } = await supabase.rpc("admin_add_admin", {
    p_phone: parsed.data.phone,
    p_name: parsed.data.name,
  });
  if (error) return editFailure("admin_add_admin", error, report);

  const { count } = await supabase
    .from("orders")
    .select("id, customer:profiles!orders_customer_id_fkey!inner(phone)", {
      count: "exact",
      head: true,
    })
    .eq("customer.phone", parsed.data.phone)
    .in("status", CURRENT_STATUSES);
  return { status: "done", added, openOrders: count ?? 0 };
}

export async function removeAdmin(
  input: RemoveAdminInput,
): Promise<{ status: "done" } | AdminEditFailure> {
  const parsed = removeAdminSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  const { error } = await supabase.rpc("admin_remove_admin", { p_user_id: parsed.data.userId });
  return error ? editFailure("admin_remove_admin", error, report) : { status: "done" };
}
