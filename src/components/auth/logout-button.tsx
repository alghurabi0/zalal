"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { resetAnalytics } from "@/lib/monitoring/analytics";
import { routes } from "@/lib/routes";

/**
 * Logout with a confirmation (spec §5.8). Forgets the analytics user first,
 * because crew phones are shared, then posts to /logout, which ends the
 * session and loads Welcome as a full page.
 */
export function LogoutButton({ children }: { children: ReactNode }) {
  const t = useTranslations("Profile");
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    setPending(true);
    await resetAnalytics();
    formRef.current?.submit();
  };

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent title={t("logoutTitle")} description={t("logoutBody")}>
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
