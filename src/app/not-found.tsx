import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { Screen } from "@/components/layout/screen";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { routes } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NotFound");
  return { title: t("title"), robots: { index: false } };
}

// Every unknown URL and every notFound() without a closer not-found page
// (the certificate print page), on all three surfaces (spec §5 global
// rules). Home sends staff on to their own surface.
export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    <Screen className="justify-center bg-bg">
      <EmptyState
        icon={SearchX}
        titleAs="h1"
        title={t("title")}
        description={t("body")}
        action={
          <Button href={routes.home} size="footer" className="w-full">
            {t("home")}
          </Button>
        }
      />
    </Screen>
  );
}
