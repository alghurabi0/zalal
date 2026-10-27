import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getViewer, surfaceFor } from "@/lib/auth/viewer";
import { notificationHref } from "@/lib/notifications/describe";
import { routes, withNext } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Opens a notification (spec §5.7, §9.2): marks it read, then redirects to
 * where it points. The list's items and push taps (the service worker) both
 * come here, for every role. A notification the viewer can't read (another
 * account on a shared phone, a role they no longer hold, an old id) leads to
 * their own surface instead. Marking read is the only effect, and only on
 * the viewer's own row, so a GET is safe here.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/notifications/[id]">) {
  const { id } = await params;
  const viewer = await getViewer();
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  if (!viewer) return go(withNext(routes.login, routes.openNotification(id)));

  const fallback = viewer.role === "customer" ? routes.notifications : surfaceFor(viewer.role);
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return go(fallback);

  const supabase = await createClient();
  const { data: notification } = await supabase
    .from("notifications")
    .select("id, type, data, order_id, ticket_id")
    .eq("id", parsed.data)
    .maybeSingle();
  if (!notification) return go(fallback);

  // Best effort: a failed read mark still opens the target.
  await supabase.rpc("mark_notification_read", { p_notification_id: notification.id });

  return go(
    notificationHref({
      type: notification.type,
      data: notification.data,
      orderId: notification.order_id,
      ticketId: notification.ticket_id,
    }),
  );
}
