import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * An admin page's frame: a wide column (desktop-first, spec §8.2) with the
 * page title and its actions on one row.
 */
export function AdminPage({
  title,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main className={cn("mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 lg:p-8", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-24 font-black">{title}</h1>
        {actions}
      </div>
      {children}
    </main>
  );
}
