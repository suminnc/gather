// E2E check for invite-only access. Run:
//   AUTH_DEV_FAKE=1 DATA_DIR=/tmp/gather-test pnpm --filter @gather/server dev
//   node packages/client/scripts/invite-test.mjs
// Needs a FRESH server (empty DATA_DIR, freshly started -- the membership
// registry is held in memory), otherwise earlier runs make members persist.
import { Client } from "colyseus.js";

const WS = "ws://localhost:2567";
const HTTP = "http://localhost:2567";
const fake = (email) => `fake:${JSON.stringify({ email })}`;

let pass = 0;
let fail = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  ok ? pass++ : fail++;
};

// 1. First authenticated joiner creates + owns the space.
const a = new Client(WS);
const roomA = await a.joinOrCreate("space", {
  spaceId: "sekrit",
  name: "Alice",
  avatar: "avatar_0",
  idToken: fake("alice@x.com"),
});
check("owner joins new space", !!roomA.sessionId);

// 2. Owner receives an invite token on join.
const invite = await new Promise((resolve) => {
  roomA.onMessage("invite:token", (m) => resolve(m.token));
  setTimeout(() => resolve(null), 3000);
});
check("owner receives invite token", typeof invite === "string");

// 3. Signed-in stranger without an invite is rejected.
const b = new Client(WS);
let msg = "";
try {
  await b.joinOrCreate("space", {
    spaceId: "sekrit",
    name: "Bob",
    avatar: "avatar_1",
    idToken: fake("bob@x.com"),
  });
} catch (e) {
  msg = String(e.message ?? e);
}
check(`stranger rejected (${msg})`, msg.includes("not_invited"));

// 4. Join without any token is rejected.
msg = "";
try {
  await b.joinOrCreate("space", {
    spaceId: "sekrit",
    name: "Bob",
    avatar: "avatar_1",
  });
} catch (e) {
  msg = String(e.message ?? e);
}
check(`tokenless join rejected (${msg})`, msg.includes("sign_in_required"));

// 5. Invitee with a valid invite token is admitted.
const roomB = await b.joinOrCreate("space", {
  spaceId: "sekrit",
  name: "Bob",
  avatar: "avatar_1",
  idToken: fake("bob@x.com"),
  invite,
});
check("invitee with token admitted", !!roomB.sessionId);
await roomB.leave();

// 6. Now a member, rejoin works with a plain link (no invite).
const roomB2 = await b.joinOrCreate("space", {
  spaceId: "sekrit",
  name: "Bob",
  avatar: "avatar_1",
  idToken: fake("bob@x.com"),
});
check("member rejoins without token", !!roomB2.sessionId);

// 7. Forged invite token is rejected.
msg = "";
try {
  await new Client(WS).joinOrCreate("space", {
    spaceId: "sekrit",
    name: "Eve",
    avatar: "avatar_2",
    idToken: fake("eve@x.com"),
    invite: `${Date.now() + 9999999}.ZGVhZGJlZWY`,
  });
} catch (e) {
  msg = String(e.message ?? e);
}
check(`forged invite rejected (${msg})`, msg.includes("not_invited"));

// 8. Guest with a valid invite is admitted, but gets no invite token and
//    is not enrolled as a member.
const g = new Client(WS);
const roomG = await g.joinOrCreate("space", {
  spaceId: "sekrit",
  name: "Gus",
  avatar: "avatar_3",
  guest: true,
  invite,
});
check("guest with invite admitted", !!roomG.sessionId);
const guestToken = await new Promise((resolve) => {
  roomG.onMessage("invite:token", (m) => resolve(m.token));
  setTimeout(() => resolve(null), 1500);
});
check("guest receives no invite token", guestToken === null);
await roomG.leave();
msg = "";
try {
  await g.joinOrCreate("space", {
    spaceId: "sekrit",
    name: "Gus",
    avatar: "avatar_3",
    guest: true,
  });
} catch (e) {
  msg = String(e.message ?? e);
}
check(
  `guest not enrolled: rejoin without invite rejected (${msg})`,
  msg.includes("not_invited")
);

// 9. Guest cannot create a workspace.
msg = "";
try {
  await g.joinOrCreate("space", {
    spaceId: "guest-town",
    name: "Gus",
    avatar: "avatar_3",
    guest: true,
  });
} catch (e) {
  msg = String(e.message ?? e);
}
check(`guest cannot create space (${msg})`, msg.includes("sign_in_to_create"));

// 10. Listing is membership-filtered and requires auth.
const list = async (email) => {
  const res = await fetch(`${HTTP}/api/spaces`, {
    headers: email ? { Authorization: `Bearer ${fake(email)}` } : {},
  });
  return { status: res.status, body: res.ok ? await res.json() : null };
};
const la = await list("alice@x.com");
check(
  "owner sees space in listing with live count",
  // Alice and Bob are both connected at this point.
  la.body?.some((s) => s.spaceId === "sekrit" && s.clients === 2)
);
const le = await list("eve@x.com");
check(
  "stranger's listing excludes the space",
  Array.isArray(le.body) && !le.body.some((s) => s.spaceId === "sekrit")
);
const ln = await list(null);
check("unauthenticated listing gets 401", ln.status === 401);

// 9. Config endpoint reports auth mode.
const cfg = await fetch(`${HTTP}/api/config`).then((r) => r.json());
check("config reports auth enabled", cfg.auth === true);

await roomA.leave();
await roomB2.leave();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
