"use client";

import { useTranslations } from "next-intl";

import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";

import { setOrderSubscription } from "./actions";

/**
 * A2's "verify subscription" outcome: "شيل الاشتراك" (the order becomes a
 * cash order and its visit goes back) or "استخدم الاشتراك".
 */
export function OrderSubscriptionButton({ orderId, use }: { orderId: string; use: boolean }) {
  const t = useTranslations("Admin.drawer.subscription");
  const tErrors = useTranslations("Admin.editErrors");
  const edit = useAdminEdit();
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-13 text-muted">{use ? t("useHint") : t("dropHint")}</p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={edit.pending}
        className="self-start"
        onClick={() =>
          edit.run(
            () => setOrderSubscription({ orderId, use }),
            () => undefined,
          )
        }
      >
        {use ? t("use") : t("drop")}
      </Button>
      {edit.error && (
        <p role="alert" className="text-14 font-bold text-danger">
          {tErrors(edit.error)}
        </p>
      )}
    </div>
  );
}
