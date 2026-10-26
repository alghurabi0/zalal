"use server";

import * as Sentry from "@sentry/nextjs";

import { type AdminEditResult, editFailure } from "@/lib/admin/edit-errors";
import { requireViewer } from "@/lib/auth/viewer";
import type { Json } from "@/lib/database.types";
import { routes } from "@/lib/routes";
import { type SettingsSectionInput, settingsSectionSchema } from "@/lib/schemas/admin-catalog";
import { createClient } from "@/lib/supabase/server";

const report = (message: string) => Sentry.captureMessage(message, "error");

/**
 * A13: saves one section of settings (admin_update_settings). The patch
 * holds only that section's keys; the database logs the ones that changed.
 */
export async function saveSettings(input: SettingsSectionInput): Promise<AdminEditResult> {
  await requireViewer(routes.adminSettings, "admin");
  const parsed = settingsSectionSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const patch: { [key: string]: Json } = parsed.data.values;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_settings", { p_patch: patch });
  return error ? editFailure("admin_update_settings", error, report) : { status: "done" };
}
