"use client";

import { CloudUpload } from "lucide-react";
import { useTranslations } from "next-intl";

import { isPending } from "@/lib/crew/media-queue";

import { useCrewMedia } from "./use-crew-media";

// My jobs (C2): how many of the crew's photos and clips are still on this
// phone. Mounting either also keeps the queue sending from this screen.

/** On a job's card. */
export function QueuedCount({ userId, orderId }: { userId: string; orderId: string }) {
  const t = useTranslations("Crew");
  const count = useCrewMedia(userId).filter(
    (item) => item.orderId === orderId && isPending(item),
  ).length;
  if (count === 0) return null;
  return (
    <p className="flex items-center gap-1.5 text-13 font-bold text-warn-fg">
      <CloudUpload aria-hidden className="size-4" />
      {t("queued", { count })}
    </p>
  );
}

/** In the logout sheet: these files are deleted from the phone on logout. */
export function QueuedLogoutWarning({ userId }: { userId: string }) {
  const t = useTranslations("Crew");
  const count = useCrewMedia(userId).filter(isPending).length;
  if (count === 0) return null;
  return (
    <p role="alert" className="rounded-chip bg-warn-bg px-3 py-2 text-14 font-bold text-warn-fg">
      {t("logoutPending", { count })}
    </p>
  );
}
