"use server";

import * as Sentry from "@sentry/nextjs";

import { type AdminEditFailure, editFailure } from "@/lib/admin/edit-errors";
import { ensureAccount } from "@/lib/admin/staff-accounts";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import {
  type CreateCrewInput,
  createCrewSchema,
  type SetCrewPhoneInput,
  setCrewPhoneSchema,
  type UpdateCrewInput,
  updateCrewSchema,
} from "@/lib/schemas/admin-staff";
import { createClient } from "@/lib/supabase/server";

// A10's actions (spec §8.2). The account comes from the Auth admin API; the
// RPCs, called as the admin, decide whether it may be a crew and audit it.

const report = (message: string) => Sentry.captureMessage(message, "error");

async function admin() {
  await requireViewer(routes.adminCrews, "admin");
  return createClient();
}

const failed: AdminEditFailure = { status: "error", error: "failed" };

export async function createCrew(
  input: CreateCrewInput,
): Promise<{ status: "done" } | AdminEditFailure> {
  const parsed = createCrewSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  if (!(await ensureAccount(parsed.data.phone))) {
    report("crew account create failed");
    return failed;
  }
  const { error } = await supabase.rpc("admin_create_crew", {
    p_phone: parsed.data.phone,
    p_name: parsed.data.name,
  });
  return error ? editFailure("admin_create_crew", error, report) : { status: "done" };
}

/** Rename, switch on or off. `openOrders`: orders the crew still holds. */
export async function updateCrew(
  input: UpdateCrewInput,
): Promise<{ status: "done"; openOrders: number } | AdminEditFailure> {
  const parsed = updateCrewSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  const { data, error } = await supabase.rpc("admin_update_crew", {
    p_crew_id: parsed.data.id,
    p_name: parsed.data.name,
    p_active: parsed.data.active,
  });
  return error
    ? editFailure("admin_update_crew", error, report)
    : { status: "done", openOrders: data };
}

export async function setCrewPhone(
  input: SetCrewPhoneInput,
): Promise<{ status: "done" } | AdminEditFailure> {
  const parsed = setCrewPhoneSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  if (!(await ensureAccount(parsed.data.phone))) {
    report("crew account create failed");
    return failed;
  }
  const { error } = await supabase.rpc("admin_set_crew_phone", {
    p_crew_id: parsed.data.id,
    p_phone: parsed.data.phone,
  });
  return error ? editFailure("admin_set_crew_phone", error, report) : { status: "done" };
}
