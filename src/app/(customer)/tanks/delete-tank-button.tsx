"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { deleteTank } from "./actions";

/** "حذف" with an inline confirmation (N3). */
export function DeleteTankButton({ tankId, name }: { tankId: string; name: string }) {
  const t = useTranslations("Tanks");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button
        variant="link"
        size="sm"
        className="px-2 text-danger"
        onClick={() => setConfirming(true)}
        aria-label={`${t("delete")} ${name}`}
      >
        {t("delete")}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1">
      <span className="text-13 font-bold text-danger">
        {failed ? t("errors.failed") : t("confirmDelete")}
      </span>
      <Button
        variant="link"
        size="sm"
        className="px-2 text-danger"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteTank(tankId);
            if (result.error) setFailed(true);
            else router.refresh();
          })
        }
      >
        {t("confirmDeleteYes")}
      </Button>
      <Button
        variant="link"
        size="sm"
        className="px-2 text-muted"
        disabled={pending}
        onClick={() => {
          setConfirming(false);
          setFailed(false);
        }}
      >
        {t("confirmDeleteNo")}
      </Button>
    </div>
  );
}
