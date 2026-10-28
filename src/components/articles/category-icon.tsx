import { CircleHelp, Droplet, Lightbulb, type LucideProps, ShieldCheck, Sun } from "lucide-react";
import type { ComponentType } from "react";

import { TankLidIcon } from "@/components/icons/tank-icons";
import type { CategoryIcon } from "@/lib/articles/category-icons";

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
