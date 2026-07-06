import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MAX_CLIENTS } from "@gather/shared";
import { SpaceRoom } from "./rooms/SpaceRoom";
import {
  authEnabled,
  googleClientId,
  googleClientIdsByOrigin,
  verifyIdToken,
} from "./auth/google";
import { spacesFor } from "./auth/registry";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(HERE, "../../client/dist");
const PORT = Number(process.env.PORT ?? 2567);

const app = express();
// Dev: the Vite client on :5173 does cross-origin matchmaking requests.
app.use(cors());
app.get("/healthz", (_req, res) => res.send("ok"));

// Client bootstrap: whether sign-in is required and with which OAuth client.
// Served from here so only the server env needs the Google client id.
app.get("/api/config", (req, res) => {
  // Same-origin GETs may omit the Origin header, so the per-origin map is
  // included for the client to resolve against its own location.origin.
  const origin = (req.headers.origin ?? "").replace(/\/+$/, "");
  res.json({
    auth: authEnabled,
    googleClientId: googleClientIdsByOrigin[origin] ?? googleClientId,
    googleClientIds: googleClientIdsByOrigin,
  });
});

// Workspaces for the join screen. With auth enabled this lists the caller's
// memberships (registry) merged with live player counts; open mode keeps
// the original list-all-active-rooms behavior.
app.get("/api/spaces", async (req, res) => {
  const rooms = await matchMaker.query({ name: "space" });
  const byId = new Map(
    rooms.map((r) => [
      (r.metadata as { spaceId?: string } | undefined)?.spaceId ?? "",
      r,
    ])
  );
  if (!authEnabled) {
    res.json(
      rooms.map((r) => ({
        spaceId: (r.metadata as { spaceId?: string } | undefined)?.spaceId ?? "",
        clients: r.clients,
        maxClients: r.maxClients,
      }))
    );
    return;
  }
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  let email: string;
  try {
    email = (await verifyIdToken(token)).email;
  } catch {
    res.status(401).json({ error: "sign_in_required" });
    return;
  }
  res.json(
    spacesFor(email).map((spaceId) => {
      const room = byId.get(spaceId);
      return {
        spaceId,
        clients: room?.clients ?? 0,
        maxClients: room?.maxClients ?? MAX_CLIENTS,
      };
    })
  );
});

// Production: serve the built client + SPA fallback for /space/* routes.
app.use(express.static(CLIENT_DIST));
app.get(["/", "/space/:id"], (_req, res) => {
  res.sendFile(path.join(CLIENT_DIST, "index.html"), (err) => {
    if (err) res.status(404).send("client not built — run `pnpm build`");
  });
});

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({
    server,
    // WebRTC SDP relays and full map:save payloads exceed ws's small
    // default maxPayload, and ws hard-closes the socket when a frame
    // does — which drops the player mid-session.
    maxPayload: 1024 * 1024,
  }),
});

gameServer.define("space", SpaceRoom).filterBy(["spaceId"]);

server.listen(PORT, () => {
  console.log(`gather server listening on :${PORT}`);
});
