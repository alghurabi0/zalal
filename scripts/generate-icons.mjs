// Generates the PWA icons and favicons from the logo mark.
// Run with `pnpm icons` after changing public/brand/logo.svg, then commit
// the output. Sizes and layout follow docs/spec.md §4 (Logo).
//
// Source:  public/brand/logo.svg (the three-wave mark from Main.dc.html)
// Output:  public/brand/logo-tile.svg   the rounded navy-2 tile from Welcome
//          src/app/icon.svg             favicon (same tile)
//          src/app/apple-icon.png       180, full bleed (iOS rounds it)
//          public/icons/icon-192.png    rounded tile, purpose "any"
//          public/icons/icon-512.png    rounded tile, purpose "any"
//          public/icons/icon-maskable-512.png  full bleed, mark in the safe zone
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(root + path, "utf8");
const write = (path, data) => {
  writeFileSync(root + path, data);
  console.log(`wrote ${path}`);
};

// The tile color is a design token; read it from globals.css so there is
// one source for it.
const css = read("src/app/globals.css");
const tileColor = css.match(/--color-navy-2:\s*(#[0-9a-f]{6})/i)?.[1];
if (!tileColor) throw new Error("--color-navy-2 not found in globals.css");

const logo = read("public/brand/logo.svg");
const viewBox = logo.match(/viewBox="0 0 (\d+) (\d+)"/);
if (!viewBox) throw new Error("logo.svg needs a viewBox of the form 0 0 W H");
const markWidth = Number(viewBox[1]);
const markHeight = Number(viewBox[2]);

// Welcome draws a 112px tile with a 30px radius and a 74px-wide mark.
const TILE = 112;
const TILE_RADIUS = 30 / TILE;
const TILE_MARK = 74 / TILE;
// Maskable icons are cropped to a circle of 80% of the size. Keep the whole
// mark viewBox inside it: half its diagonal is 0.64 × its width, so a width of
// 0.6 × size (half-diagonal 0.384) leaves a small margin inside 0.4.
const MASKABLE_MARK = 0.6;

/** An SVG of `size` px with the mark centered at `markRatio` of the width. */
function iconSvg(size, { radius, markRatio }) {
  const width = size * markRatio;
  const height = (width * markHeight) / markWidth;
  const mark = logo
    .replace("<svg ", `<svg x="${(size - width) / 2}" y="${(size - height) / 2}" `)
    .replace(/viewBox=/, `width="${width}" height="${height}" viewBox=`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${tileColor}"/>` +
    mark.replace(' xmlns="http://www.w3.org/2000/svg"', "") +
    `</svg>\n`
  );
}

const png = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

const tile = iconSvg(TILE, { radius: TILE_RADIUS, markRatio: TILE_MARK });
write("public/brand/logo-tile.svg", tile);
write("src/app/icon.svg", tile);

for (const size of [192, 512]) {
  const svg = iconSvg(size, { radius: TILE_RADIUS, markRatio: TILE_MARK });
  write(`public/icons/icon-${size}.png`, await png(svg));
}

write(
  "public/icons/icon-maskable-512.png",
  await png(iconSvg(512, { radius: 0, markRatio: MASKABLE_MARK })),
);

write("src/app/apple-icon.png", await png(iconSvg(180, { radius: 0, markRatio: TILE_MARK })));
