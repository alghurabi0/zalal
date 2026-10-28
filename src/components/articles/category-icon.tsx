import { CircleHelp, Droplet, Lightbulb, type LucideProps, ShieldCheck, Sun } from "lucide-react";
import type { ComponentType } from "react";

import { TankLidIcon } from "@/components/icons/tank-icons";
import type { Database } from "@/lib/database.types";

export type CategoryIcon = Database["public"]["Enums"]["category_icon"];

/** The category icons A11 offers, in its picker's order. */
export const CATEGORY_ICONS = [
  "droplet",
  "sun",
  "lid",
  "lightbulb",
  "help",
  "shield",
] as const satisfies readonly CategoryIcon[];

/**
 * A category's glyph (Tips.dc.html: a drop for صحة, a sun for الصيف, a tank
 * lid for نصائح). The rest are for categories admins add in A11.
 */
const icons: Record<CategoryIcon, ComponentType<Omit<LucideProps, "ref">>> = {
  droplet: Droplet,
  sun: Sun,
  lid: TankLidIcon,
  lightbulb: Lightbulb,
  help: CircleHelp,
  shield: ShieldCheck,
};

export function CategoryGlyph({ icon, className }: { icon: CategoryIcon; className?: string }) {
  const Icon = icons[icon];
  return <Icon aria-hidden className={className} strokeWidth={2} />;
}
