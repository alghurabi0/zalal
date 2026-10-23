import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every color token from spec §4, with the hex the canvas uses.
const SPEC_COLORS: Record<string, string> = {
  navy: "#0B2545",
  "navy-2": "#13315C",
  "navy-3": "#1B4A7A",
  aqua: "#4CC9F0",
  "aqua-soft": "#8FE0F5",
  teal: "#0A6E8F",
  bg: "#F4F7FB",
  surface: "#FFFFFF",
  border: "#E3EAF2",
  track: "#D3DCE6",
  muted: "#52627A",
  "body-2": "#34455C",
  "on-dark-muted": "#9FB8D3",
  selected: "#E6F7FD",
  disabled: "#C9D3E0",
  "warn-bg": "#FEF3C7",
  "warn-fg": "#92400E",
  warn: "#F59E0B",
  "ok-bg": "#DCFCE7",
  "ok-fg": "#15803D",
  ok: "#16A34A",
  "map-bg": "#E8EEF3",
  // Colors the canvas uses that the first table missed (spec §4).
  danger: "#B42318",
  live: "#DC2626",
  divider: "#EEF2F7",
  "warn-icon": "#B45309",
  "warn-strong": "#78350F",
  star: "#D97706",
  dashed: "#8FB6CC",
  "chip-border": "#BFE6F5",
  "control-off": "#9AA9BC",
  "otp-filled": "#9FB3C8",
  well: "#F1F5F9",
  "on-dark-body": "#C9D8EA",
};

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** All custom properties declared inside `@theme` blocks. */
function themeVars(source: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const block of source.matchAll(/@theme(?:\s+inline)?\s*\{([^}]*)\}/g)) {
    const body = block[1] ?? "";
    for (const decl of body.matchAll(/(--[\w-]+(?:\*)?)\s*:\s*([^;]+);/g)) {
      const [, name, value] = decl;
      if (name && value) vars.set(name, value.trim());
    }
  }
  return vars;
}

const vars = themeVars(css);

describe("theme tokens (spec §4)", () => {
  it.each(Object.entries(SPEC_COLORS))("defines --color-%s as %s", (name, hex) => {
    expect(vars.get(`--color-${name}`)?.toUpperCase()).toBe(hex);
  });

  it("removes Tailwind's default palette so only design colors exist", () => {
    expect(vars.get("--color-*")).toBe("initial");
  });

  it("defines no colors beyond the spec, except white and black for opacity overlays", () => {
    const extra = [...vars.keys()]
      .filter((k) => k.startsWith("--color-") && k !== "--color-*")
      .map((k) => k.slice("--color-".length))
      .filter((k) => !(k in SPEC_COLORS));
    expect(extra.sort()).toEqual(["black", "white"]);
  });

  it.each([
    ["chip", "12px"],
    ["input", "14px"],
    ["button", "16px"],
    ["card", "18px"],
    ["sheet", "26px"],
  ])("defines the role radius --radius-%s as %s", (name, value) => {
    expect(vars.get(`--radius-${name}`)).toBe(value);
  });

  it("uses Cairo as the sans font", () => {
    expect(vars.get("--font-sans")).toMatch(/^var\(--font-cairo\)/);
  });

  it("keeps hex colors out of everything but the @theme block", () => {
    const outsideTheme = css.replace(/@theme(?:\s+inline)?\s*\{[^}]*\}/g, "");
    expect(outsideTheme).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
