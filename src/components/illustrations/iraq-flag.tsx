import { cn } from "@/lib/cn";

/** The small Iraqi flag in Login's country-code box (Login.dc.html): three bands, 3px corners. */
export function IraqFlag({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 22 15" className={cn("h-3.75 w-5.5 shrink-0", className)}>
      <clipPath id="iraq-flag-corners">
        <rect width="22" height="15" rx="3" />
      </clipPath>
      <g clipPath="url(#iraq-flag-corners)">
        <rect width="22" height="5" fill="#CE1126" />
        <rect y="5" width="22" height="5" fill="#FFFFFF" />
        <rect y="10" width="22" height="5" fill="#000000" />
      </g>
    </svg>
  );
}
