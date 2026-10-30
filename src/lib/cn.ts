import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design tokens from globals.css, by tailwind-merge theme scale.
 * tests/unit/cn.test.ts checks that these lists match the @theme block.
 */
export const themeScales = {
  text: ["11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "22", "24", "26", "28", "44"],
  radius: ["chip", "input", "button", "card", "sheet", "4", "8", "10", "20", "30"],
  leading: ["display", "tight", "snug", "normal", "relaxed", "body"],
  tracking: ["phone"],
  shadow: ["card", "float", "sheet", "fab", "pin", "segment", "knob", "logo"],
  container: ["phone"],
};

const twMerge = extendTailwindMerge({
  override: {
    // Without these, tailwind-merge reads `text-15` as a color (and drops it
    // next to `text-navy`) and doesn't know our radius or shadow names.
    theme: themeScales,
    // Font sizes here don't set a line height, so `text-15` must not remove
    // an earlier `leading-tight`.
    conflictingClassGroups: { "font-size": [] },
  },
});

type ClassValue = string | false | null | undefined;

/**
 * Joins class names and resolves conflicts: a later class wins over an
 * earlier one for the same property, so a screen can override a kit
 * component's default (`cn("rounded-card", className)`).
 */
export function cn(...classes: ClassValue[]): string {
  return twMerge(...classes);
}
