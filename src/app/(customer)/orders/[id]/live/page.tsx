import { Check } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { Screen } from "@/components/layout/screen";
import { LiveMedia } from "@/components/live/live-media";
import { LiveOrders } from "@/components/orders/live-orders";
import { OrderMissing } from "@/components/orders/order-missing";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/dates";
import { isLive, jobSteps } from "@/lib/live/job";
import { getJobProgress, type JobProgressData } from "@/lib/live/queries";
import { canFollowJob, canTrack } from "@/lib/orders/status";
import { routes } from "@/lib/routes";

import { JobFiles } from "./job-files";

/**
 * Job progress (spec §5.14, LiveJob.dc.html): the timeline وصل الفريق / بدأ
 * الشغل / خلص الشغل with times, the crew's "قبل" photos, its clips and its
 * "بعد" photos, all live. Open from arrival on; on the way it sends the
 * customer to Tracking, before that to Order details. The certificate
 * button waits for Phase 4, task 2: until then a completed order's button
 * opens Order details.
 */
export default function JobProgressPage(props: PageProps<"/orders/[id]/live">) {
  return (
    <Screen className="bg-bg">
      <Suspense fallback={<JobProgressSkeleton />}>
        <JobProgressContent {...props} />
      </Suspense>
    </Screen>
  );
}

async function JobProgressContent({ params }: PageProps<"/orders/[id]/live">) {
  const { id } = await params;
  const viewer = await requireViewer(routes.jobProgress(id));
  const orderId = z.uuid().safeParse(id);
  const job = orderId.success ? await getJobProgress(orderId.data) : null;
  if (!job) return <OrderMissing />;
  if (!canFollowJob(job.status)) {
    redirect(canTrack(job.status) ? routes.tracking(job.id) : routes.order(job.id));
  }

  const t = await getTranslations("LiveJob");
  const subtitle = job.status as "arrived" | "in_progress" | "completed";
  return (
    <>
      <LiveOrders customerId={viewer.id} />
      <LiveMedia orderId={job.id} />
      <header className="flex items-center gap-3 px-5 pt-4.5 pb-3">
        <BackButton href={routes.order(job.id)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-20 font-black">{t("title")}</h1>
          <span className="text-13 text-muted">
            {t.rich(`subtitle.${subtitle}`, {
              number: job.number,
              num: (chunks) => <span dir="ltr">{chunks}</span>,
            })}
          </span>
        </div>
        {isLive(job.status) && (
          <span className="flex items-center gap-1.5 text-13 font-extrabold text-danger">
            <span aria-hidden className="size-2 rounded-full bg-live" />
            {t("live")}
          </span>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-3 px-4 pb-6">
        <Steps job={job} />
        <JobFiles files={job.files} done={job.status === "completed"} />
      </div>

      <footer className="sticky bottom-0 z-10 flex gap-2.5 border-t border-border bg-surface px-5 pt-3 pb-safe-5.5">
        {/* Chat joins it in Phase 5; the certificate comes with Phase 4, task 2. */}
        {job.status === "completed" ? (
          <Button href={routes.order(job.id)} size="footer" className="flex-1">
            {t("details")}
          </Button>
        ) : (
          <Button size="footer" disabled className="flex-1">
            {t("certificateLater")}
          </Button>
        )}
      </footer>
    </>
  );
}

async function Steps({ job }: { job: JobProgressData }) {
  const t = await getTranslations("LiveJob");
  const steps = jobSteps(job.status, job.times);
  return (
    <ol aria-label={t("steps.label")} className="flex flex-col gap-0.5 px-1 pt-1">
      {steps.map(({ step, state, at }, index) => (
        <li key={step} className="flex gap-3" data-state={state}>
          <div className="flex w-6.5 flex-col items-center">
            <span
              aria-hidden
              className={cn(
                "flex size-6.5 shrink-0 items-center justify-center rounded-full text-12 font-extrabold",
                state === "done" && "bg-navy text-white",
                state === "now" && "bg-warn text-navy",
                state === "next" && "border-2 border-track bg-surface text-muted",
              )}
            >
              {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
            </span>
            {index < steps.length - 1 && (
              <span aria-hidden className="min-h-2.5 w-0.5 flex-1 bg-track" />
            )}
          </div>
          <div className="flex flex-1 flex-col pb-2.5">
            <span
              className={cn(
                "text-14",
                state === "next" ? "font-semibold text-muted" : "font-extrabold text-navy",
              )}
            >
              {t(`steps.${step}`)}
              <span className="sr-only"> ({t(`stepState.${state}`)})</span>
            </span>
            {at && (
              <span className="text-12 text-muted">
                {state === "now" ? t("startedAt", { time: formatTime(at) }) : formatTime(at)}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function JobProgressSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-3 px-4 pt-5">
      <div className="flex items-center gap-3 px-1">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="h-10 w-40" />
      </div>
      <Skeleton className="h-36 rounded-card" />
      <Skeleton className="h-40 rounded-card" />
    </SkeletonGroup>
  );
}
