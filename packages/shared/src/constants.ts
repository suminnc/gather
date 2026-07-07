export const TILE_SIZE = 32;

/** Tiles within this Chebyshev distance start a call. */
export const CONNECT_DIST = 3;
/** A call only drops beyond this distance (hysteresis gap vs CONNECT_DIST). */
export const DISCONNECT_DIST = 5;
/** How often the server recomputes proximity links. */
export const PROXIMITY_TICK_MS = 250;

/** Duration of one tile-hop tween on clients. */
export const MOVE_MS = 150;

export const MAX_CLIENTS = 10;
export const MAX_MAP_SIZE = 100;
export const CHAT_HISTORY_LIMIT = 100;

/** Object gids with special behavior (see the curated tileset layout). */
export const CHAIR_GIDS = [16, 17, 18, 19];
export const DOOR_GID = 28;
export const KART_GID = 32;
/** Riding a kart halves the per-tile hop duration. */
export const KART_SPEED_FACTOR = 2;

/** Custom tile gids start here so they never collide with sheet frames. */
export const CUSTOM_GID_BASE = 1000;
export const MAX_CUSTOM_TILES = 64;
/** Byte cap per custom-tile PNG data URL (a 32×32 PNG is usually <2 KB). */
export const MAX_CUSTOM_TILE_DATA = 8192;

/** Nearby chat reaches players in the same zone or within this tile distance. */
export const NEARBY_CHAT_DIST = DISCONNECT_DIST;

/** Reactions shown above a player's head; clients send the index. */
export const EMOTES = ["👋", "❤️", "👍", "😂", "🎉", "❓"] as const;
/** Server drops emotes sent faster than this per player. */
export const EMOTE_COOLDOWN_MS = 300;

export const AVATARS = [
  "avatar_0",
  "avatar_1",
  "avatar_2",
  "avatar_3",
  "avatar_4",
  "avatar_5",
  "avatar_6",
  "avatar_7",
  "avatar_8",
  "avatar_9",
  "avatar_10",
  "avatar_11",
] as const;

/** Custom avatar id: "c:" + skin.shirt.hair.pants as bare hex colors. */
export const CUSTOM_AVATAR_RE =
  /^c:[0-9a-f]{6}\.[0-9a-f]{6}\.[0-9a-f]{6}\.[0-9a-f]{6}$/i;

export function isAvatarId(s: string): boolean {
  return (AVATARS as readonly string[]).includes(s) || CUSTOM_AVATAR_RE.test(s);
}

export const DEFAULT_SPACE_ID = "lobby";
