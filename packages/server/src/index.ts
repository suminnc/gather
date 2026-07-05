import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { SpaceRoom } from "./rooms/SpaceRoom";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(HERE, "../../client/dist");
const PORT = Number(process.env.PORT ?? 2567);

const app = express();
// Dev: the Vite client on :5173 does cross-origin matchmaking requests.
app.use(cors());
app.get("/healthz", (_req, res) => res.send("ok"));

// Production: serve the built client + SPA fallback for /space/* routes.
app.use(express.static(CLIENT_DIST));
app.get(["/", "/space/:id"], (_req, res) => {
  res.sendFile(path.join(CLIENT_DIST, "index.html"), (err) => {
    if (err) res.status(404).send("client not built — run `pnpm build`");
  });
});

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define("space", SpaceRoom).filterBy(["spaceId"]);

server.listen(PORT, () => {
  console.log(`gather server listening on :${PORT}`);
});
