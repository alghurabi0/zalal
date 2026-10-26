import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { CertificateDocument } from "@/components/certificates/certificate-document";
import { publicOrigin } from "@/lib/certificates/origins";
import { hasPrintToken } from "@/lib/certificates/print-token";
import { loadCertificate } from "@/lib/certificates/queries";
import { certificateEnv } from "@/lib/env.server";
import { routes } from "@/lib/routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("CertificateDoc");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/**
 * The page the certificate PDF is printed from (spec §10.1). Headless
 * Chromium opens it with a print token for this certificate (src/lib/
 * certificates/pdf.ts) and reads it with the secret key; anyone else reads
 * it as themselves, so the customer and admins see it and everyone else
 * gets a 404 (RLS, migration certificates).
 */
export default function CertificatePrintPage(props: PageProps<"/certificates/[id]/print">) {
  return (
    <Suspense fallback={null}>
      <PrintContent {...props} />
    </Suspense>
  );
}

async function PrintContent({ params }: PageProps<"/certificates/[id]/print">) {
  const { id } = await params;
  const certificateId = z.uuid().safeParse(id);
  if (!certificateId.success) notFound();

  const client = (await hasPrintToken(certificateId.data))
    ? createAdminClient()
    : await createClient();
  const certificate = await loadCertificate(client, { certificateId: certificateId.data });
  if (!certificate) notFound();

  const requestHeaders = await headers();
  const origin =
    publicOrigin(
      certificateEnv(),
      requestHeaders.get("host"),
      requestHeaders.get("x-forwarded-proto"),
    ) ?? "";
  return (
    <CertificateDocument
      certificate={certificate}
      publicUrl={`${origin}${routes.publicCertificate(certificate.publicCode)}`}
    />
  );
}
