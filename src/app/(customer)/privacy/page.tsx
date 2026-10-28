import { LegalPage } from "@/components/layout/legal-page";

/** Privacy (N14), from Login and Settings (`?from=settings`). */
export default function PrivacyPage({ searchParams }: PageProps<"/privacy">) {
  return <LegalPage kind="privacy" searchParams={searchParams} />;
}
