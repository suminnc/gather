import type Phaser from "phaser";
import { CUSTOM_AVATAR_RE, TILE_SIZE } from "@gather/shared";

export interface AvatarColors {
  skin: string;
  shirt: string;
  hair: string;
  pants: string;
}

export const DEFAULT_CUSTOM_COLORS: AvatarColors = {
  skin: "#f0c8a0",
  shirt: "#4e8fe0",
  hair: "#3e2b17",
  pants: "#37474f",
};

export function customAvatarId(c: AvatarColors): string {
  const bare = (s: string) => s.replace("#", "").toLowerCase();
  return `c:${bare(c.skin)}.${bare(c.shirt)}.${bare(c.hair)}.${bare(c.pants)}`;
}

export function parseAvatarId(id: string): AvatarColors | null {
  if (!CUSTOM_AVATAR_RE.test(id)) return null;
  const [skin, shirt, hair, pants] = id.slice(2).split(".").map((h) => `#${h}`);
  return { skin, shirt, hair, pants };
}

/**
 * Draws the 3-frame × 4-direction walking sheet — the same art as
 * scripts/gen-assets.mjs draws for the preset avatars, with the palette
 * swapped for the player's chosen colors.
 */
export function drawAvatarSheet(
  ctx: CanvasRenderingContext2D,
  c: AvatarColors
): void {
  const T = TILE_SIZE;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  for (let row = 0; row < 4; row++) {
    for (let frame = 0; frame < 3; frame++) {
      const ox = frame * T;
      const oy = row * T;
      const step = frame === 1 ? 0 : frame === 0 ? -2 : 2; // leg swing
      // legs
      rect(ox + 11, oy + 22, 4, 7 + (step < 0 ? -1 : step > 0 ? 1 : 0), c.pants);
      rect(ox + 17, oy + 22, 4, 7 + (step > 0 ? -1 : step < 0 ? 1 : 0), c.pants);
      // body
      rect(ox + 9, oy + 13, 14, 10, c.shirt);
      // arms
      rect(ox + 6, oy + 14 + (step > 0 ? 2 : 0), 3, 7, c.shirt);
      rect(ox + 23, oy + 14 + (step < 0 ? 2 : 0), 3, 7, c.shirt);
      rect(ox + 6, oy + 21 + (step > 0 ? 2 : 0), 3, 2, c.skin);
      rect(ox + 23, oy + 21 + (step < 0 ? 2 : 0), 3, 2, c.skin);
      // head
      rect(ox + 10, oy + 3, 12, 11, c.skin);
      // hair + face per direction
      if (row === 0) {
        rect(ox + 10, oy + 3, 12, 4, c.hair);
        rect(ox + 12, oy + 8, 2, 2, "#1c1c1c");
        rect(ox + 18, oy + 8, 2, 2, "#1c1c1c");
      } else if (row === 1) {
        // left: eye on the leading (left) edge, hair down the back
        rect(ox + 10, oy + 3, 12, 4, c.hair);
        rect(ox + 18, oy + 3, 4, 8, c.hair);
        rect(ox + 12, oy + 8, 2, 2, "#1c1c1c");
      } else if (row === 2) {
        // right: mirrored
        rect(ox + 10, oy + 3, 12, 4, c.hair);
        rect(ox + 10, oy + 3, 4, 8, c.hair);
        rect(ox + 18, oy + 8, 2, 2, "#1c1c1c");
      } else {
        rect(ox + 10, oy + 3, 12, 9, c.hair);
      }
    }
  }
}

const DIR_ROWS = { down: 0, left: 1, right: 2, up: 3 } as const;

/**
 * Bakes the texture + walk animations for a custom avatar id into the
 * scene (idempotent). Returns false for ids that don't parse.
 */
export function ensureCustomAvatar(scene: Phaser.Scene, id: string): boolean {
  if (scene.textures.exists(id)) return true;
  const colors = parseAvatarId(id);
  if (!colors) return false;

  const canvas = document.createElement("canvas");
  canvas.width = 3 * TILE_SIZE;
  canvas.height = 4 * TILE_SIZE;
  drawAvatarSheet(canvas.getContext("2d")!, colors);
  const tex = scene.textures.addCanvas(id, canvas)!;
  for (let f = 0; f < 12; f++) {
    tex.add(
      f,
      0,
      (f % 3) * TILE_SIZE,
      Math.floor(f / 3) * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE
    );
  }
  for (const [dir, row] of Object.entries(DIR_ROWS)) {
    scene.anims.create({
      key: `${id}-walk-${dir}`,
      frames: scene.anims.generateFrameNumbers(id, {
        frames: [row * 3, row * 3 + 1, row * 3 + 2, row * 3 + 1],
      }),
      frameRate: 8,
      repeat: -1,
    });
  }
  return true;
}
