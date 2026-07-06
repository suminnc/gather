#!/usr/bin/env node
/**
 * Generates the placeholder art (tileset + avatar spritesheets) and the
 * default map. Pure Node — encodes PNGs by hand (zlib + CRC32), no deps.
 * Swap the PNGs for Kenney/LPC assets later without touching the code.
 *
 * Usage: node scripts/gen-assets.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "packages/client/public/assets");
const MAPS = path.join(ROOT, "packages/server/data/maps");

// ---------- minimal PNG encoder ----------
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- drawing helpers ----------
class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.buf = Buffer.alloc(w * h * 4);
  }
  px(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.buf[i] = r;
    this.buf[i + 1] = g;
    this.buf[i + 2] = b;
    this.buf[i + 3] = a;
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, c);
  }
  save(file) {
    writeFileSync(file, encodePng(this.w, this.h, this.buf));
  }
}
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];
const shade = (c, f) => [Math.max(0, Math.min(255, c[0] * f)), Math.max(0, Math.min(255, c[1] * f)), Math.max(0, Math.min(255, c[2] * f)), 255];

// ---------- tileset: 8x8 grid of 32px tiles ----------
const T = 32;
const COLS = 8;

function baseTile(c, base, noise = 0.06, seed = 1) {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return (ox, oy) => {
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const f = 1 - noise / 2 + rand() * noise;
        c.px(ox + x, oy + y, shade(base, f));
      }
  };
}

function drawTile(c, gid, fn) {
  const ox = (gid % COLS) * T;
  const oy = Math.floor(gid / COLS) * T;
  fn(ox, oy);
}

const tiles = new Canvas(COLS * T, COLS * T);

// Row 0 — floors (gid 0..7)
const FLOORS = ["#a8845c", "#8a6a48", "#7bb661", "#9aa0a6", "#b5544e", "#4e6eb5", "#d8d3c8", "#c2b280"];
FLOORS.forEach((col, i) => {
  drawTile(tiles, i, (ox, oy) => {
    baseTile(tiles, hex(col), 0.08, i + 3)(ox, oy);
    const base = hex(col);
    if (i <= 1) {
      // wood planks
      for (let y = 0; y < T; y += 8) tiles.rect(ox, oy + y, T, 1, shade(base, 0.8));
      tiles.rect(ox + 16, oy, 1, 8, shade(base, 0.8));
      tiles.rect(ox + 8, oy + 16, 1, 8, shade(base, 0.8));
    } else if (i === 3 || i === 6) {
      // stone/tile grid
      tiles.rect(ox, oy, T, 1, shade(base, 0.85));
      tiles.rect(ox, oy, 1, T, shade(base, 0.85));
      tiles.rect(ox, oy + 16, T, 1, shade(base, 0.9));
      tiles.rect(ox + 16, oy, 1, T, shade(base, 0.9));
    }
  });
});

// Row 1 — walls (gid 8..15)
const WALLS = ["#6d4c41", "#455a64", "#8d6e63", "#607d8b", "#5d4037", "#37474f", "#795548", "#263238"];
WALLS.forEach((col, i) => {
  const gid = 8 + i;
  drawTile(tiles, gid, (ox, oy) => {
    const base = hex(col);
    baseTile(tiles, base, 0.05, i + 11)(ox, oy);
    // brick pattern
    for (let y = 0; y < T; y += 8) {
      tiles.rect(ox, oy + y, T, 1, shade(base, 0.7));
      const off = (y / 8) % 2 === 0 ? 0 : 16;
      tiles.rect(ox + ((off + 8) % T), oy + y, 1, 8, shade(base, 0.7));
      tiles.rect(ox + ((off + 24) % T), oy + y, 1, 8, shade(base, 0.7));
    }
    tiles.rect(ox, oy, T, 2, shade(base, 1.25)); // top highlight
  });
});

// Row 2 — furniture/objects (gid 16..23)
function furnitureTile(gid, draw) {
  drawTile(tiles, gid, (ox, oy) => draw(ox, oy));
}
// 16 desk
furnitureTile(16, (ox, oy) => {
  tiles.rect(ox + 2, oy + 8, 28, 14, hex("#8a5a2b"));
  tiles.rect(ox + 2, oy + 8, 28, 3, hex("#a97142"));
  tiles.rect(ox + 3, oy + 22, 4, 8, hex("#6b4423"));
  tiles.rect(ox + 25, oy + 22, 4, 8, hex("#6b4423"));
});
// 17 table (round)
furnitureTile(17, (ox, oy) => {
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const dx = x - 16, dy = y - 16;
      if (dx * dx + dy * dy <= 144) tiles.px(ox + x, oy + y, hex("#9c6b3c"));
      if (dx * dx + dy * dy <= 144 && dx * dx + dy * dy >= 110) tiles.px(ox + x, oy + y, hex("#7a5330"));
    }
});
// 18 chair
furnitureTile(18, (ox, oy) => {
  tiles.rect(ox + 9, oy + 6, 14, 4, hex("#4e6eb5"));
  tiles.rect(ox + 9, oy + 10, 14, 12, hex("#5f7fc6"));
  tiles.rect(ox + 9, oy + 22, 3, 6, hex("#37474f"));
  tiles.rect(ox + 20, oy + 22, 3, 6, hex("#37474f"));
});
// 19 sofa
furnitureTile(19, (ox, oy) => {
  tiles.rect(ox + 2, oy + 10, 28, 14, hex("#b5544e"));
  tiles.rect(ox + 2, oy + 6, 28, 6, hex("#c9645e"));
  tiles.rect(ox + 2, oy + 10, 4, 14, hex("#a04640"));
  tiles.rect(ox + 26, oy + 10, 4, 14, hex("#a04640"));
});
// 20 plant
furnitureTile(20, (ox, oy) => {
  tiles.rect(ox + 12, oy + 20, 8, 8, hex("#b5544e"));
  tiles.rect(ox + 13, oy + 18, 6, 2, hex("#8a3f3a"));
  for (const [px, py, r] of [[16, 10, 6], [11, 14, 4], [21, 14, 4], [16, 16, 4]])
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++)
        if (x * x + y * y <= r * r) tiles.px(ox + px + x, oy + py + y, hex("#4f9e4f"));
});
// 21 bookshelf
furnitureTile(21, (ox, oy) => {
  tiles.rect(ox + 3, oy + 2, 26, 28, hex("#6b4423"));
  for (const y of [5, 13, 21]) {
    tiles.rect(ox + 5, oy + y, 22, 6, hex("#3e2b17"));
    const cols = ["#b5544e", "#4e6eb5", "#7bb661", "#d8b23c", "#9a5fb5"];
    let x = 6;
    for (let k = 0; k < 5 && x < 25; k++) {
      const w = 3 + (k % 3);
      tiles.rect(ox + x, oy + y + 1, w, 5, hex(cols[(k + y) % cols.length]));
      x += w + 1;
    }
  }
});
// 22 rug
furnitureTile(22, (ox, oy) => {
  tiles.rect(ox + 1, oy + 1, 30, 30, hex("#7c3aed"));
  tiles.rect(ox + 4, oy + 4, 24, 24, hex("#9a5fb5"));
  tiles.rect(ox + 8, oy + 8, 16, 16, hex("#b58fd0"));
});
// 23 whiteboard
furnitureTile(23, (ox, oy) => {
  tiles.rect(ox + 2, oy + 4, 28, 18, hex("#eceff1"));
  tiles.rect(ox + 2, oy + 4, 28, 2, hex("#90a4ae"));
  tiles.rect(ox + 2, oy + 20, 28, 2, hex("#90a4ae"));
  tiles.rect(ox + 5, oy + 8, 12, 2, hex("#b5544e"));
  tiles.rect(ox + 5, oy + 12, 18, 2, hex("#4e6eb5"));
  tiles.rect(ox + 14, oy + 24, 4, 6, hex("#607d8b"));
});

mkdirSync(path.join(ASSETS, "tiles"), { recursive: true });
// tiles.png is now curated from Kenney CC0 packs via build-tileset.mjs;
// the generated placeholder sheet is no longer written.

// ---------- avatars: 3 frames x 4 directions (down,left,right,up), 32px ----------
const AVATAR_COLORS = [
  "#e05d5d", "#4e8fe0", "#58b368", "#d8a13c", "#9a5fb5", "#48b5ad",
  "#d96aa8", "#8fbf4d", "#7e8ca0", "#d8c84a", "#6a5fd9", "#e0813d",
];
mkdirSync(path.join(ASSETS, "avatars"), { recursive: true });

AVATAR_COLORS.forEach((shirtHex, idx) => {
  const c = new Canvas(3 * T, 4 * T);
  const shirt = hex(shirtHex);
  const skin = hex(idx % 2 === 0 ? "#f0c8a0" : "#c68e5e");
  const hair = hex(
    [
      "#3e2b17", "#1c1c1c", "#7a5330", "#5d3a66", "#26323e", "#822f2f",
      "#f0e6d2", "#2e4a1f", "#4a3020", "#703a10", "#c0c8d8", "#302818",
    ][idx]
  );
  const pants = hex("#37474f");
  for (let row = 0; row < 4; row++) {
    for (let frame = 0; frame < 3; frame++) {
      const ox = frame * T;
      const oy = row * T;
      const step = frame === 1 ? 0 : frame === 0 ? -2 : 2; // leg swing
      // legs
      c.rect(ox + 11, oy + 22, 4, 7 + (step < 0 ? -1 : step > 0 ? 1 : 0), pants);
      c.rect(ox + 17, oy + 22, 4, 7 + (step > 0 ? -1 : step < 0 ? 1 : 0), pants);
      // body
      c.rect(ox + 9, oy + 13, 14, 10, shirt);
      // arms
      c.rect(ox + 6, oy + 14 + (step > 0 ? 2 : 0), 3, 7, shirt);
      c.rect(ox + 23, oy + 14 + (step < 0 ? 2 : 0), 3, 7, shirt);
      c.rect(ox + 6, oy + 21 + (step > 0 ? 2 : 0), 3, 2, skin);
      c.rect(ox + 23, oy + 21 + (step < 0 ? 2 : 0), 3, 2, skin);
      // head
      c.rect(ox + 10, oy + 3, 12, 11, skin);
      // hair + face per direction
      if (row === 0) {
        // down: bangs + eyes
        c.rect(ox + 10, oy + 3, 12, 4, hair);
        c.rect(ox + 12, oy + 8, 2, 2, hex("#1c1c1c"));
        c.rect(ox + 18, oy + 8, 2, 2, hex("#1c1c1c"));
      } else if (row === 1) {
        // left
        c.rect(ox + 10, oy + 3, 12, 4, hair);
        c.rect(ox + 10, oy + 3, 4, 8, hair);
        c.rect(ox + 12, oy + 8, 2, 2, hex("#1c1c1c"));
      } else if (row === 2) {
        // right
        c.rect(ox + 10, oy + 3, 12, 4, hair);
        c.rect(ox + 18, oy + 3, 4, 8, hair);
        c.rect(ox + 18, oy + 8, 2, 2, hex("#1c1c1c"));
      } else {
        // up: back of head
        c.rect(ox + 10, oy + 3, 12, 9, hair);
      }
    }
  }
  c.save(path.join(ASSETS, "avatars", `avatar_${idx}.png`));
});

// ---------- default map: 40x30 park + rooms + movie theater ----------
// Palette (kenney tiles): floors 0 wood, 1 gray, 2 beige, 3 grass, 4 terracotta,
// 5 teal, 6 dark wood, 7 dark gray. Walls 8 beige, 9 gray, 10 blue, 11 brown
// brick, 12 beige stone, 13 stone block, 14 gray brick, 15 beige brick.
// Objects: 16 chairD, 17 chairU, 18 armchair, 19 white chair, 20 table,
// 21 bookshelf, 22 piano, 23-25 screen L/M/R, 26 speaker, 27 plant,
// 28 door, 29 tree, 30 pine, 31 bush.
const W = 40, H = 30;
const floor = new Array(W * H).fill(3); // grass
const walls = new Array(W * H).fill(-1);
const at = (x, y) => y * W + x;

// outer walls
for (let x = 0; x < W; x++) {
  walls[at(x, 0)] = 14;
  walls[at(x, H - 1)] = 14;
}
for (let y = 0; y < H; y++) {
  walls[at(0, y)] = 14;
  walls[at(W - 1, y)] = 14;
}
// stone plaza in the middle
for (let y = 10; y < 19; y++) for (let x = 14; x < 27; x++) floor[at(x, y)] = 1;
// wood-floored meeting room, top-left (zone z1)
for (let y = 3; y < 10; y++) for (let x = 3; x < 13; x++) floor[at(x, y)] = 0;
for (let x = 2; x <= 13; x++) { walls[at(x, 2)] = 8; walls[at(x, 10)] = 8; }
for (let y = 2; y <= 10; y++) { walls[at(2, y)] = 8; walls[at(13, y)] = 8; }
walls[at(8, 10)] = -1; // door gap
walls[at(9, 10)] = -1;
// lounge room, top-right (zone z2)
for (let y = 3; y < 10; y++) for (let x = 28; x < 38; x++) floor[at(x, y)] = 2;
for (let x = 27; x <= 38; x++) { walls[at(x, 2)] = 10; walls[at(x, 10)] = 10; }
for (let y = 2; y <= 10; y++) { walls[at(27, y)] = 10; walls[at(38, y)] = 10; }
walls[at(32, 10)] = -1; // door gap
walls[at(33, 10)] = -1;
// movie theater, bottom-left (zone theater): dark floor, brick shell
for (let y = 20; y < 28; y++) for (let x = 3; x < 16; x++) floor[at(x, y)] = 7;
for (let x = 2; x <= 16; x++) { walls[at(x, 19)] = 11; walls[at(x, 28)] = 11; }
for (let y = 19; y <= 28; y++) { walls[at(2, y)] = 11; walls[at(16, y)] = 11; }
walls[at(16, 23)] = -1; // entrance on the right wall
walls[at(16, 24)] = -1;
// terracotta aisle from plaza to the theater entrance
for (let y = 23; y <= 24; y++) for (let x = 17; x < 20; x++) floor[at(x, y)] = 4;

const objects = [
  // meeting room
  { id: "o1", gid: 20, x: 7, y: 6 },
  { id: "o2", gid: 16, x: 6, y: 5 },
  { id: "o3", gid: 16, x: 8, y: 5 },
  { id: "o4", gid: 17, x: 6, y: 7 },
  { id: "o5", gid: 17, x: 8, y: 7 },
  { id: "o6", gid: 21, x: 4, y: 3 },
  // lounge
  { id: "o7", gid: 18, x: 30, y: 5 },
  { id: "o8", gid: 18, x: 34, y: 5 },
  { id: "o9", gid: 22, x: 36, y: 3 },
  { id: "o10", gid: 27, x: 29, y: 3 },
  { id: "o11", gid: 20, x: 32, y: 6 },
  // theater: screen strip on the front wall, then rows of seats
  { id: "t1", gid: 23, x: 7, y: 20 },
  { id: "t2", gid: 24, x: 8, y: 20 },
  { id: "t3", gid: 24, x: 9, y: 20 },
  { id: "t4", gid: 24, x: 10, y: 20 },
  { id: "t5", gid: 25, x: 11, y: 20 },
  { id: "t6", gid: 26, x: 4, y: 20 },
  { id: "t7", gid: 26, x: 14, y: 20 },
  ...[23, 25, 27].flatMap((row, r) =>
    [4, 5, 6, 8, 10, 12, 13, 14].map((x, i) => ({
      id: `s${r}_${i}`,
      gid: 17,
      x,
      y: row,
    }))
  ),
  // park
  { id: "o12", gid: 29, x: 15, y: 11 },
  { id: "o13", gid: 30, x: 25, y: 11 },
  { id: "o14", gid: 30, x: 15, y: 17 },
  { id: "o15", gid: 29, x: 25, y: 17 },
  { id: "o16", gid: 31, x: 30, y: 20 },
  { id: "o17", gid: 29, x: 33, y: 22 },
  { id: "o18", gid: 30, x: 36, y: 25 },
  { id: "o19", gid: 31, x: 30, y: 26 },
];

const map = {
  version: 1,
  name: "default",
  width: W,
  height: H,
  tileSize: 32,
  tilesetKey: "tiles",
  layers: { floor, walls },
  objects,
  zones: [
    { id: "z1", name: "Meeting Room", x: 3, y: 3, w: 10, h: 7, color: "#7c3aed" },
    { id: "z2", name: "Lounge", x: 28, y: 3, w: 10, h: 7, color: "#2f855a" },
    { id: "theater", name: "Theater", kind: "theater", x: 3, y: 20, w: 13, h: 8, color: "#b5544e" },
  ],
  spawns: [
    { x: 19, y: 14 },
    { x: 21, y: 14 },
    { x: 19, y: 16 },
    { x: 21, y: 16 },
  ],
};

mkdirSync(MAPS, { recursive: true });
writeFileSync(path.join(MAPS, "default.json"), JSON.stringify(map, null, 2));

console.log(
  `generated: tiles.png, ${AVATAR_COLORS.length} avatar sheets, default.json`
);
