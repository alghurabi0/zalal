"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

import { selectHomeAddress } from "../addresses/actions";

/**
 * N8's "احجز زيارة": Booking uses Home's chosen address, so this picks the
 * subscribed address first (as N2 does), then opens Booking, where Checkout
 * offers the subscription.
 */
export function BookVisitButton({ addressId, label }: { addressId: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="footer"
      className="w-full"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          await selectHomeAddress(addressId).catch(() => undefined);
          router.push(routes.book);
        })
      }
    >
      {label}
    </Button>
  );
}
