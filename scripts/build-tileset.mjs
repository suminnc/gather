// Compose packages/client/public/assets/tiles/tiles.png from Kenney's CC0
// "Roguelike/RPG pack" + "Roguelike Indoors" sheets (16px tiles, 1px
// spacing), upscaled 2x nearest-neighbor to our 32px grid.
//
// Layout (8 columns): row 0 = floors (gids 0-7), row 1 = walls (8-15),
// rows 2-3 = objects (16-31). Downloaded sheets are read from the paths
// given on the CLI:
//   node scripts/build-tileset.mjs <roguelikeSheet.png> <indoorSheet.png>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(
  HERE,
  "../packages/client/public/assets/tiles/tiles.png"
);

const SRC_TILE = 16;
const SPACE = 1;
const TILE = 32;
const COLS = 8;

const [, , rpgPath, indoorPath] = process.argv;
const rpg = PNG.sync.read(fs.readFileSync(rpgPath));
const indoor = PNG.sync.read(fs.readFileSync(indoorPath));

// gid -> [sheet, col, row]  (sheet tile coordinates)
const R = (c, r) => [rpg, c, r];
const I = (c, r) => [indoor, c, r];
const PICKS = [
  // floors 0-7
  R(1, 26), // wood
  R(4, 26), // gray stone
  R(7, 26), // beige
  R(10, 26), // green
  R(13, 26), // terracotta (theater red)
  R(16, 26), // teal
  R(1, 29), // dark wood
  R(4, 29), // dark gray
  // walls 8-15
  R(14, 15), // beige face
  R(23, 15), // gray face
  R(32, 15), // blue-gray face
  R(5, 2), // gray stone brick (theater)
  R(6, 2), // beige stone
  R(7, 2), // stone block
  R(5, 4), // gray brick variant
  R(6, 4), // beige brick variant
  // objects 16-31
  I(2, 2), // chair facing down
  I(3, 2), // chair facing up
  I(0, 2), // armchair (theater seat)
  I(0, 8), // white chair
  I(4, 2), // small table
  I(12, 1), // bookshelf
  I(23, 10), // piano keys
  I(16, 14), // screen left
  I(17, 14), // screen middle
  I(18, 14), // screen right
  I(14, 14), // speaker
  I(15, 0), // potted plant
  R(45, 7), // closed door
  R(14, 9), // tree
  R(16, 9), // pine
  R(20, 9), // bush
];

const rows = Math.ceil(PICKS.length / COLS) + 4; // spare rows stay empty
const out = new PNG({ width: COLS * TILE, height: 8 * TILE });

PICKS.forEach(([sheet, sc, sr], gid) => {
  const sx = sc * (SRC_TILE + SPACE);
  const sy = sr * (SRC_TILE + SPACE);
  const dx = (gid % COLS) * TILE;
  const dy = Math.floor(gid / COLS) * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const si =
        ((sy + (y >> 1)) * sheet.width + (sx + (x >> 1))) * 4;
      const di = ((dy + y) * out.width + dx + x) * 4;
      out.data[di] = sheet.data[si];
      out.data[di + 1] = sheet.data[si + 1];
      out.data[di + 2] = sheet.data[si + 2];
      out.data[di + 3] = sheet.data[si + 3];
    }
  }
});

// gid 32: hand-drawn top-down go-kart (no vehicles in the Kenney packs).
{
  const gid = PICKS.length; // 32
  const dx = (gid % COLS) * TILE;
  const dy = Math.floor(gid / COLS) * TILE;
  const put = (x, y, r, g, b) => {
    const i = ((dy + y) * out.width + dx + x) * 4;
    out.data[i] = r;
    out.data[i + 1] = g;
    out.data[i + 2] = b;
    out.data[i + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, ...c);
  };
  const RED = [200, 50, 50];
  const DARK = [30, 30, 34];
  const GRAY = [90, 94, 104];
  const YELLOW = [240, 200, 60];
  rect(10, 6, 21, 25, RED); // chassis
  rect(12, 4, 19, 6, YELLOW); // front wing
  rect(13, 12, 18, 19, DARK); // seat
  rect(14, 8, 17, 10, GRAY); // steering column
  rect(6, 6, 9, 12, DARK); // wheels
  rect(22, 6, 25, 12, DARK);
  rect(6, 19, 9, 25, DARK);
  rect(22, 19, 25, 25, DARK);
  rect(12, 26, 19, 28, GRAY); // rear bumper
}

fs.writeFileSync(OUT, PNG.sync.write(out));
console.log(
  `wrote ${OUT} (${out.width}x${out.height}, ${PICKS.length + 1} tiles)`
);
