import { CircleCheck, SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { Screen } from "@/components/layout/screen";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { requireViewer } from "@/lib/auth/viewer";
import { serviceDayParts, slotParts } from "@/lib/dates";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

import { ForgetBooking } from "./forget-booking";

/**
 * Booking success (N5): "وصلنا طلبك #1024 · بانتظار تأكيد الشركة", the day
 * and slot, and buttons to Order details (N4) and Home. The push-permission
 * card comes with Web Push in Phase 5.
 */
export default function BookingDonePage(props: PageProps<"/book/done/[id]">) {
  return (
    <Screen className="justify-center bg-bg pb-safe-6">
      <Suspense fallback={<DoneSkeleton />}>
        <Done {...props} />
      </Suspense>
    </Screen>
  );
}

async function Done({ params }: PageProps<"/book/done/[id]">) {
  const { id } = await params;
  const viewer = await requireViewer(routes.booked(id));
  const t = await getTranslations("BookingDone");
  const tBooking = await getTranslations("Booking");

  const orderId = z.uuid().safeParse(id);
  const supabase = await createClient();
  const { data: order, error } = orderId.success
    ? await supabase
        .from("orders")
        .select("id, number, service_date, slot_start_at, slot_end_at")
        .eq("id", orderId.data)
        .maybeSingle()
    : { data: null, error: null };
  if (error) throw new Error(`Order read failed: ${error.message}`);

  if (!order) {
    return (
      <EmptyState
        icon={SearchX}
        titleAs="h1"
        title={t("notFound")}
        action={
          <Button href={routes.home} size="footer" className="w-full">
            {t("home")}
          </Button>
        }
      />
    );
  }

  const { weekday, day } = serviceDayParts(order.service_date);
  return (
    <>
      <ForgetBooking userId={viewer.id} />
      <EmptyState
        icon={CircleCheck}
        tone="success"
        titleAs="h1"
        title={t.rich("title", {
          number: order.number,
          num: (chunks) => <span dir="ltr">{chunks}</span>,
        })}
        description={
          <>
            <span className="block font-bold text-navy">{t("status")}</span>
            <span className="block">
              {t("when", {
                weekday,
                day,
                slot: tBooking("slot", slotParts(order.slot_start_at, order.slot_end_at)),
              })}
            </span>
          </>
        }
        action={
          <>
            <Button href={routes.order(order.id)} size="footer" className="w-full">
              {t("details")}
            </Button>
            <Button href={routes.home} variant="link" size="footer" className="w-full">
              {t("home")}
            </Button>
          </>
        }
      />
    </>
  );
}

function DoneSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col items-center gap-3.5 px-8 py-10">
      <Skeleton className="size-22 rounded-full" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-13.5 w-full rounded-button" />
    </SkeletonGroup>
  );
}
