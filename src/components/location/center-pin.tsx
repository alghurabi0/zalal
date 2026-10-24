import { cn } from "@/lib/cn";

/**
 * The fixed pin over the map's center (Location.dc.html): the map moves
 * under it. Its tip sits exactly on the center point, with the aqua halo
 * around it.
 */
export function CenterPin({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 flex items-center justify-center",
        className,
      )}
    >
      <span className="absolute size-23 rounded-full bg-aqua/18" />
      {/* 46px tall with the tip at its bottom: lift it by its height. */}
      <svg viewBox="0 0 36 46" className="relative h-11.5 w-9 -translate-y-1/2">
        <path
          d="M18 2C9 2 2 9 2 18c0 12 16 26 16 26s16-14 16-26C34 9 27 2 18 2z"
          className="fill-navy"
        />
        <circle cx="18" cy="18" r="6" className="fill-aqua" />
      </svg>
    </div>
  );
}
