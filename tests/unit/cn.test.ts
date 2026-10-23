import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { cn, themeScales } from "@/lib/cn";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Token names declared in globals.css for a theme namespace, e.g. "text". */
function tokens(namespace: string): string[] {
  const names = [...css.matchAll(new RegExp(`--${namespace}-([\\w-]+):`, "g"))].map((m) => m[1]);
  return [...new Set(names)].filter((n): n is string => !!n && !n.includes("--"));
}

describe("cn()", () => {
  it.each([
    ["text", themeScales.text],
    ["radius", themeScales.radius],
    ["leading", themeScales.leading],
    ["tracking", themeScales.tracking],
    ["shadow", themeScales.shadow],
    ["container", themeScales.container],
  ])("knows every --%s-* token in globals.css", (namespace, listed) => {
    expect([...listed].sort()).toEqual(tokens(namespace).sort());
  });

  it("keeps a font size next to a text color", () => {
    expect(cn("text-15", "text-navy")).toBe("text-15 text-navy");
  });

  it("lets a later font size, color, radius or shadow win", () => {
    expect(cn("text-15 text-navy", "text-18 text-white")).toBe("text-18 text-white");
    expect(cn("rounded-card", "rounded-20")).toBe("rounded-20");
    expect(cn("rounded-input", "rounded-button")).toBe("rounded-button");
    expect(cn("shadow-card", "shadow-float")).toBe("shadow-float");
  });

  it("keeps a line height when a font size follows it", () => {
    expect(cn("leading-tight", "text-15")).toBe("leading-tight text-15");
  });

  it("drops falsy values", () => {
    expect(cn("flex", false, null, undefined, "gap-2")).toBe("flex gap-2");
  });
});
