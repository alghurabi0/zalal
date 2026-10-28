"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/** Profile's "تذكير بموعد التنظيف" (spec §5.8): saves reminders_enabled as the user (RLS). */
export async function setReminders(enabled: unknown): Promise<{ ok: boolean }> {
  const parsed = z.boolean().safeParse(enabled);
  if (!parsed.success) return { ok: false };
  const viewer = await requireViewer(routes.profile);
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ reminders_enabled: parsed.data })
    .eq("id", viewer.id);
  if (error) return { ok: false };
  revalidatePath(routes.profile);
  return { ok: true };
}
