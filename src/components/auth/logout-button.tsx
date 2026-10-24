"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { logout } from "@/lib/auth/logout-action";
import { resetAnalytics } from "@/lib/monitoring/analytics";
import { routes } from "@/lib/routes";

/**
 * Logout with a confirmation (spec §5.8), then Welcome. Forgets the
 * analytics user too, because crew phones are shared.
 */
export function LogoutButton({ children }: { children: ReactNode }) {
  const t = useTranslations("Profile");
  const [pending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      await logout();
      resetAnalytics();
      // A full page load, not a client navigation: nothing from this
      // account (kept pages, typed values, router cache) survives on a
      // shared phone.
      window.location.assign(routes.welcome);
    });

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent title={t("logoutTitle")} description={t("logoutBody")}>
        <div className="flex flex-col gap-2">
          <Button onClick={confirm} loading={pending} className="bg-danger">
            {t("logoutConfirm")}
          </Button>
          <SheetClose asChild>
            <Button variant="secondary" disabled={pending}>
              {t("logoutCancel")}
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
