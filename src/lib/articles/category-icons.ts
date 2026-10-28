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
