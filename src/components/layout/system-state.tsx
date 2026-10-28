import type { LucideIcon } from "lucide-react";
import { Phone } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { formatPhone } from "@/lib/phone";

/**
 * N16's full-screen states (out of area, force update, maintenance): an icon
 * on a soft tile, the title and text, the company's support phone (tap to
 * call; hidden while A13 has none) and the screen's action.
 */
export function SystemState({
  icon: Icon,
  title,
  body,
  phone,
  callLabel,
  action,
  className,
  titleId,
}: {
  icon: LucideIcon;
  title: string;
  /** For a dialog that names itself by the title. */
  titleId?: string;
  body: string;
  /** settings.company_phone (E.164), or null while unset. */
  phone: string | null;
  callLabel: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex min-h-dvh w-full max-w-phone flex-col items-center justify-center gap-5 bg-bg px-6 pt-10 pb-safe-8 text-center",
        className,
      )}
    >
      <span className="flex size-24 items-center justify-center rounded-full bg-selected text-teal">
        <Icon aria-hidden className="size-11" strokeWidth={1.8} />
      </span>
      <div className="flex flex-col gap-2">
        <h1 id={titleId} className="text-24 font-black">
          {title}
        </h1>
        <p className="text-16 text-muted">{body}</p>
      </div>
      {phone && (
        <a
          href={`tel:${phone}`}
          className="flex min-h-11 items-center gap-2 text-16 font-extrabold text-teal"
        >
          <Phone aria-hidden className="size-5" strokeWidth={2} />
          {callLabel}
          <span dir="ltr">{formatPhone(phone)}</span>
        </a>
      )}
      {action && <div className="flex w-full flex-col gap-2 pt-2">{action}</div>}
    </div>
  );
}
