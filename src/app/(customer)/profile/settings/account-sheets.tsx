"use client";

import { LogOut, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { clearMediaQueue } from "@/lib/crew/use-media-queue";
import { resetAnalytics } from "@/lib/monitoring/analytics";
import { forgetPush } from "@/lib/push/client";
import { routes } from "@/lib/routes";

import { deleteMyAccount, logoutEverywhere } from "./actions";

/** Forgets this browser (analytics, push, the crew queue), as logout does. */
async function forgetBrowser() {
  await Promise.all([resetAnalytics(), clearMediaQueue().catch(() => undefined), forgetPush()]);
}

/** A full page load, so nothing from the account survives in this tab. */
function leave() {
  window.location.assign(routes.welcome);
}

const rowClasses = "flex min-h-14 w-full items-center gap-3 px-4 text-start text-17 font-extrabold";

/** N13's "سجّل خروج من كل الأجهزة", with a confirmation. */
export function LogoutEverywhere() {
  const t = useTranslations("Settings");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const confirm = async () => {
    setPending(true);
    setFailed(false);
    await forgetBrowser();
    const { ok } = await logoutEverywhere();
    if (ok) return leave();
    setPending(false);
    setFailed(true);
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button type="button" className={rowClasses}>
          <LogOut
            aria-hidden
            className="size-6 shrink-0 text-teal rtl:-scale-x-100"
            strokeWidth={2}
          />
          {t("logoutEverywhere")}
        </button>
      </SheetTrigger>
      <SheetContent title={t("logoutEverywhereTitle")} description={t("logoutEverywhereBody")}>
        <div className="flex flex-col gap-2">
          {failed && (
            <p role="alert" className="text-center text-14 font-bold text-danger">
              {t("failed")}
            </p>
          )}
          <Button onClick={() => void confirm()} loading={pending} className="bg-danger">
            {t("logoutEverywhereConfirm")}
          </Button>
          <SheetClose asChild>
            <Button variant="secondary" disabled={pending}>
              {t("cancel")}
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * N13's "احذف حسابي" (spec §7 "Account deletion"): what goes and what stays,
 * then a second confirmation. Refused while an order is open (ZL039), known
 * when the page loaded and again from the server.
 */
export function DeleteAccount({ hasOpenOrders }: { hasOpenOrders: boolean }) {
  const t = useTranslations("Settings");
  const [sure, setSure] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"open_orders" | "failed" | null>(
    hasOpenOrders ? "open_orders" : null,
  );

  const confirm = async () => {
    setPending(true);
    const result = await deleteMyAccount();
    if (result.ok) {
      await forgetBrowser();
      return leave();
    }
    setPending(false);
    setError(result.reason);
  };

  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) {
          setSure(false);
          if (error === "failed") setError(null);
        }
      }}
    >
      <SheetTrigger asChild>
        <button type="button" className={`${rowClasses} text-danger`}>
          <Trash2 aria-hidden className="size-6 shrink-0" strokeWidth={2} />
          {t("deleteAccount")}
        </button>
      </SheetTrigger>
      <SheetContent title={t("deleteTitle")} description={t("deleteBody")}>
        <div className="flex flex-col gap-2">
          {error === "open_orders" ? (
            <>
              <p role="alert" className="text-15 font-bold text-danger">
                {t("openOrders")}
              </p>
              <SheetClose asChild>
                <Button href={routes.orders}>{t("toOrders")}</Button>
              </SheetClose>
            </>
          ) : sure ? (
            <>
              <p className="text-15 font-bold">{t("deleteSure")}</p>
              {error === "failed" && (
                <p role="alert" className="text-center text-14 font-bold text-danger">
                  {t("failed")}
                </p>
              )}
              <Button onClick={() => void confirm()} loading={pending} className="bg-danger">
                {t("deleteConfirm")}
              </Button>
            </>
          ) : (
            <Button onClick={() => setSure(true)} className="bg-danger">
              {t("deleteContinue")}
            </Button>
          )}
          <SheetClose asChild>
            <Button variant="secondary" disabled={pending}>
              {t("cancel")}
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
