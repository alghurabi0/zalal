import { useTranslations } from "next-intl";

import type { ArticleStatus } from "@/lib/admin/content-queries";
import { cn } from "@/lib/cn";

/** منشور (green) or مسودة (grey), as the other admin status badges. */
export function ArticleStatusBadge({ status }: { status: ArticleStatus }) {
  const t = useTranslations("Admin.content.status");
  return (
    <span
      className={cn(
        "rounded-10 px-2 py-0.5 text-12 font-extrabold whitespace-nowrap",
        status === "published" ? "bg-ok-bg text-ok-fg" : "bg-well text-muted",
      )}
    >
      {t(status)}
    </span>
  );
}
