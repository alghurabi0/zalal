import { BadgeCheck, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { LogoMark } from "@/components/brand/logo-mark";
import { CertificateRow } from "@/components/certificates/certificate-row";
import { TankLine } from "@/components/certificates/tank-line";
import { Screen } from "@/components/layout/screen";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { certificateNumber } from "@/lib/certificates/format";
import { getPublicCertificate } from "@/lib/certificates/queries";
import { formatDate } from "@/lib/dates";
import { routes } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("PublicCertificate");
  // Codes are not secrets, but there's no reason for search engines to list them.
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/**
 * Public certificate page (N15), opened from the share link and the PDF's QR
 * code, without login. It shows what the certificate says about the
 * service (number, date, district, tanks) and nothing personal: no name,
 * phone, landmark or photos (public_certificate, migration certificates).
 * An order no longer completed shows as not found.
 */
export default function PublicCertificatePage(props: PageProps<"/c/[code]">) {
  return (
    <Screen className="bg-bg">
      <header className="flex items-center gap-3 px-5 pt-4.5">
        <span className="flex size-11 items-center justify-center rounded-full border border-border bg-surface">
          <LogoMark className="w-7.5" />
        </span>
        <PageTitle />
      </header>
      <Suspense fallback={<PublicSkeleton />}>
        <PublicContent {...props} />
      </Suspense>
    </Screen>
  );
}

async function PageTitle() {
  const t = await getTranslations("PublicCertificate");
  return <h1 className="text-20 font-black">{t("title")}</h1>;
}

async function PublicContent({ params }: PageProps<"/c/[code]">) {
  const { code } = await params;
  const t = await getTranslations("PublicCertificate");
  const certificate = await getPublicCertificate(code);

  if (!certificate) {
    return (
      <EmptyState
        icon={SearchX}
        title={t("notFound")}
        description={t("notFoundBody")}
        action={
          <Button href={routes.home} size="footer" variant="secondary" className="w-full">
            {t("home")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pt-5 pb-safe-6">
      <Card className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 rounded-input bg-ok-bg px-3 py-2.5 text-15 font-extrabold text-ok-fg">
          <BadgeCheck aria-hidden className="size-5.5 shrink-0" />
          {t("valid")}
        </p>
        <dl className="flex flex-col">
          <CertificateRow label={t("number")}>
            <span dir="ltr">{certificateNumber(certificate.number)}</span>
          </CertificateRow>
          <CertificateRow label={t("issued")}>{formatDate(certificate.issuedAt)}</CertificateRow>
          <CertificateRow label={t("district")}>{certificate.district}</CertificateRow>
          <CertificateRow label={t("tanks")} last>
            <ul className="flex flex-col items-end">
              {certificate.tanks.map((tank, index) => (
                <li key={index}>
                  <TankLine tank={tank} />
                </li>
              ))}
            </ul>
          </CertificateRow>
        </dl>
      </Card>
      <p className="px-1 text-13 leading-relaxed text-muted">{t("disclaimer")}</p>
      <Button href={routes.home} size="footer" variant="secondary" className="mt-auto w-full">
        {t("home")}
      </Button>
    </div>
  );
}

function PublicSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-3 px-4 pt-5">
      <Skeleton className="h-60 rounded-card" />
      <Skeleton className="h-10 w-3/4" />
    </SkeletonGroup>
  );
}
