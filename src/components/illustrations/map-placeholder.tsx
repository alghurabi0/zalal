import { cn } from "@/lib/cn";

/**
 * The drawn map from Location.dc.html: blocks, a park, streets and a river.
 * Shown when there's no Google Maps key (local, CI) and behind the real map
 * while it loads. It fills its box and crops, like a map would.
 */
export function MapPlaceholder({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 390 420"
      preserveAspectRatio="xMidYMid slice"
      className={cn("size-full", className)}
    >
      <rect width="390" height="420" fill="#E8EEF3" />
      <rect x="20" y="40" width="110" height="80" rx="6" fill="#DCE5EC" />
      <rect x="160" y="30" width="90" height="100" rx="6" fill="#DCE5EC" />
      <rect x="280" y="50" width="100" height="70" rx="6" fill="#DCE5EC" />
      <rect x="30" y="180" width="100" height="90" rx="6" fill="#DCE5EC" />
      <rect x="250" y="190" width="120" height="80" rx="6" fill="#D4EDDA" />
      <rect x="40" y="320" width="120" height="80" rx="6" fill="#DCE5EC" />
      <path d="M-10 150 L400 140" stroke="#FFFFFF" strokeWidth="22" />
      <path d="M145 -10 L170 430" stroke="#FFFFFF" strokeWidth="16" />
      <path d="M-10 300 L400 290" stroke="#FFFFFF" strokeWidth="14" />
      <path d="M270 -10 L230 430" stroke="#FFFFFF" strokeWidth="12" />
      <path d="M300 300 C330 340 360 360 400 370" stroke="#BFE3F2" strokeWidth="18" fill="none" />
    </svg>
  );
}
