import { MAX_MAP_SIZE } from "./constants";

export interface MapObject {
  id: string;
  gid: number;
  x: number;
  y: number;
}

export interface ZoneRect {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
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
        z.h > 0
    )
  )
    return false;
  return true;
}
