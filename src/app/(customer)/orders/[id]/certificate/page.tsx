import { Check, Download, FileX } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { CertificateRow } from "@/components/certificates/certificate-row";
import { Screen } from "@/components/layout/screen";
import { LiveOrders } from "@/components/orders/live-orders";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { certificateNumber } from "@/lib/certificates/format";
import { type CertificateData, getCertificate } from "@/lib/certificates/queries";
import { formatDate, formatDayMonth } from "@/lib/dates";
import { getOrder } from "@/lib/orders/queries";
import { canFollowJob, canTrack } from "@/lib/orders/status";
import { textDir } from "@/lib/bidi";
import { routes } from "@/lib/routes";

import { BeforeAfter } from "./before-after";
import { Rating } from "./rating";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Report");
  return { title: t("metaTitle") };
}

/**
 * Certificate and rating (spec §5.15, Report.dc.html), once the order is
 * completed: the crew's before/after photos and clips, the certificate rows
 * (tanks, sterilant, residual chlorine when entered, "نُفّذ بواسطة: شركة
 * زلال", next cleaning), the PDF download, sharing the public link (N15) and
 * the company rating. Other statuses go to Job progress, Tracking or Order
 * details.
 */
export default function ReportPage(props: PageProps<"/orders/[id]/certificate">) {
  return (
    <Screen className="bg-bg">
      <Suspense fallback={<ReportSkeleton />}>
        <ReportContent {...props} />
      </Suspense>
    </Screen>
  );
}

async function ReportContent({ params, searchParams }: PageProps<"/orders/[id]/certificate">) {
  const { id } = await params;
  const viewer = await requireViewer(routes.certificate(id));
  const t = await getTranslations("Report");
  const orderId = z.uuid().safeParse(id);
  const certificate = orderId.success ? await getCertificate(orderId.data) : null;

  if (!certificate) {
    // Not completed (any more): send the customer where the order is now.
    const order = orderId.success ? await getOrder(orderId.data) : null;
    if (order && order.status !== "completed") {
      redirect(
        canTrack(order.status)
          ? routes.tracking(order.id)
          : canFollowJob(order.status)
            ? routes.jobProgress(order.id)
            : routes.order(order.id),
      );
    }
    return (
      <>
        <header className="flex items-center gap-3 px-5 pt-4.5">
          <BackButton href={orderId.success && order ? routes.order(order.id) : routes.orders} />
          <h1 className="text-20 font-black">{t("title")}</h1>
        </header>
        <EmptyState
          icon={FileX}
          title={t("notReady")}
          description={t("notReadyBody")}
          action={
            <Button
              href={order ? routes.order(order.id) : routes.orders}
              size="footer"
              className="w-full"
            >
              {t("toOrder")}
            </Button>
          }
        />
      </>
    );
  }

  const { pdf } = await searchParams;
  const number = certificateNumber(certificate.order.number);
  return (
    <>
      <LiveOrders customerId={viewer.id} />
      <header className="flex flex-col gap-3 bg-navy px-5 pt-4.5 pb-5 text-white">
        <div className="flex items-center gap-3">
          <BackButton href={routes.order(certificate.order.id)} variant="dark" />
          <h1 className="flex-1 text-20 font-black">{t("title")}</h1>
          {/* A plain link: the route answers with a redirect to the file. */}
          <a
            href={routes.certificatePdf(certificate.order.id)}
            aria-label={t("download")}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-navy-2 text-white focus-visible:outline-aqua"
          >
            <Download aria-hidden className="size-5" strokeWidth={2} />
          </a>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex size-13 shrink-0 items-center justify-center rounded-full bg-aqua">
            <Check aria-hidden className="size-7 text-navy" strokeWidth={2.6} />
          </span>
          <div className="flex flex-col">
            <span className="text-19 font-black">{t("headline")}</span>
            <span className="text-13 text-on-dark-muted">
              {t.rich("subtitle", {
                number: certificate.order.number,
                date: formatDate(certificate.issuedAt),
                certificate: number,
                num: (chunks) => (
                  <span dir="ltr" className="whitespace-nowrap">
                    {chunks}
                  </span>
                ),
              })}
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 px-4 pt-3.5">
        {pdf === "failed" && (
          <p
            role="alert"
            className="rounded-input bg-warn-bg px-3.5 py-2.5 text-13 font-bold text-warn-fg"
          >
            {t("pdfFailed")}
          </p>
        )}
        <BeforeAfter before={certificate.before} after={certificate.after} />
        <Clips certificate={certificate} />
        <Rows certificate={certificate} />
      </div>
      <Rating
        orderId={certificate.order.id}
        rating={certificate.rating}
        shareCode={certificate.publicCode}
        certificate={number}
      />
    </>
  );
}

