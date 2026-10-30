import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../messages/ar.json";

// manifest.ts reads its strings with getTranslations, which needs the Next.js
// request context. Give it the same messages directly.
vi.mock("next-intl/server", () => ({
  getRequestConfig: (config: unknown) => config,
  getTranslations: async ({ namespace }: { namespace: "Metadata" }) =>
    createTranslator({ locale: "ar", messages, namespace }),
}));

const { default: manifest } = await import("@/app/manifest");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string) {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("web app manifest", () => {
  it("installs as an Arabic, right-to-left, standalone app named زلال", async () => {
    const m = await manifest();

    expect(m).toMatchObject({
      name: messages.Metadata.title,
      short_name: messages.Metadata.title,
      description: messages.Metadata.description,
      lang: "ar",
      dir: "rtl",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#0a2a5e",
      theme_color: "#0a2a5e",
    });
  });

  it("lists 192 and 512 icons and a 512 maskable icon", async () => {
    const icons = (await manifest()).icons ?? [];

    expect(icons.map((i) => `${i.sizes} ${i.purpose}`).sort()).toEqual([
      "192x192 any",
      "512x512 any",
      "512x512 maskable",
    ]);
  });

  it("points every icon at a PNG of the declared size", async () => {
    for (const icon of (await manifest()).icons ?? []) {
      expect(icon.type).toBe("image/png");
      expect(pngSize(join("public", icon.src))).toBe(icon.sizes);
    }
  });

  it("has a 180px Apple touch icon", () => {
    expect(pngSize("src/app/apple-icon.png")).toBe("180x180");
  });
});
