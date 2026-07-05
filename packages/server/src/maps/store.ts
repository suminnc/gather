import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MapDoc } from "@gather/shared";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAPS_DIR =
  process.env.MAPS_DIR ?? path.resolve(HERE, "../../data/maps");
const DEFAULT_MAP = path.resolve(HERE, "../../data/maps/default.json");

function mapPath(spaceId: string): string {
  const safe = spaceId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return path.join(MAPS_DIR, `${safe}.json`);
}

export async function loadMap(spaceId: string): Promise<MapDoc> {
  for (const file of [mapPath(spaceId), DEFAULT_MAP]) {
    try {
      const raw = await fs.readFile(file, "utf8");
      return JSON.parse(raw) as MapDoc;
    } catch {
      // fall through to default
    }
  }
  throw new Error(`No map found for space "${spaceId}" and no default map`);
}

export async function saveMap(spaceId: string, map: MapDoc): Promise<void> {
  await fs.mkdir(MAPS_DIR, { recursive: true });
  const file = mapPath(spaceId);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2), "utf8");
  await fs.rename(tmp, file);
}