async function Clips({ certificate }: { certificate: CertificateData }) {
  if (certificate.clips.length === 0) return null;
  const t = await getTranslations("Report");
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-14 font-extrabold">{t("clips")}</h2>
      <ul className="grid grid-cols-2 gap-2">
        {certificate.clips.map((clip, index) => (
          <li key={clip.id} className="aspect-video overflow-hidden rounded-chip bg-navy">
            {clip.url ? (
              <video
                src={clip.url}
                controls
                preload="metadata"
                aria-label={t("clip", { n: index + 1 })}
                className="size-full object-cover"
              />
            ) : (
              <span className="flex size-full items-center justify-center p-1 text-center text-11 text-on-dark-muted">
                {t("fileMissing")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Rows({ certificate }: { certificate: CertificateData }) {
  const t = await getTranslations("Report");
  const tTanks = await getTranslations("Tanks");
  return (
    <section
      aria-label={t("rows.label")}
      className="rounded-button border border-border bg-surface px-3.5 py-1"
    >
      <dl className="flex flex-col">
        <CertificateRow label={t("rows.tanks")}>
          <ul className="flex flex-col items-end">
            {certificate.order.tanks.map((tank, index) => (
              <li key={index}>
                {t.rich("tank", {
                  type: tTanks(`types.${tank.tank_type}`),
                  size: tTanks(`sizes.${tank.size}`),
                  qty: tank.qty,
                  iso: (chunks) => <bdi dir={textDir(tTanks(`sizes.${tank.size}`))}>{chunks}</bdi>,
                })}
              </li>
            ))}
          </ul>
        </CertificateRow>
        {certificate.sterilant && (
          <CertificateRow label={t("rows.sterilant")}>{certificate.sterilant}</CertificateRow>
        )}
        {certificate.chlorine !== null && (
          <CertificateRow label={t("rows.chlorine")}>
            {t("chlorineValue", { value: certificate.chlorine.toFixed(1) })}
          </CertificateRow>
        )}
        <CertificateRow label={t("rows.by")}>{t("company")}</CertificateRow>
        <CertificateRow label={t("rows.next")} last>
          <span className="text-teal">
            {certificate.customer.remindersEnabled
              ? t("nextValue", { month: formatDayMonth(certificate.nextDueOn) })
              : formatDayMonth(certificate.nextDueOn)}
          </span>
        </CertificateRow>
      </dl>
    </section>
  );
}

function ReportSkeleton() {
  return (
    <>
      <div className="flex h-35 flex-col gap-3 bg-navy px-5 pt-4.5">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-full opacity-20" />
          <Skeleton className="h-6 w-32 opacity-20" />
        </div>
      </div>
      <SkeletonGroup className="flex flex-col gap-3 px-4 pt-3.5">
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-26 rounded-button" />
          <Skeleton className="h-26 rounded-button" />
        </div>
        <Skeleton className="h-52 rounded-button" />
        <Skeleton className="h-36 rounded-button" />
      </SkeletonGroup>
    </>
  );
}
