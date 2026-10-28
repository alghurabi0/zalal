import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { routes } from "@/lib/routes";

/** "كل المقالات", back to A11's list. */
export function BackToContent() {
  const t = useTranslations("Admin.content.editor");
  return (
    <Button href={routes.adminContent} variant="secondary" size="sm">
      {t("back")}
      <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
    </Button>
  );
}

export function EditorSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-5 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Skeleton className="h-11.5 rounded-input" />
        <Skeleton className="h-11.5 rounded-input" />
        <Skeleton className="h-80 rounded-input" />
      </div>
      <div className="flex flex-col gap-4 lg:w-72 lg:shrink-0">
        <Skeleton className="h-11.5 rounded-input" />
        <Skeleton className="aspect-video rounded-card" />
      </div>
    </SkeletonGroup>
  );
}
