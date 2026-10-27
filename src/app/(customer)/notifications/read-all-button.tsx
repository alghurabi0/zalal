"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { markAllNotificationsRead } from "./actions";

/** "قراءة الكل": marks every notification read, then shows the list again. */
export function ReadAllButton() {
  const t = useTranslations("Notifications");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markAllNotificationsRead();
          router.refresh();
        })
      }
      className="min-h-11 rounded-chip px-2.5 text-14 font-bold text-teal focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-50"
    >
      {t("readAll")}
    </button>
  );
}
