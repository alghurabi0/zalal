import { Truck } from "lucide-react";

import { cn } from "@/lib/cn";

// The two pins from Tracking.dc.html, used on the drawn map and as Google
// Maps markers: the home (navy drop with an aqua house) and the crew (navy
// circle with an aqua truck).

/** The home pin, tip at its bottom center, with the aqua halo around the tip. */
export function HomePin({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("relative block h-11.5 w-9", className)}>
      <span className="absolute start-1/2 top-full size-15 -translate-y-1/2 rounded-full bg-aqua/20 ltr:-translate-x-1/2 rtl:translate-x-1/2" />
      <svg viewBox="0 0 36 46" className="relative size-full">
        <path
          d="M18 2C9 2 2 9 2 18c0 12 16 26 16 26s16-14 16-26C34 9 27 2 18 2z"
          className="fill-navy"
        />
        <path d="M11 18l7-6 7 6v7H11z" className="fill-aqua" />
      </svg>
    </span>
  );
}

/** The crew pin, centered on the crew's position. Faded when the position is old. */
export function CrewPin({ stale = false, className }: { stale?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 items-center justify-center rounded-full border-3 border-white bg-navy shadow-pin",
        stale && "opacity-60",
        className,
      )}
    >
      <Truck className="size-5 text-aqua" strokeWidth={2.2} />
    </span>
  );
}
