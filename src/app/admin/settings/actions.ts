"use server";

import * as Sentry from "@sentry/nextjs";

import { z } from "zod";

import { type AdminEditResult, editFailure } from "@/lib/admin/edit-errors";
import { APP_VERSION, compareVersions } from "@/lib/app-version";
import { requireViewer } from "@/lib/auth/viewer";
import type { Json } from "@/lib/database.types";
import { routes } from "@/lib/routes";
import {
  type SettingsSectionInput,
  settingsSectionSchema,
  stampPathSchema,
} from "@/lib/schemas/admin-catalog";
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
  // A minimum above this build would ask every surface, A13 included, for an
  // update that isn't deployed yet.
  if (
    parsed.data.section === "app" &&
    compareVersions(parsed.data.values.min_app_version, APP_VERSION) > 0
  ) {
    return { status: "error", error: "invalid" };
  }
  const patch: { [key: string]: Json } = parsed.data.values;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_settings", { p_patch: patch });
  return error ? editFailure("admin_update_settings", error, report) : { status: "done" };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Best effort, through the admin's own Storage client (never the secret
 * key), so the delete policy refuses the stamp in use. A stamp left behind
 * is deleted by the nightly cleanup.
 */
async function removeStamp(supabase: Supabase, path: string | null) {
  if (!path) return;
  const { error } = await supabase.storage.from("public-content").remove([path]);
  if (error) report("certificate stamp delete failed");
}

/**
 * A13: the certificate stamp (admin_set_certificate_stamp), a fresh upload
 * in public-content/stamp/, or null to remove it. The stamp it replaced is
 * deleted.
 */
export async function saveStamp(input: { path: string | null }): Promise<AdminEditResult> {
  await requireViewer(routes.adminSettings, "admin");
  const parsed = z.object({ path: stampPathSchema.nullable() }).safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_certificate_stamp", {
    p_path: parsed.data.path ?? undefined,
  });
  if (error) {
    // The upload stays unused; take it away now rather than at night.
    await removeStamp(supabase, parsed.data.path);
    return editFailure("admin_set_certificate_stamp", error, report);
  }
  await removeStamp(supabase, data);
  return { status: "done" };
}
