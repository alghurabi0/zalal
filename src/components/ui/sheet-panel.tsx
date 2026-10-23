import { type ReactNode, useId } from "react";

import { cn } from "@/lib/cn";

/** The grab handle at the top of a sheet. Decorative: there is no drag. */
export function SheetHandle() {
  return <div aria-hidden className="h-1 w-10 shrink-0 self-center rounded-full bg-track" />;
}

type SheetPanelProps = {
  /** Heading of the panel; Location uses the page's h1 here. */
  title?: ReactNode;
  titleAs?: "h1" | "h2";
  description?: ReactNode;
  className?: string;
  children: ReactNode;
};

/**
 * A bottom sheet that is part of the page, not a dialog: the panel under
 * the map on Location and Tracking. Place it at the bottom of the screen
 * (e.g. `absolute inset-x-0 bottom-0`).
 */
export function SheetPanel({
  title,
  titleAs: Title = "h2",
  description,
  className,
  children,
}: SheetPanelProps) {
  const titleId = useId();

  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-t-sheet bg-surface px-5 pt-3.5 pb-safe-6 text-navy shadow-sheet",
        className,
      )}
    >
      <SheetHandle />
      {title && (
        <div className="flex flex-col">
          <Title id={titleId} className="text-20 font-black">
            {title}
          </Title>
          {description && <span className="text-14 text-muted">{description}</span>}
        </div>
      )}
      {children}
    </section>
  );
}
