import { Suspense } from "react";

import { AdminLive } from "@/components/admin/admin-live";
import { AdminNav } from "@/components/admin/admin-nav";
import { PushSync } from "@/components/notifications/push-sync";
import { StaffPushButton } from "@/components/notifications/staff-push-button";
import { LiveSubscriptions } from "@/components/subscriptions/live-subscriptions";
import { LiveTickets } from "@/components/tickets/live-tickets";
import { Skeleton } from "@/components/ui/skeleton";
import { unreadThreads } from "@/lib/admin/chat-queries";
import { subscriptionRequestCount } from "@/lib/admin/subscription-queries";
import { openTicketCount } from "@/lib/admin/ticket-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

/**
 * The admin dashboard shell (spec §8.2): desktop-first, works on tablets.
 * Admins only; every page checks again with requireViewer(…, "admin").
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg lg:flex-row">
      <Suspense
        fallback={
          <div className="h-28 shrink-0 bg-navy lg:h-dvh lg:w-60">
            <Skeleton className="m-4 h-7 w-24 bg-navy-2" />
          </div>
        }
      >
        <Chrome />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

async function Chrome() {
  const viewer = await requireViewer(routes.admin, "admin");
  const [unread, openTickets, requests] = await Promise.all([
    unreadThreads(),
    openTicketCount(),
    subscriptionRequestCount(),
  ]);
  return (
    <AdminNav
      name={viewer.fullName}
      chatUnread={unread.map((thread) => thread.id)}
      openTickets={openTickets}
      subscriptionRequests={requests}
    >
      <AdminLive chatUnread={unread} />
      <StaffPushButton />
      <PushSync />
      {/* A new ticket or a status change refreshes every admin page (A1, A5, the nav count). */}
      <LiveTickets />
      {/* A new subscription request or a change refreshes them too (A1, A7, the nav count). */}
      <LiveSubscriptions />
    </AdminNav>
  );
}
