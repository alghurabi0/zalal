import { encode } from "uqr";

import { cn } from "@/lib/cn";

/**
 * A QR code drawn as one SVG path in the navy token (the certificate's
 * verification link, spec §10.1). Error correction M survives a creased or
 * smudged print. Server-rendered: no script in the page.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { data, size } = encode(value, { ecc: "M", border: 2 });
  const path = data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : "")))
    .join("");
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn("bg-white", className)}
    >
      <path d={path} className="fill-navy" />
    </svg>
  );
}
