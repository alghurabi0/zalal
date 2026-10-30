import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * The logo from public/brand/logo.svg: the sun over "Zalal", in its own
 * colors. Decorative; the tile around it carries the label. Size it with
 * a width class; the height follows.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/logo.svg"
      alt=""
      aria-hidden
      width={705}
      height={472}
      className={cn("h-auto", className)}
    />
  );
}
