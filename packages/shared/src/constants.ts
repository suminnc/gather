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

/** Nearby chat reaches players in the same zone or within this tile distance. */
export const NEARBY_CHAT_DIST = DISCONNECT_DIST;

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

export const DEFAULT_SPACE_ID = "lobby";
