import { promises as fs, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { kvEnabled, kvGet, kvSet } from "../storage/kv";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(HERE, "../../data");
const SPACES_FILE = path.join(DATA_DIR, "spaces.json");
const SECRET_FILE = path.join(DATA_DIR, "invite-secret");
const REGISTRY_KEY = "gather:spaces";
const SECRET_KEY = "gather:invite-secret";

export interface SpaceRecord {
  owner: string;
  members: string[];
  createdAt: number;
}

type Registry = Record<string, SpaceRecord>;

let registry: Registry = (() => {
  try {
    return JSON.parse(readFileSync(SPACES_FILE, "utf8")) as Registry;
  } catch {
    return {};
  }
})();

async function persist(): Promise<void> {
  if (kvEnabled) {
    try {
      await kvSet(REGISTRY_KEY, JSON.stringify(registry));
    } catch (err) {
      console.error("kv registry persist failed:", err);
    }
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${SPACES_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(registry, null, 2), "utf8");
  await fs.rename(tmp, SPACES_FILE);
}

/**
 * Pulls the durable registry + invite secret out of KV before the server
 * starts taking joins. Without KV this is a no-op: the module-level disk
 * reads above already did the work (dev / single-box deployments).
 */
export async function initRegistry(): Promise<void> {
  if (!kvEnabled) return;
  try {
    const raw = await kvGet(REGISTRY_KEY);
    if (raw) registry = JSON.parse(raw) as Registry;
  } catch (err) {
    console.error("kv registry load failed (starting empty):", err);
  }
  // An INVITE_SECRET env always wins; otherwise the first boot persists
  // its generated secret so invite links keep working across redeploys.
  if (!process.env.INVITE_SECRET) {
    try {
      const hex = await kvGet(SECRET_KEY);
      if (hex) {
        SECRET = Buffer.from(hex.trim(), "hex");
      } else {
        await kvSet(SECRET_KEY, SECRET.toString("hex"));
      }
    } catch (err) {
      console.error("kv invite-secret load failed (using local):", err);
    }
  }
}

export function getSpace(spaceId: string): SpaceRecord | undefined {
  return registry[spaceId];
}

/** First authenticated joiner of an unregistered space becomes its owner. */
export function ensureSpace(spaceId: string, ownerEmail: string): SpaceRecord {
  let rec = registry[spaceId];
  if (!rec) {
    rec = { owner: ownerEmail, members: [ownerEmail], createdAt: Date.now() };
    registry[spaceId] = rec;
    void persist();
  }
  return rec;
}

export function isMember(spaceId: string, email: string): boolean {
  return registry[spaceId]?.members.includes(email) ?? false;
}

export function addMember(spaceId: string, email: string): void {
  const rec = registry[spaceId];
  if (!rec || rec.members.includes(email)) return;
  rec.members.push(email);
  void persist();
}

export function spacesFor(email: string): string[] {
  return Object.keys(registry).filter((id) =>
    registry[id].members.includes(email)
  );
}

// Invite links carry an HMAC token so possession of the link is the
// credential; the secret persists (KV via initRegistry, else disk) so
// tokens survive restarts and redeploys.
let SECRET: Buffer = (() => {
  const env = process.env.INVITE_SECRET;
  if (env) return Buffer.from(env, "utf8");
  try {
    return Buffer.from(readFileSync(SECRET_FILE, "utf8").trim(), "hex");
  } catch {
    const fresh = randomBytes(32);
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SECRET_FILE, fresh.toString("hex"), { mode: 0o600 });
    return fresh;
  }
})();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(spaceId: string, exp: number): Buffer {
  return createHmac("sha256", SECRET).update(`${spaceId}:${exp}`).digest();
}

export function createInvite(spaceId: string): string {
  const exp = Date.now() + INVITE_TTL_MS;
  return `${exp}.${sign(spaceId, exp).toString("base64url")}`;
}

export function verifyInvite(spaceId: string, token: string): boolean {
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  let given: Buffer;
  try {
    given = Buffer.from(token.slice(dot + 1), "base64url");
  } catch {
    return false;
  }
  const expected = sign(spaceId, exp);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
