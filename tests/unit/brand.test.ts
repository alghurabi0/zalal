import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { brandColors } from "@/lib/brand";

const css = readFileSync("src/app/globals.css", "utf8");

describe("brandColors", () => {
  it.each(Object.entries(brandColors))("%s equals its globals.css token", (name, hex) => {
    const token = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
    expect(token?.toLowerCase()).toBe(hex);
  });
});
