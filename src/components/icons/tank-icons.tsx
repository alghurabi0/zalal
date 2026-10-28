import type { SVGProps } from "react";

// The two tank glyphs from Booking.dc.html. lucide has no water tank, so
// these are drawn on the same 24px grid with round caps, like lucide icons.

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function TankIcon({ d, strokeWidth = 1.8, ...props }: IconProps & { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d={d} />
    </svg>
  );
}

/** Roof tank (خزان سطح). */
export function RoofTankIcon(props: IconProps) {
  return <TankIcon d="M6 8h12v12H6zM9 5h6v3H9zM6 15q3 -2 6 0t6 0" {...props} />;
}

/** Ground tank (خزان أرضي). */
export function GroundTankIcon(props: IconProps) {
  return <TankIcon d="M3 10h18M5 10v10h14V10M9 14q1.5 -1 3 0t3 0M10 6h4v4h-4z" {...props} />;
}

/** Tank lid, the نصائح tile in Tips.dc.html. */
export function TankLidIcon(props: IconProps) {
  return <TankIcon d="M4 10h16M6 10V7a6 3 0 0 1 12 0v3M5 10v9h14v-9" strokeWidth={2} {...props} />;
}
