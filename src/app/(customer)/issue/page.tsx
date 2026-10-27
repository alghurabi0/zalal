import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { Screen } from "@/components/layout/screen";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { addDays, baghdadToday, formatDayShort } from "@/lib/dates";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { type IssueOrder, issueOrders, ticketResponseHours } from "@/lib/tickets/queries";

import { IssueForm } from "./issue-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Issue");
  return { title: t("metaTitle") };
}

/**
 * Issue report (Issue.dc.html, spec §5.17): a category, an optional order
 * from the last 90 days, a description and up to 3 files. Sending makes
 * ticket ZL-T-#### and posts a message in Chat. `?order=<id>` (Report's
 * "بلّغنا") picks that order.
 */
export default function IssuePage(props: PageProps<"/issue">) {
  return (
    <Screen className="bg-bg">
      <Suspense fallback={<IssueSkeleton />}>
        <IssueContent {...props} />
      </Suspense>
    </Screen>
  );
}

async function IssueContent({ searchParams }: PageProps<"/issue">) {
  const { order } = await searchParams;
  const parsed = z.uuid().safeParse(Array.isArray(order) ? order[0] : order);
  const tagged = parsed.success ? parsed.data : null;
  const viewer = await requireViewer(tagged ? routes.issueAbout(tagged) : routes.issue);

  const supabase = await createClient();
  // The server's clock: "اليوم" and the 90-day window are Baghdad days.
  const now = new Date();
  const [orders, hours, sent] = await Promise.all([
    issueOrders(now, supabase),
    ticketResponseHours(supabase),
    supabase.from("tickets").select("id", { count: "exact", head: true }),
  ]);
  if (sent.error) throw new Error(`Tickets count failed: ${sent.error.message}`);
  const t = await getTranslations("Issue");
  const tankNames = await getTranslations("Tanks.types");

  const today = baghdadToday(now);
  const dayLabel = (day: string) => {
    if (day === today) return t("today");
    if (day === addDays(today, -1)) return t("yesterday");
    if (day === addDays(today, 1)) return t("tomorrow");
    return formatDayShort(day);
  };
  const label = (item: IssueOrder) =>
    t("orderOption", {
      number: item.number,
      day: dayLabel(item.serviceDate),
      tank: t("orderTanks", {
        type: item.tanks[0] ? tankNames(item.tanks[0]) : "",
        more: Math.max(item.tanks.length - 1, 0),
      }),
    });
  const options = orders.map((item) => ({ id: item.id, label: label(item) }));
  // The design starts on the newest order; a tagged one wins when it is listed.
  const initialOrderId =
    (tagged && options.some((item) => item.id === tagged) ? tagged : options[0]?.id) ?? "";

  return (
    <IssueForm
      // Next keeps visited pages alive: a new ticket changes the key, so the
      // next report starts from an empty form with a new client id.
      key={`${viewer.id}:${tagged ?? ""}:${sent.count ?? 0}`}
      userId={viewer.id}
      orders={options}
      initialOrderId={initialOrderId}
      responseHours={hours}
      back={
        tagged && options.some((item) => item.id === tagged) ? routes.order(tagged) : routes.home
      }
    />
  );
}

function IssueSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-3.5 px-5 pt-4.5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <Skeleton className="h-5 w-24" />
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-12.5 rounded-chip" />
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-chip" />
      <Skeleton className="h-24 w-full rounded-chip" />
    </SkeletonGroup>
  );
}
