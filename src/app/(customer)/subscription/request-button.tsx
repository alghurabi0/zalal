"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { RequestSubscriptionError } from "@/lib/subscriptions/errors";

import { requestSubscription } from "./actions";

/**
 * "اطلب الاشتراك" / "جدّد الاشتراك": sends the request for the address, then
 * shows N8 again (now "طلبك قيد المراجعة"). A refusal says why.
 */
export function RequestButton({ addressId, label }: { addressId: string; label: string }) {
  const t = useTranslations("Subscription.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<RequestSubscriptionError | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="footer"
        className="w-full"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await requestSubscription({ addressId }).catch(() => ({
              status: "error" as const,
              error: "failed" as const,
            }));
            if (result.status === "error") {
              setError(result.error);
              return;
            }
            router.refresh();
          })
        }
      >
        {label}
      </Button>
      <p aria-live="polite" className="text-center text-14 font-bold text-danger empty:hidden">
        {error ? t(error) : null}
      </p>
    </div>
  );
}
