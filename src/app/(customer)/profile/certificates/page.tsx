import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Screen } from "@/components/layout/screen";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { certificateNumber } from "@/lib/certificates/format";
import { listMyCertificates, type MyCertificate } from "@/lib/certificates/queries";
import { formatDate, formatMonthYear } from "@/lib/dates";
import { routes } from "@/lib/routes";

import { TanksText } from "../../orders/order-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Certificates");
  return { title: t("metaTitle") };
}

/**
 * Certificates (N12, from Profile and Home): one card per completed order's
 * certificate, newest first, each opening Report (§5.15).
 */
export default async function CertificatesPage() {
  const t = await getTranslations("Certificates");
  return (
    <Screen className="bg-bg">
      <header className="flex items-center gap-3 px-5 pt-4.5 pb-3.5">
        <BackButton href={routes.profile} />
        <h1 id="certificates-title" className="flex-1 text-22 font-black">
          {t("title")}
        </h1>
      </header>
      <Suspense fallback={<CertificatesSkeleton />}>
        <CertificatesContent />
      </Suspense>
    </Screen>
  );
}

async function CertificatesContent() {
  await requireViewer(routes.certificates);
  const t = await getTranslations("Certificates");
  const certificates = await listMyCertificates();

  return (
    <div className="flex flex-col px-4 pb-6">
      {certificates.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={t("empty")}
          description={t("emptyBody")}
          action={
            <Button href={routes.book} size="footer" className="w-full">
              {t("book")}
            </Button>
          }
        />
      ) : (
        <ul aria-labelledby="certificates-title" className="flex flex-col gap-2.5">
          {certificates.map((certificate) => (
            <li key={certificate.id}>
              <CertificateCard certificate={certificate} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function CertificateCard({ certificate }: { certificate: MyCertificate }) {
  const t = await getTranslations("Certificates");
  return (
    <Card className="relative flex items-center gap-3 p-3.5">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-input bg-ok-bg text-ok-fg">
        <ShieldCheck aria-hidden className="size-6" strokeWidth={2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          href={routes.certificate(certificate.orderId)}
          className="text-15 font-extrabold outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-teal"
        >
          {t.rich("number", {
            certificate: certificateNumber(certificate.orderNumber),
            num: (chunks) => <span dir="ltr">{chunks}</span>,
          })}
        </Link>
        <span className="truncate text-13 text-muted">
          {formatDate(certificate.serviceDate)} · {certificate.district} ·{" "}
          <TanksText lines={certificate.tanks} />
        </span>
        <span className="text-13 font-bold text-teal">
          {t("next", { month: formatMonthYear(certificate.nextDueOn) })}
        </span>
      </span>
    </Card>
  );
}

function CertificatesSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-2.5 px-4">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-22 w-full rounded-card" />
      ))}
    </SkeletonGroup>
  );
}
