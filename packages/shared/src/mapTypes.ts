import {
  CUSTOM_GID_BASE,
  MAX_CUSTOM_TILES,
  MAX_CUSTOM_TILE_DATA,
  MAX_CUSTOM_TILES_TOTAL_DATA,
  MAX_MAP_SIZE,
} from "./constants";

export interface MapObject {
  id: string;
  gid: number;
  x: number;
  y: number;
}

/** A user-drawn or imported tile design, synced as part of the map. */
export interface CustomTile {
  /** Stable id ≥ CUSTOM_GID_BASE so it never collides with sheet frames. */
  gid: number;
  kind: "floor" | "wall" | "object";
  /** Square PNG data URL, up to CUSTOM_TILE_RES per side. */
  data: string;
}

export interface ZoneRect {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** "theater" zones get a shared synchronized video screen. */
  kind?: "theater";
}

export interface Spawn {
  x: number;
  y: number;
}

export interface MapDoc {
  version: 1;
  name: string;
  width: number;
  height: number;
  tileSize: number;
  tilesetKey: string;
  layers: {
    /** width*height gid array, row-major; -1 = empty */
    floor: number[];
    /** any gid >= 0 here is a collision tile */
    walls: number[];
  };
  objects: MapObject[];
  zones: ZoneRect[];
  spawns: Spawn[];
  customTiles?: CustomTile[];
}

export function tileIndex(map: Pick<MapDoc, "width">, x: number, y: number): number {
  return y * map.width + x;
}

export function inBounds(map: Pick<MapDoc, "width" | "height">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function isWalkable(map: MapDoc, x: number, y: number): boolean {
  if (!inBounds(map, x, y)) return false;
  return map.layers.walls[tileIndex(map, x, y)] === -1;
}

export function zoneAt(map: MapDoc, x: number, y: number): ZoneRect | undefined {
  return map.zones.find(
    (z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h
  );
}

/**
 * Zones considered the "inside" of a door at (x, y): the door tile's own
 * zone plus the zones of its walkable 4-neighbors. When any exist, only
 * players standing in one of them may operate the lock — so a room's door
 * is controlled from within the room. A door with no zone on either side
 * has no inside and stays operable by anyone adjacent.
 */
export function doorInsideZones(map: MapDoc, x: number, y: number): string[] {
  const ids = new Set<string>();
  const own = zoneAt(map, x, y);
  if (own) ids.add(own.id);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    if (!isWalkable(map, x + dx, y + dy)) continue;
    const z = zoneAt(map, x + dx, y + dy);
    if (z) ids.add(z.id);
  }
  return [...ids];
}

export function validateMap(map: unknown): map is MapDoc {
  if (typeof map !== "object" || map === null) return false;
  const m = map as MapDoc;
  if (m.version !== 1) return false;
  if (
    !Number.isInteger(m.width) ||
    !Number.isInteger(m.height) ||
    m.width < 4 ||
    m.height < 4 ||
    m.width > MAX_MAP_SIZE ||
    m.height > MAX_MAP_SIZE
  )
    return false;
  if (typeof m.tileSize !== "number" || typeof m.tilesetKey !== "string")
    return false;
  const size = m.width * m.height;
  if (!m.layers || typeof m.layers !== "object") return false;
  for (const layer of [m.layers.floor, m.layers.walls]) {
    if (!Array.isArray(layer) || layer.length !== size) return false;
    if (!layer.every((g) => Number.isInteger(g) && g >= -1)) return false;
  }
  if (!Array.isArray(m.objects) || !Array.isArray(m.zones)) return false;
  if (!Array.isArray(m.spawns) || m.spawns.length < 1) return false;
  if (
    !m.spawns.every(
      (s) =>
        Number.isInteger(s.x) &&
        Number.isInteger(s.y) &&
        s.x >= 0 &&
        s.y >= 0 &&
        s.x < m.width &&
        s.y < m.height
    )
  )
    return false;
  if (m.customTiles !== undefined) {
    if (!Array.isArray(m.customTiles)) return false;
    if (m.customTiles.length > MAX_CUSTOM_TILES) return false;
    const totalData = m.customTiles.reduce(
      (n, c) => n + (typeof c?.data === "string" ? c.data.length : 0),
      0
    );
    if (totalData > MAX_CUSTOM_TILES_TOTAL_DATA) return false;
    const gids = new Set<number>();
    for (const c of m.customTiles) {
      if (
        !c ||
        !Number.isInteger(c.gid) ||
        c.gid < CUSTOM_GID_BASE ||
        gids.has(c.gid) ||
        (c.kind !== "floor" && c.kind !== "wall" && c.kind !== "object") ||
        typeof c.data !== "string" ||
        !c.data.startsWith("data:image/png;base64,") ||
        c.data.length > MAX_CUSTOM_TILE_DATA
      )
        return false;
      gids.add(c.gid);
    }
  }
  if (
    !m.zones.every(
      (z) =>
        typeof z.id === "string" &&
        typeof z.name === "string" &&
        Number.isInteger(z.x) &&
        Number.isInteger(z.y) &&
        Number.isInteger(z.w) &&
        Number.isInteger(z.h) &&
        z.w > 0 &&
        z.h > 0 &&
        (z.kind === undefined || z.kind === "theater")
    )
  )
    return false;
  return true;
}
