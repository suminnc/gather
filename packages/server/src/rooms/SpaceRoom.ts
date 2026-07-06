import { Room, Client } from "colyseus";
import { nanoid } from "nanoid";
import {
  CHAT_HISTORY_LIMIT,
  MAX_CLIENTS,
  MSG,
  NEARBY_CHAT_DIST,
  PROXIMITY_TICK_MS,
  zoneAt,
  isWalkable,
  inBounds,
  validateMap,
  type ChatMessage,
  type ChatSendMessage,
  type MapDoc,
  type MediaStateMessage,
  type MoveMessage,
  type RtcSendMessage,
  type ScreenAnnounceMessage,
} from "@gather/shared";
import { Player, SpaceState } from "./schema/SpaceState";
import { computeLinkDiff } from "../logic/proximity";
import { loadMap, saveMap } from "../maps/store";
import { authEnabled, verifyIdToken, type AuthUser } from "../auth/google";
import {
  addMember,
  createInvite,
  ensureSpace,
  getSpace,
  isMember,
  verifyInvite,
} from "../auth/registry";

interface JoinOptions {
  spaceId: string;
  name: string;
  avatar: string;
  idToken?: string;
  invite?: string;
  guest?: boolean;
}

export class SpaceRoom extends Room<SpaceState> {
  maxClients = MAX_CLIENTS;

  private spaceId = "lobby";
  private map!: MapDoc;
  private linked = new Set<string>();
  private chatLog: ChatMessage[] = [];

