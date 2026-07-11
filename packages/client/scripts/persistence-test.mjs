// E2E check for durable workspaces: maps, memberships, and invite links
// must survive a full server restart (i.e. a redeploy) when Upstash KV is
// configured. Runs a local mock of the Upstash REST protocol, spawns the
// real server against it twice, and checks state across the restart.
//   node packages/client/scripts/persistence-test.mjs
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import { Client } from "colyseus.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, "../../server");
const WS = "ws://localhost:2599";
const HTTP = "http://localhost:2599";
const KV_PORT = 2598;
const fake = (email) => `fake:${JSON.stringify({ email })}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  ok ? pass++ : fail++;
};

// ---- mock Upstash: POST ["GET"|"SET", key, value?] -> {result} ----
const store = new Map();
const kv = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const [cmd, key, value] = JSON.parse(body);
    let result = null;
    if (cmd === "GET") result = store.get(key) ?? null;
    if (cmd === "SET") {
      store.set(key, value);
      result = "OK";
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ result }));
  });
});
await new Promise((r) => kv.listen(KV_PORT, r));

// ---- server lifecycle ----
const startServer = async () => {
  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: SERVER_DIR,
    // Own process group so stop can kill npx AND its tsx child.
    detached: true,
    env: {
      ...process.env,
      PORT: "2599",
      AUTH_DEV_FAKE: "1",
      GOOGLE_CLIENT_ID: "test-client-id",
      UPSTASH_REDIS_REST_URL: `http://localhost:${KV_PORT}`,
      UPSTASH_REDIS_REST_TOKEN: "test-token",
      // Point disk fallbacks at a throwaway dir so nothing local leaks in.
      DATA_DIR: mkdtempSync(path.join(os.tmpdir(), "gather-ptest-")),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (c) => (log += c));
  child.stderr.on("data", (c) => (log += c));
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    if (log.includes("listening")) return { child, log: () => log };
  }
  throw new Error(`server never came up:\n${log}`);
};
const stopServer = async (child) => {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  await sleep(1000);
};

// ================= phase 1: create state =================
const s1 = await startServer();
check("server boots with upstash storage", s1.log().includes("storage: upstash"));

const a = new Client(WS);
const roomA = await a.joinOrCreate("space", {
  spaceId: "durable",
  name: "Alice",
  avatar: "avatar_0",
  idToken: fake("alice@x.com"),
});
check("owner creates workspace", !!roomA.sessionId);
roomA.onMessage("proximity", () => {});
roomA.onMessage("chat:history", () => {});

const invite = await new Promise((resolve) => {
  roomA.onMessage("invite:token", (m) => resolve(m.token));
  setTimeout(() => resolve(null), 3000);
});
check("owner gets invite token", typeof invite === "string");

// Edit the map (nudge a floor tile) and save it.
const map = JSON.parse(roomA.state.mapJson);
map.layers.floor[0] = 5;
const saveResult = await new Promise((resolve) => {
  roomA.onMessage("map:save:result", resolve);
  roomA.send("map:save", { map });
});
check("map save (kv) succeeds", saveResult.ok === true);

// A friend enrolls as a member through the invite link.
const b = new Client(WS);
const roomB = await b.joinOrCreate("space", {
  spaceId: "durable",
  name: "Bob",
  avatar: "avatar_1",
  idToken: fake("bob@x.com"),
  invite,
});
check("invitee enrolls via link", !!roomB.sessionId);
roomB.onMessage("proximity", () => {});
roomB.onMessage("chat:history", () => {});

await roomA.leave();
await roomB.leave();
await stopServer(s1.child);

// ================= phase 2: fresh process = redeploy =================
const s2 = await startServer();

// The saved map edit is back.
const c = new Client(WS);
const roomC = await c.joinOrCreate("space", {
  spaceId: "durable",
  name: "Alice",
  avatar: "avatar_0",
  idToken: fake("alice@x.com"),
});
check("owner rejoins after restart (membership kept)", !!roomC.sessionId);
roomC.onMessage("proximity", () => {});
roomC.onMessage("chat:history", () => {});
await sleep(300);
const map2 = JSON.parse(roomC.state.mapJson);
check("map edit survived the restart", map2.layers.floor[0] === 5);

// The enrolled member gets in with no invite at all.
const d = new Client(WS);
let bobOk = true;
try {
  const roomD = await d.joinOrCreate("space", {
    spaceId: "durable",
    name: "Bob",
    avatar: "avatar_1",
    idToken: fake("bob@x.com"),
  });
  roomD.onMessage("proximity", () => {});
  await roomD.leave();
} catch {
  bobOk = false;
}
check("member re-enters after restart without invite", bobOk);

// The old invite link still admits a guest (secret persisted).
const e = new Client(WS);
let guestOk = true;
try {
  const roomE = await e.joinOrCreate("space", {
    spaceId: "durable",
    name: "Guest",
    avatar: "avatar_2",
    guest: true,
    invite,
  });
  roomE.onMessage("proximity", () => {});
  await roomE.leave();
} catch {
  guestOk = false;
}
check("old invite link still works for guests after restart", guestOk);

// A stranger is still locked out.
const f = new Client(WS);
let strangerMsg = "";
try {
  await f.joinOrCreate("space", {
    spaceId: "durable",
    name: "Mallory",
    avatar: "avatar_3",
    idToken: fake("mallory@x.com"),
  });
} catch (err) {
  strangerMsg = String(err.message ?? err);
}
check(`stranger still rejected (${strangerMsg})`, strangerMsg.includes("not_invited"));

// The workspace gallery API lists the saved spaces with roles.
const listA = await fetch(`${HTTP}/api/spaces`, {
  headers: { Authorization: `Bearer ${fake("alice@x.com")}` },
}).then((r) => r.json());
const durable = listA.find((s) => s.spaceId === "durable");
check(
  "gallery lists owner role + members",
  durable?.role === "owner" && durable?.members === 2
);
const listB = await fetch(`${HTTP}/api/spaces`, {
  headers: { Authorization: `Bearer ${fake("bob@x.com")}` },
}).then((r) => r.json());
check(
  "gallery lists member role for invitee",
  listB.find((s) => s.spaceId === "durable")?.role === "member"
);

await roomC.leave();
await stopServer(s2.child);
kv.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
