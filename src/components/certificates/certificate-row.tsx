import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** A label and value row of the certificate card (Report, N15), inside a <dl>. */
export function CertificateRow({
  label,
  last = false,
  children,
}: {
  label: string;
  /** The last row has no divider under it. */
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-10 items-center justify-between gap-3 py-1.5",
        !last && "border-b border-divider",
      )}
    >
      <dt className="shrink-0 text-13 text-muted">{label}</dt>
      <dd className="text-end text-14 font-extrabold">{children}</dd>
    </div>
  );
}
