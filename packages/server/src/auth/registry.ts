import { promises as fs, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(HERE, "../../data");
const SPACES_FILE = path.join(DATA_DIR, "spaces.json");
const SECRET_FILE = path.join(DATA_DIR, "invite-secret");

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
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${SPACES_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(registry, null, 2), "utf8");
  await fs.rename(tmp, SPACES_FILE);
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
// credential; the secret persists on disk so tokens survive restarts
// (best-effort on ephemeral hosting).
const SECRET: Buffer = (() => {
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
