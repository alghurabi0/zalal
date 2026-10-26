"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

/** C2's empty state: fetch the jobs again. */
export function RefreshButton() {
  const t = useTranslations("Crew");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="footer"
      className="w-full"
      loading={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {t("refresh")}
    </Button>
  );
}
