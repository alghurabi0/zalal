import { cn } from "@/lib/cn";

/** The three-wave mark from public/brand/logo.svg, stroked in `className`'s stroke color. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 80"
      fill="none"
      strokeLinecap="round"
      strokeWidth="9"
      className={cn("stroke-aqua", className)}
    >
      <path d="M8 18 q10.5 -10 21 0 t21 0 t21 0 t21 0" />
      <path d="M8 40 q10.5 -10 21 0 t21 0 t21 0 t21 0" strokeOpacity="0.7" />
      <path d="M8 62 q10.5 -10 21 0 t21 0 t21 0 t21 0" strokeOpacity="0.4" />
    </svg>
  );
}