  async onCreate(options: JoinOptions) {
    this.setState(new SpaceState());
    this.spaceId = options.spaceId || "lobby";
    await this.setMetadata({ spaceId: this.spaceId });
    this.map = await loadMap(this.spaceId);
    this.state.mapJson = JSON.stringify(this.map);
    this.state.mapVersion = 1;

    this.onMessage(MSG.move, (client, msg: MoveMessage) =>
      this.handleMove(client, msg)
    );
    this.onMessage(MSG.mediaState, (client, msg: MediaStateMessage) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.micOn = !!msg.micOn;
      p.camOn = !!msg.camOn;
    });
    this.onMessage(MSG.chatSend, (client, msg: ChatSendMessage) =>
      this.handleChat(client, msg)
    );
    this.onMessage(MSG.rtc, (client, msg: RtcSendMessage) => {
      const target = this.clients.find((c) => c.sessionId === msg.to);
      if (!target) return;
      target.send(MSG.rtcRelay, { from: client.sessionId, data: msg.data });
    });
    this.onMessage(MSG.screenAnnounce, (client, msg: ScreenAnnounceMessage) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.sharing = true;
      this.screenStreams.set(client.sessionId, msg.streamId);
      this.broadcast(
        MSG.screenAnnounceRelay,
        { from: client.sessionId, streamId: msg.streamId },
        { except: client }
      );
    });
    this.onMessage(MSG.screenStop, (client) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.sharing = false;
      this.screenStreams.delete(client.sessionId);
      this.broadcast(
        MSG.screenStopRelay,
        { from: client.sessionId },
        { except: client }
      );
    });
    this.onMessage(MSG.mapSave, (client, msg: { map: unknown }) =>
      this.handleMapSave(client, msg)
    );

    this.clock.setInterval(() => this.proximityTick(), PROXIMITY_TICK_MS);
  }

  // Invite-only access: a valid Google identity is required, and the space
  // must either be new (joiner becomes owner), already count the joiner as
  // a member, or the join must carry a valid invite token — which enrolls
  // the joiner as a member so plain links work for them afterward.
  async onAuth(client: Client, options: JoinOptions) {
    if (!authEnabled) return true;
    if (!options.idToken) {
      // Guests hold no identity, so nothing can be remembered: they get in
      // only with a currently-valid invite link, never own or create
      // spaces, and are not enrolled as members.
      if (options.guest) {
        if (!getSpace(this.spaceId)) throw new Error("sign_in_to_create");
        if (options.invite && verifyInvite(this.spaceId, options.invite)) {
          return { guest: true };
        }
        throw new Error("not_invited");
      }
      throw new Error("sign_in_required");
    }
    let user: AuthUser;
    try {
      user = await verifyIdToken(options.idToken);
    } catch {
      throw new Error("sign_in_required");
    }
    const space = getSpace(this.spaceId);
    if (!space) {
      ensureSpace(this.spaceId, user.email);
      return user;
    }
    if (isMember(this.spaceId, user.email)) return user;
    if (options.invite && verifyInvite(this.spaceId, options.invite)) {
      addMember(this.spaceId, user.email);
      return user;
    }
    throw new Error("not_invited");
  }

  onJoin(client: Client, options: JoinOptions) {
    const p = new Player();
    p.name = String(options.name ?? "guest").slice(0, 24) || "guest";
    p.avatar = String(options.avatar ?? "avatar_0");
    const spawn =
      this.map.spawns[Math.floor(Math.random() * this.map.spawns.length)];
    p.x = spawn.x;
    p.y = spawn.y;
    p.zoneId = zoneAt(this.map, p.x, p.y)?.id ?? "";
    this.state.players.set(client.sessionId, p);

    client.send(MSG.chatHistory, this.chatLog);
    // Any member can invite; the tokenized link is what the Invite button
    // copies. Guests can't mint invites, and in open mode (auth disabled)
    // the button falls back to the plain URL.
    const identity = (client as { auth?: { email?: string } }).auth;
    if (authEnabled && identity?.email) {
      client.send(MSG.inviteToken, { token: createInvite(this.spaceId) });
    }
    // Late joiner needs active screen shares to identify incoming tracks.
    for (const [id, other] of this.state.players) {
      if (id !== client.sessionId && other.sharing) {
        const streamId = this.screenStreams.get(id);
        if (streamId) {
          client.send(MSG.screenAnnounceRelay, { from: id, streamId });
        }
      }
    }
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.screenStreams.delete(client.sessionId);
    // Next proximity tick emits the removed links to survivors.
  }

  private screenStreams = new Map<string, string>();

  private handleMove(client: Client, msg: MoveMessage) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const x = Math.trunc(msg.x);
    const y = Math.trunc(msg.y);
    if (!inBounds(this.map, x, y)) return;
    // Teleport guard: client commits one tile at a time.
    if (Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) > 2) return;
    if (!isWalkable(this.map, x, y)) return;
    p.x = x;
    p.y = y;
    p.dir = msg.dir;
    p.moving = !!msg.moving;
    p.zoneId = zoneAt(this.map, x, y)?.id ?? "";
  }

  private handleChat(client: Client, msg: ChatSendMessage) {
    const sender = this.state.players.get(client.sessionId);
    if (!sender) return;
    const text = String(msg.text ?? "").slice(0, 500).trim();
    if (!text) return;
    const scope = msg.scope === "nearby" ? "nearby" : "everyone";
    const chat: ChatMessage = {
      id: nanoid(8),
      from: client.sessionId,
      fromName: sender.name,
      scope,
      text,
      ts: Date.now(),
    };
    if (scope === "everyone") {
      this.chatLog.push(chat);
      if (this.chatLog.length > CHAT_HISTORY_LIMIT) this.chatLog.shift();
      this.broadcast(MSG.chatNew, chat);
      return;
    }
    // Nearby: same zone, or within NEARBY_CHAT_DIST tiles (both outside zones).
    for (const c of this.clients) {
      const p = this.state.players.get(c.sessionId);
      if (!p) continue;
      const near =
        c.sessionId === client.sessionId ||
        (sender.zoneId !== ""
          ? p.zoneId === sender.zoneId
          : p.zoneId === "" &&
            Math.max(Math.abs(p.x - sender.x), Math.abs(p.y - sender.y)) <=
              NEARBY_CHAT_DIST);
      if (near) c.send(MSG.chatNew, chat);
    }
  }

  private async handleMapSave(client: Client, msg: { map: unknown }) {
    if (!validateMap(msg.map)) {
      client.send(MSG.mapSaveResult, { ok: false, error: "invalid map" });
      return;
    }
    this.map = msg.map;
    try {
      await saveMap(this.spaceId, this.map);
    } catch (err) {
      console.error(`map save failed for ${this.spaceId}:`, err);
      client.send(MSG.mapSaveResult, { ok: false, error: "write failed" });
      return;
    }
    // Re-derive zone membership and unstick players inside new walls.
    for (const [, p] of this.state.players) {
      if (!isWalkable(this.map, p.x, p.y)) {
        const spawn = this.map.spawns[0];
        p.x = spawn.x;
        p.y = spawn.y;
      }
      p.zoneId = zoneAt(this.map, p.x, p.y)?.id ?? "";
    }
    this.state.mapJson = JSON.stringify(this.map);
    this.state.mapVersion++;
    client.send(MSG.mapSaveResult, { ok: true });
  }

  private proximityTick() {
    const diff = computeLinkDiff(this.state, this.linked);
    if (diff.added.length === 0 && diff.removed.length === 0) return;

    const perClient = new Map<string, { added: string[]; removed: string[] }>();
    const entry = (id: string) => {
      let e = perClient.get(id);
      if (!e) {
        e = { added: [], removed: [] };
        perClient.set(id, e);
      }
      return e;
    };
    for (const [a, b] of diff.added) {
      entry(a).added.push(b);
      entry(b).added.push(a);
    }
    for (const [a, b] of diff.removed) {
      entry(a).removed.push(b);
      entry(b).removed.push(a);
    }
    for (const [id, payload] of perClient) {
      const c = this.clients.find((cl) => cl.sessionId === id);
      c?.send(MSG.proximity, payload);
    }
  }
}
