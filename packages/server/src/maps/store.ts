import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MapDoc } from "@gather/shared";
import { kvEnabled, kvGet, kvSet } from "../storage/kv";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAPS_DIR =
  process.env.MAPS_DIR ?? path.resolve(HERE, "../../data/maps");
const DEFAULT_MAP = path.resolve(HERE, "../../data/maps/default.json");

const safeId = (spaceId: string) =>
  spaceId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

function mapPath(spaceId: string): string {
  return path.join(MAPS_DIR, `${safeId(spaceId)}.json`);
}

const mapKey = (spaceId: string) => `gather:map:${safeId(spaceId)}`;

export async function loadMap(spaceId: string): Promise<MapDoc> {
  if (kvEnabled) {
    try {
      const raw = await kvGet(mapKey(spaceId));
      if (raw) return JSON.parse(raw) as MapDoc;
    } catch (err) {
      // A KV outage must not brick joins; new visitors get the default
      // map, and saves will surface their own errors.
      console.error(`kv map load failed for ${spaceId}:`, err);
    }
  } else {
    try {
      return JSON.parse(await fs.readFile(mapPath(spaceId), "utf8")) as MapDoc;
    } catch {
      // fall through to default
    }
  }
  try {
    return JSON.parse(await fs.readFile(DEFAULT_MAP, "utf8")) as MapDoc;
  } catch {
    throw new Error(`No map found for space "${spaceId}" and no default map`);
  }
}

export async function saveMap(spaceId: string, map: MapDoc): Promise<void> {
  if (kvEnabled) {
    await kvSet(mapKey(spaceId), JSON.stringify(map));
    return;
  }
  await fs.mkdir(MAPS_DIR, { recursive: true });
  const file = mapPath(spaceId);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2), "utf8");
  await fs.rename(tmp, file);
}
