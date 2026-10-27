"use server";

import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

// "قراءة الكل" on Notifications (spec §5.7), through
// mark_all_notifications_read(), which touches only the caller's rows.

export async function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  await requireViewer(routes.notifications);
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_all_notifications_read");
  return { ok: !error };
}
