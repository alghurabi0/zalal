"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { clearMediaQueue } from "@/lib/crew/use-media-queue";
import { resetAnalytics } from "@/lib/monitoring/analytics";
import { forgetPush } from "@/lib/push/client";
import { routes } from "@/lib/routes";

/**
 * Logout with a confirmation (spec §5.8). Forgets the analytics user and
 * deletes the crew's queued photos and clips first (on every surface, so a
 * phone that changed hands keeps nothing), because crew phones are shared,
 * and forgets this browser's push subscription, then posts to /logout, which ends the session and loads Welcome as a full
 * page. `warning` is shown above the buttons (the crew's unsent files).
 */
export function LogoutButton({ children, warning }: { children: ReactNode; warning?: ReactNode }) {
  const t = useTranslations("Profile");
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    setPending(true);
    await Promise.all([
      resetAnalytics(),
      clearMediaQueue().catch(() => undefined),
      // A shared phone must not get this account's pushes after it.
      forgetPush(),
    ]);
    formRef.current?.submit();
  };

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent title={t("logoutTitle")} description={t("logoutBody")} busy={pending}>
        {warning}
        <form ref={formRef} method="post" action={routes.logout} className="flex flex-col gap-2">
          <Button onClick={() => void confirm()} loading={pending} className="bg-danger">
            {t("logoutConfirm")}
          </Button>
          <SheetClose asChild>
            <Button variant="secondary" disabled={pending}>
              {t("logoutCancel")}
            </Button>
          </SheetClose>
        </form>
      </SheetContent>
    </Sheet>
  );
}
