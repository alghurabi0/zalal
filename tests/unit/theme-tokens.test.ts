import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every color token from spec §4. The brand blues and `sun` follow the logo
// (spec §4 "Brand colors"); the rest are the hex the canvas uses.
const SPEC_COLORS: Record<string, string> = {
  navy: "#0A2A5E",
  "navy-2": "#0F3874",
  "navy-3": "#0D50AE",
  aqua: "#4BB4F2",
  "aqua-soft": "#9AD3F8",
  teal: "#1565C0",
  bg: "#F4F7FB",
  surface: "#FFFFFF",
  border: "#E3EAF2",
  track: "#D3DCE6",
  muted: "#52627A",
  "body-2": "#34455C",
  "on-dark-muted": "#9FBCDD",
  selected: "#E8F3FD",
  disabled: "#C9D3E0",
  sun: "#FFAA00",
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
  dashed: "#8FB2D6",
  "chip-border": "#BFDCF5",
  "control-off": "#9AA9BC",
  "otp-filled": "#9FB3C8",
  well: "#F1F5F9",
  "on-dark-body": "#C9D8EA",
  // WhatsApp's teal green, for its glyph on the support buttons (Oct 30, 2026).
  whatsapp: "#128C7E",
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

/** WCAG 2.x contrast ratio of two #RRGGBB colors. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// Text on background pairs the screens use (Phase 6, task 4 audit). Each
// must reach WCAG AA for normal text, 4.5:1, so a token change can't break
// it silently. Below 3:1 and kept as drawn in the canvas (non-text only):
// `border` around inputs and cards, `dashed`, `otp-filled`, `control-off`
// chevrons and `star` icons (spec §4 "Contrast").
const TEXT_PAIRS: [text: string, background: string][] = [
  ["navy", "bg"],
  ["navy", "surface"],
  ["navy", "selected"],
  ["navy", "aqua"],
  ["navy", "warn"],
  ["navy", "sun"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["muted", "selected"],
  ["muted", "well"],
  ["muted", "map-bg"],
  ["body-2", "bg"],
  ["body-2", "surface"],
  ["teal", "bg"],
  ["teal", "surface"],
  ["teal", "selected"],
  ["ok-fg", "ok-bg"],
  ["ok-fg", "surface"],
  ["warn-fg", "warn-bg"],
  ["warn-icon", "warn-bg"],
  ["warn-icon", "surface"],
  ["warn-strong", "warn-bg"],
  ["danger", "surface"],
  ["danger", "bg"],
  ["live", "surface"],
  ["aqua", "navy"],
  ["aqua", "navy-2"],
  ["on-dark-muted", "navy"],
  ["on-dark-muted", "navy-2"],
  ["on-dark-body", "navy"],
  ["on-dark-body", "navy-2"],
  ["white", "navy"],
  ["white", "navy-3"],
  ["white", "teal"],
  ["white", "danger"],
];

// Icons the screens draw in a color no text uses: WCAG 1.4.11, 3:1.
const ICON_PAIRS: [icon: string, background: string][] = [
  ["whatsapp", "bg"],
  ["whatsapp", "surface"],
];

describe("text contrast (WCAG AA)", () => {
  const hex = (name: string) => (name === "white" ? "#FFFFFF" : SPEC_COLORS[name]!);
  it.each(TEXT_PAIRS)("%s on %s reaches 4.5:1", (text, background) => {
    expect(contrast(hex(text), hex(background))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(ICON_PAIRS)("%s icons on %s reach 3:1", (icon, background) => {
    expect(contrast(hex(icon), hex(background))).toBeGreaterThanOrEqual(3);
  });
});
