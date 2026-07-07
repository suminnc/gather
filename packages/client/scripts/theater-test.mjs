// E2E check for the watch-together theater. Run against a dev server with
// the default map (zone "theater" spans x3..15, y20..27; entrance x16,y23):
//   node packages/client/scripts/theater-test.mjs
import { Client } from "colyseus.js";

const WS = "ws://localhost:2567";

let pass = 0;
let fail = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const join = async (name) =>
  new Client(WS).joinOrCreate("space", {
    spaceId: "theater-test",
    name,
    avatar: "avatar_0",
  });

const walkTo = async (room, tx, ty) => {
  const me = () => room.state.players.get(room.sessionId);
  let { x, y } = me();
  const step = (nx, ny) => room.send("move", { x: nx, y: ny, dir: "down", moving: true });
  while (y !== ty) { y += Math.sign(ty - y); step(x, y); await sleep(15); }
  while (x !== tx) { x += Math.sign(tx - x); step(x, y); await sleep(15); }
  room.send("move", { x, y, dir: "down", moving: false });
  await sleep(300);
  return me();
};

const a = await join("Alice");
const b = await join("Bob");
await sleep(400);

// 1. Theater control from outside the zone is ignored.
a.send("theater", { action: "set", videoId: "M7lc1UVfK4A" });
await sleep(300);
check("set ignored outside theater zone", a.state.theaters.size === 0);

// 2. Walk Alice into the theater (spawn ~20,15 -> entrance x16,y23 -> inside).
let me = await walkTo(a, 17, 23);
me = await walkTo(a, 12, 23);
check(`alice inside theater zone (${me.x},${me.y} zone=${me.zoneId})`, me.zoneId === "theater");

// 3. Set starts playback for the zone.
a.send("theater", { action: "set", videoId: "M7lc1UVfK4A" });
await sleep(300);
let t = a.state.theaters.get("theater");
check("set creates playing state", !!t && t.videoId === "M7lc1UVfK4A" && t.playing === true);

// 4. Bob (outside) sees the same state via sync.
const tb = b.state.theaters.get("theater");
check("state syncs to other clients", !!tb && tb.videoId === "M7lc1UVfK4A");

// 5. Bob outside the zone cannot pause.
b.send("theater", { action: "pause", timeMs: 1000 });
await sleep(300);
check("pause ignored from outside", a.state.theaters.get("theater").playing === true);

// 6. Bob walks in and pauses.
await walkTo(b, 17, 24);
const bme = await walkTo(b, 12, 24);
check(`bob inside zone (${bme.zoneId})`, bme.zoneId === "theater");
b.send("theater", { action: "pause", timeMs: 4000 });
await sleep(300);
t = a.state.theaters.get("theater");
check("pause applies from inside", t.playing === false && t.timeMs === 4000);

// 7. Invalid video ids are rejected.
a.send("theater", { action: "set", videoId: "<script>alert(1)</script>" });
await sleep(300);
check(
  "invalid video id rejected",
  a.state.theaters.get("theater").videoId === "M7lc1UVfK4A"
);

// 8. Stop clears the screen.
a.send("theater", { action: "stop" });
await sleep(300);
check("stop clears state", a.state.theaters.size === 0);

// 9. DM chat: Bob gets it, and it round-trips names.
let dm = null;
b.onMessage("chat:new", (m) => { if (m.scope === "dm") dm = m; });
a.onMessage("chat:new", () => {});
a.send("chat:send", { scope: "dm", text: "secret", to: b.sessionId });
await sleep(300);
check(
  "dm delivered with names",
  dm && dm.text === "secret" && dm.to === b.sessionId && dm.toName === "Bob"
);

// 10. Chairs: parking on a theater seat sits you; stepping off stands you.
me = await walkTo(a, 4, 23); // seat tile (chair gid on default map)
check(`sitting on a chair (${me.x},${me.y})`, me.sitting === true);
me = await walkTo(a, 4, 22);
check("standing after stepping off", me.sitting === false);

// 11. Doors: locking blocks movement through the tile; unlocking restores it.
a.send("door:toggle", { x: 16, y: 23 }); // adjacent? alice is at (4,22) - too far
await sleep(200);
check("far door toggle ignored", a.state.doors.size === 0);
await walkTo(a, 15, 23);
a.send("door:toggle", { x: 16, y: 23 });
await sleep(200);
check("adjacent door locks", a.state.doors.get("16,23") === true);
// Bob (outside at 12,24... walk him to the locked door and try to pass)
await walkTo(b, 17, 23);
const before = { ...b.state.players.get(b.sessionId) };
b.send("move", { x: 16, y: 23, dir: "left", moving: true });
await sleep(200);
const after = b.state.players.get(b.sessionId);
check(
  `locked door blocks (${after.x},${after.y})`,
  after.x === before.x && after.y === before.y
);
a.send("door:toggle", { x: 16, y: 23 });
await sleep(200);
b.send("move", { x: 16, y: 23, dir: "left", moving: true });
await sleep(200);
check("unlocked door passes", b.state.players.get(b.sessionId).x === 16);

// 12. Karts: mount, ride (kart follows), dismount where you stop.
await walkTo(b, 17, 23);
await walkTo(b, 22, 20); // next to kart k1 at (23,20)
b.send("kart:mount", { kartId: "k1" });
await sleep(200);
let kart = b.state.karts.get("k1");
check(
  "kart mounts",
  kart.rider === b.sessionId &&
    b.state.players.get(b.sessionId).riding === "k1"
);
await walkTo(b, 22, 17);
kart = b.state.karts.get("k1");
check(`kart follows rider (${kart.x},${kart.y})`, kart.x === 22 && kart.y === 17);
b.send("kart:dismount");
await sleep(200);
kart = b.state.karts.get("k1");
check(
  "dismount parks kart",
  kart.rider === "" && kart.x === 22 && kart.y === 17 &&
    b.state.players.get(b.sessionId).riding === ""
);
b.send("kart:mount", { kartId: "k2" });
await sleep(200);
check("distant kart mount rejected", b.state.karts.get("k2").rider === "");

// 13. Emotes: relayed to everyone (sender included), invalid index rejected,
// per-player cooldown drops rapid repeats.
const emotesA = [];
const emotesB = [];
a.onMessage("emote:new", (m) => emotesA.push(m));
b.onMessage("emote:new", (m) => emotesB.push(m));
a.send("emote", { emote: 2 });
await sleep(300);
check(
  "emote relayed to sender and others",
  emotesA.some((m) => m.from === a.sessionId && m.emote === 2) &&
    emotesB.some((m) => m.from === a.sessionId && m.emote === 2)
);
b.send("emote", { emote: 99 });
b.send("emote", { emote: -1 });
b.send("emote", { emote: "nope" });
await sleep(300);
check("invalid emote rejected", !emotesA.some((m) => m.from === b.sessionId));
a.send("emote", { emote: 0 });
a.send("emote", { emote: 1 }); // lands within the cooldown window
await sleep(400);
check(
  "emote cooldown drops rapid repeats",
  emotesB.filter((m) => m.from === a.sessionId).length === 2
);

await a.leave();
await b.leave();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
