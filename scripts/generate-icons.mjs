// Generates the PWA icons and favicons from the logo.
// Run with `pnpm icons` after changing public/brand/logo.svg, then commit
// the output. Sizes and layout follow docs/spec.md §4 (Logo).
//
// Source:  public/brand/logo.svg (the full-color logo: the sun over "Zalal")
// Output:  public/brand/logo-tile.svg   the logo on a rounded white tile
//          src/app/icon.svg             favicon (same tile)
//          src/app/apple-icon.png       180, full bleed (iOS rounds it)
//          public/icons/icon-192.png    rounded tile, purpose "any"
//          public/icons/icon-512.png    rounded tile, purpose "any"
//          public/icons/icon-maskable-512.png  full bleed, logo in the safe zone
//          public/icons/badge-96.png    the logo alone, one color on transparent:
//                                       Android's status-bar glyph for push
//                                       notifications (only its alpha counts)
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
const tileColor = css.match(/--color-surface:\s*(#[0-9a-f]{6})/i)?.[1];
if (!tileColor) throw new Error("--color-surface not found in globals.css");

const logo = read("public/brand/logo.svg");
const viewBox = logo.match(/viewBox="0 0 (\d+) (\d+)"/);
if (!viewBox) throw new Error("logo.svg needs a viewBox of the form 0 0 W H");
const markWidth = Number(viewBox[1]);
const markHeight = Number(viewBox[2]);

// Rounded tiles share Welcome's shape: a 30px radius on 112px.
const TILE = 112;
const TILE_RADIUS = 30 / TILE;
// The logo fills 64% of the tile's width, as in the brand artwork.
const TILE_MARK = 0.64;
// Maskable icons are cropped to a circle of 80% of the size. Keep the whole
// logo viewBox inside it: half its diagonal is 0.6 × its width, so a width of
// 0.62 × size (half-diagonal 0.373) leaves a small margin inside 0.4.
const MASKABLE_MARK = 0.62;

/** The logo as a nested <svg> of `width`, centered in a `size` square. */
function placeLogo(source, size, width) {
  const height = (width * markHeight) / markWidth;
  return source
    .replace(' xmlns="http://www.w3.org/2000/svg"', "")
    .replace("<svg ", `<svg x="${(size - width) / 2}" y="${(size - height) / 2}" `)
    .replace(/viewBox=/, `width="${width}" height="${height}" viewBox=`)
    .trim();
}

/** An SVG of `size` px: the logo at `markRatio` of the width on a tile. */
function iconSvg(size, { radius, markRatio }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${tileColor}"/>` +
    placeLogo(logo, size, size * markRatio) +
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

// The badge: Android draws only the alpha channel, so the logo is one solid
// color and the color doesn't matter.
const BADGE = 96;
const solid = logo.replace(/fill="url\([^)]*\)"/g, 'fill="#ffffff"');
write(
  "public/icons/badge-96.png",
  await png(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE}" height="${BADGE}" viewBox="0 0 ${BADGE} ${BADGE}">` +
      placeLogo(solid, BADGE, BADGE * 0.92) +
      `</svg>\n`,
  ),
);
