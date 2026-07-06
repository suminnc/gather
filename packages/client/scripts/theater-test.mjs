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

await a.leave();
await b.leave();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
