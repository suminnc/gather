// E2E check for speaker-object room music + custom tile size limits. Run
// against a dev server with the default map (theater zone x3..15,y20..27;
// entrance x16,y23; open outside area around x22,y17):
//   node packages/client/scripts/speaker-test.mjs
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
    spaceId: "speaker-test",
    name,
    avatar: "avatar_0",
  });

const walkTo = async (room, tx, ty) => {
  const me = () => room.state.players.get(room.sessionId);
  let { x, y } = me();
  const step = (nx, ny) =>
    room.send("move", { x: nx, y: ny, dir: "down", moving: true });
  while (y !== ty) { y += Math.sign(ty - y); step(x, y); await sleep(15); }
  while (x !== tx) { x += Math.sign(tx - x); step(x, y); await sleep(15); }
  room.send("move", { x, y, dir: "down", moving: false });
  await sleep(300);
};

const saveMap = async (room, mutate) => {
  const map = JSON.parse(room.state.mapJson);
  mutate(map);
  const result = new Promise((resolve) =>
    room.onMessage("map:save:result", resolve)
  );
  room.send("map:save", { map });
  return await result;
};

const alice = await join("alice");
alice.onMessage("proximity", () => {});
await sleep(400);

// Speakers: one in the open outside area, one inside the theater zone.
const saved = await saveMap(alice, (map) => {
  map.objects.push(
    { id: "spk-out", gid: 26, x: 22, y: 16 },
    { id: "spk-zone", gid: 26, x: 15, y: 23 }
  );
});
check("map with speakers saves", saved.ok === true);
await sleep(300);

// Control the outside speaker from an adjacent tile (same "outside" room).
await walkTo(alice, 22, 17);
alice.send("speaker", {
  id: "spk-out",
  action: "set",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
});
await sleep(300);
let st = alice.state.speakers.get("spk-out");
check("youtube set near speaker", !!st && st.provider === "youtube" && st.key === "dQw4w9WgXcQ" && st.playing);

// Garbage links must be rejected.
alice.send("speaker", { id: "spk-out", action: "set", url: "https://example.com/nope" });
await sleep(300);
st = alice.state.speakers.get("spk-out");
check("invalid url rejected", !!st && st.key === "dQw4w9WgXcQ");

// Spotify links parse into a spotify source.
alice.send("speaker", {
  id: "spk-out",
  action: "set",
  url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
});
await sleep(300);
st = alice.state.speakers.get("spk-out");
check("spotify set accepted", !!st && st.provider === "spotify" && st.key === "track/4uLU6hMCjMI75M1A2tKUQC");

// A second client far away (and in another room) cannot control it.
const bob = await join("bob");
bob.onMessage("proximity", () => {});
await sleep(400);
await walkTo(bob, 12, 23); // inside the theater zone, far from spk-out
bob.send("speaker", { id: "spk-out", action: "stop" });
await sleep(300);
check("far/other-room stop ignored", !!alice.state.speakers.get("spk-out"));

// The zoned speaker can't be driven from just outside its room.
await walkTo(alice, 17, 23);
await walkTo(alice, 16, 23); // entrance tile: adjacent but zoneId ""
alice.send("speaker", {
  id: "spk-zone",
  action: "set",
  url: "https://youtu.be/dQw4w9WgXcQ",
});
await sleep(300);
check("outside-the-room set ignored", !alice.state.speakers.get("spk-zone"));

// From inside the zone (still within reach) it works, and stop clears it.
await walkTo(alice, 14, 23);
alice.send("speaker", {
  id: "spk-zone",
  action: "set",
  url: "https://youtu.be/dQw4w9WgXcQ",
});
await sleep(300);
check("in-room set works", !!alice.state.speakers.get("spk-zone"));
alice.send("speaker", { id: "spk-zone", action: "pause", timeMs: 5000 });
await sleep(300);
st = alice.state.speakers.get("spk-zone");
check("in-room pause works", !!st && st.playing === false && st.timeMs === 5000);
alice.send("speaker", { id: "spk-zone", action: "stop" });
await sleep(300);
check("stop clears state", !alice.state.speakers.get("spk-zone"));

// Removing a playing speaker from the map clears its music.
const saved2 = await saveMap(alice, (map) => {
  map.objects = map.objects.filter((o) => o.id !== "spk-out");
});
await sleep(300);
check("map save cleans removed speaker", saved2.ok === true && !alice.state.speakers.get("spk-out"));

// Custom tile limits: a 64px design fits, an oversized batch is rejected.
const png = "data:image/png;base64," + "A".repeat(2000);
const saved3 = await saveMap(alice, (map) => {
  map.customTiles = [{ gid: 1000, kind: "floor", data: png }];
});
check("custom tile within limits saves", saved3.ok === true);
const huge = "data:image/png;base64," + "A".repeat(30000);
const saved4 = await saveMap(alice, (map) => {
  map.customTiles = Array.from({ length: 20 }, (_, i) => ({
    gid: 1000 + i,
    kind: "floor",
    data: huge,
  }));
});
check("oversized custom tile batch rejected", saved4.ok === false);

console.log(`\n${pass} passed, ${fail} failed`);
await alice.leave();
await bob.leave();
process.exit(fail === 0 ? 0 : 1);
