import { redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { LiveOrders } from "@/components/orders/live-orders";
import { OrderMissing } from "@/components/orders/order-missing";
import { Screen } from "@/components/layout/screen";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { getTracking } from "@/lib/live/queries";
import { canFollowJob, canTrack } from "@/lib/orders/status";
import { routes } from "@/lib/routes";

import { TrackingView } from "./tracking-view";

/**
 * Tracking (spec §5.13, Tracking.dc.html): the home and the crew on a map,
 * the straight-line distance and the age of the last position, the four
 * steps, a call to the company, and the way on to Job progress. Open while
 * the crew is on the way or has arrived; other statuses go to Job progress
 * or Order details.
 */
export default function TrackingPage(props: PageProps<"/orders/[id]/track">) {
  return (
    <Screen className="h-dvh min-h-0 overflow-hidden bg-map-bg">
      <Suspense fallback={<TrackingSkeleton />}>
        <TrackingContent {...props} />
      </Suspense>
    </Screen>
  );
}

async function TrackingContent({ params }: PageProps<"/orders/[id]/track">) {
  const { id } = await params;
  const viewer = await requireViewer(routes.tracking(id));
  const orderId = z.uuid().safeParse(id);
  const order = orderId.success ? await getTracking(orderId.data) : null;
  if (!order) return <OrderMissing />;
  if (!canTrack(order.status)) {
    redirect(canFollowJob(order.status) ? routes.jobProgress(order.id) : routes.order(order.id));
  }

  return (
    <>
      {/* A status change (arrived, a new crew) reloads the page's data. */}
      <LiveOrders customerId={viewer.id} />
      <TrackingView
        // A new crew or status starts from the server's reading again.
        key={`${order.crewId}:${order.status}`}
        order={order}
      />
    </>
  );
}

function TrackingSkeleton() {
  return (
    <SkeletonGroup className="flex flex-1 flex-col">
      <div className="flex-1" />
      <div className="flex flex-col gap-3.5 rounded-t-sheet bg-surface px-5 pt-6 pb-8">
        <Skeleton className="h-12 w-40" />
        <Skeleton className="h-6" />
        <Skeleton className="h-18 rounded-input" />
        <Skeleton className="h-13 rounded-button" />
      </div>
    </SkeletonGroup>
  );
}
