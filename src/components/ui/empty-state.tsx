import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Centered icon, title, text and call to action. Used for empty lists,
 * error states and full-screen results. Styled after Issue's success
 * state (Issue.dc.html).
 */
export type EmptyStateTone = "neutral" | "success" | "danger";

const toneClasses: Record<EmptyStateTone, string> = {
  neutral: "bg-selected text-teal",
  success: "bg-ok-bg text-ok-fg",
  danger: "bg-well text-danger",
};

type EmptyStateProps = {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons under the text; stretched to full width. */
  action?: ReactNode;
  tone?: EmptyStateTone;
  /** h1 when the state is the whole screen (24px), else h2 (20px). */
  titleAs?: "h1" | "h2";
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "neutral",
  titleAs: Title = "h2",
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3.5 px-8 py-10 text-center", className)}>
      <span
        className={cn("flex size-22 items-center justify-center rounded-full", toneClasses[tone])}
      >
        <Icon aria-hidden className="size-11" strokeWidth={2.4} />
      </span>
      <Title className={cn("font-black", Title === "h1" ? "text-24" : "text-20")}>{title}</Title>
      {description && <p className="text-16 text-muted">{description}</p>}
      {action && <div className="flex w-full flex-col items-center gap-1">{action}</div>}
    </div>
  );
}
