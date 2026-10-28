import { LegalPage } from "@/components/layout/legal-page";

/** Terms (N14), from Login and Settings (`?from=settings`). */
export default function TermsPage({ searchParams }: PageProps<"/terms">) {
  return <LegalPage kind="terms" searchParams={searchParams} />;
}
