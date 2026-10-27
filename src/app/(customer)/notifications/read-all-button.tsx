"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { markAllNotificationsRead } from "./actions";

/**
 * "قراءة الكل": marks every notification read, then shows the list again.
 * A failure (offline, an error) says so under the header.
 */
export function ReadAllButton() {
  const t = useTranslations("Notifications");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await markAllNotificationsRead().catch(() => ({ ok: false }));
            setFailed(!result.ok);
            if (result.ok) router.refresh();
          })
        }
        className="min-h-11 rounded-chip px-2.5 text-14 font-bold text-teal focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-50"
      >
        {t("readAll")}
      </button>
      {failed && (
        <p role="alert" className="basis-full text-13 text-danger">
          {t("readAllFailed")}
        </p>
      )}
    </>
  );
}
