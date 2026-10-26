"use server";

import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { type AdminEditFailure, editFailure } from "@/lib/admin/edit-errors";
import { toGeometry } from "@/lib/admin/geojson";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import { type ServiceAreaInput, serviceAreaSchema } from "@/lib/schemas/admin-catalog";
import { createClient } from "@/lib/supabase/server";

const report = (message: string) => Sentry.captureMessage(message, "error");

// admin_save_service_area()'s OUT parameters.
const savedSchema = z.object({ area_id: z.number(), addresses_outside: z.number() });

export type SaveAreaResult = { status: "done"; addressesOutside: number } | AdminEditFailure;

/**
 * A13: adds or changes a service area (admin_save_service_area). The
 * database checks the shape (valid, inside Iraq) and keeps one area active.
 */
export async function saveServiceArea(input: ServiceAreaInput): Promise<SaveAreaResult> {
  await requireViewer(routes.adminServiceArea, "admin");
  const parsed = serviceAreaSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const { id, name, active, area } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("admin_save_service_area", {
      // The generated type says number; the function takes null for a new area.
      p_id: id as number,
      p_name: name,
      p_area: toGeometry(area),
      p_active: active,
    })
    .single();
  if (error) return editFailure("admin_save_service_area", error, report);
  const saved = savedSchema.safeParse(data);
  if (!saved.success) return { status: "error", error: "failed" };
  return { status: "done", addressesOutside: saved.data.addresses_outside };
}
