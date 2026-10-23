import { cn } from "@/lib/cn";

/** The three waves at the bottom of Welcome (Main.dc.html). */
export function WelcomeWaves({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 390 300"
      preserveAspectRatio="none"
      className={cn("h-75 w-full", className)}
    >
      <path d="M0 90 q48 -40 97 0 t97 0 t98 0 t98 0 V300 H0Z" className="fill-navy-2" />
      <path d="M0 150 q48 -40 97 0 t97 0 t98 0 t98 0 V300 H0Z" className="fill-navy-3/70" />
      <path d="M0 210 q48 -40 97 0 t97 0 t98 0 t98 0 V300 H0Z" className="fill-aqua/25" />
    </svg>
  );
}
