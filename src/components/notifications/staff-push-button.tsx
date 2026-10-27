"use client";

import { Bell, BellOff, BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { enablePush, type PushState, pushState } from "@/lib/push/client";

import { IosInstallSteps } from "./ios-install-steps";

/**
 * Push for staff on this device (spec §9.2): admins get new bookings,
 * customer messages and tickets, crews their new and changed jobs. Staff
 * never see Booking success, so the admin shell and the crew's header offer
 * it here. `tone` matches the bar it sits on.
 */
export function StaffPushButton({
  tone = "dark",
  className,
}: {
  tone?: "dark" | "light";
  className?: string;
}) {
  const t = useTranslations("Notifications.push");
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void pushState().then((value) => {
      if (live) setState(value);
    });
    return () => {
      live = false;
    };
  }, []);

  if (state === "loading" || state === "unsupported") return null;

  const classes = cn(
    "flex min-h-11 items-center gap-2 rounded-chip px-3 text-14 font-bold focus-visible:outline-2",
    tone === "dark"
      ? "text-on-dark-body focus-visible:outline-aqua"
      : "text-teal focus-visible:outline-teal",
    className,
  );

  if (state === "subscribed") {
    return (
      <p className={classes}>
        <BellRing aria-hidden className="size-5 shrink-0" />
        {t("staffOn")}
      </p>
    );
  }
  if (state === "denied") {
    return (
      <p className={cn(classes, "opacity-80")}>
        <BellOff aria-hidden className="size-5 shrink-0" />
        {t("staffDenied")}
      </p>
    );
  }
  if (state === "install") {
    return (
      <Sheet>
        <SheetTrigger asChild>
          <button type="button" className={classes}>
            <Bell aria-hidden className="size-5 shrink-0" />
            {t("staffEnable")}
          </button>
        </SheetTrigger>
        <SheetContent title={t("iosTitle")} description={t("iosBody")}>
          <IosInstallSteps />
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await enablePush();
        setBusy(false);
        setState(
          result === "subscribed" ? "subscribed" : result === "denied" ? "denied" : "default",
        );
      }}
      className={cn(classes, "disabled:opacity-50")}
    >
      <Bell aria-hidden className="size-5 shrink-0" />
      {t("staffEnable")}
    </button>
  );
}
