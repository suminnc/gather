import { Room, Client } from "colyseus";
import { nanoid } from "nanoid";
import {
  CHAIR_GIDS,
  CHAT_HISTORY_LIMIT,
  DOOR_GID,
  doorInsideZones,
  EMOTES,
  EMOTE_COOLDOWN_MS,
  KART_GID,
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
  type EmoteSendMessage,
  type MapDoc,
  type MediaStateMessage,
  type MoveMessage,
  type RtcSendMessage,
  type ScreenAnnounceMessage,
  type TheaterMessage,
} from "@gather/shared";
import { Kart, Player, SpaceState, TheaterState } from "./schema/SpaceState";
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
    this.onMessage(MSG.theater, (client, msg: TheaterMessage) =>
      this.handleTheater(client, msg)
    );
    this.onMessage(MSG.doorToggle, (client, msg: { x: number; y: number }) =>
      this.handleDoorToggle(client, msg)
    );
    this.onMessage(MSG.kartMount, (client, msg: { kartId: string }) =>
      this.handleKartMount(client, msg)
    );
    this.onMessage(MSG.kartDismount, (client) => this.dismount(client.sessionId));
    this.onMessage(MSG.emote, (client, msg: EmoteSendMessage) =>
      this.handleEmote(client, msg)
    );

    this.resetKarts();

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
    this.dismount(client.sessionId); // leave the kart behind, not in limbo
    this.state.players.delete(client.sessionId);
    this.screenStreams.delete(client.sessionId);
    this.lastEmoteAt.delete(client.sessionId);
    // Next proximity tick emits the removed links to survivors.
  }

  // ---------- chairs / doors / karts ----------

  private chairAt(x: number, y: number): boolean {
    return this.map.objects.some(
      (o) => CHAIR_GIDS.includes(o.gid) && o.x === x && o.y === y
    );
  }

  private doorLockedAt(x: number, y: number): boolean {
    return this.state.doors.get(`${x},${y}`) === true;
  }

  /**
   * Members (or anyone in open mode) can lock/unlock an adjacent door
   * object; guests can walk through unlocked doors but cannot operate
   * the lock. Doors bordering a zone are inside-only: the lock works
   * from within that zone, so outsiders can't unlock a room.
   */
  private handleDoorToggle(client: Client, msg: { x: number; y: number }) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const x = Math.trunc(msg.x);
    const y = Math.trunc(msg.y);
    if (Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) > 1) return;
    const isDoor = this.map.objects.some(
      (o) => o.gid === DOOR_GID && o.x === x && o.y === y
    );
    if (!isDoor) return;
    const inside = doorInsideZones(this.map, x, y);
    if (inside.length > 0 && !inside.includes(p.zoneId)) return;
    const identity = (client as { auth?: { email?: string } | true }).auth;
    const isGuest = typeof identity === "object" && !identity?.email;
    if (isGuest) return;
    const key = `${x},${y}`;
    if (this.state.doors.get(key)) this.state.doors.delete(key);
    else this.state.doors.set(key, true);
  }

  /** Rebuild runtime karts from the map's kart objects. */
  private resetKarts() {
    this.state.karts.clear();
    for (const [, p] of this.state.players) p.riding = "";
    for (const o of this.map.objects) {
      if (o.gid !== KART_GID) continue;
      const kart = new Kart();
      kart.x = o.x;
      kart.y = o.y;
      this.state.karts.set(o.id, kart);
    }
  }

  private handleKartMount(client: Client, msg: { kartId: string }) {
    const p = this.state.players.get(client.sessionId);
    const kart = this.state.karts.get(String(msg.kartId ?? ""));
    if (!p || !kart || kart.rider || p.riding) return;
    if (Math.max(Math.abs(p.x - kart.x), Math.abs(p.y - kart.y)) > 1) return;
    kart.rider = client.sessionId;
    p.riding = String(msg.kartId);
    p.sitting = false;
  }

  private dismount(sessionId: string) {
    const p = this.state.players.get(sessionId);
    if (!p?.riding) return;
    const kart = this.state.karts.get(p.riding);
    if (kart) {
      kart.rider = "";
      kart.x = p.x;
      kart.y = p.y;
    }
    p.riding = "";
  }

  private screenStreams = new Map<string, string>();

  private lastEmoteAt = new Map<string, number>();

  /** Reactions are transient, so they relay as messages, not schema state. */
  private handleEmote(client: Client, msg: EmoteSendMessage) {
    if (!this.state.players.has(client.sessionId)) return;
    const emote = Number(msg?.emote);
    if (!Number.isInteger(emote) || emote < 0 || emote >= EMOTES.length) return;
    const now = Date.now();
    if (now - (this.lastEmoteAt.get(client.sessionId) ?? 0) < EMOTE_COOLDOWN_MS) {
      return;
    }
    this.lastEmoteAt.set(client.sessionId, now);
    this.broadcast(MSG.emoteRelay, { from: client.sessionId, emote });
  }

  private handleMove(client: Client, msg: MoveMessage) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const x = Math.trunc(msg.x);
    const y = Math.trunc(msg.y);
    if (!inBounds(this.map, x, y)) return;
    // Teleport guard: client commits one tile at a time.
    if (Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) > 2) return;
    if (!isWalkable(this.map, x, y)) return;
    if (this.doorLockedAt(x, y)) return;
    p.x = x;
    p.y = y;
    p.dir = msg.dir;
    p.moving = !!msg.moving;
    p.zoneId = zoneAt(this.map, x, y)?.id ?? "";
    p.sitting = !p.riding && !msg.moving && this.chairAt(x, y);
    if (p.riding) {
      const kart = this.state.karts.get(p.riding);
      if (kart) {
        kart.x = x;
        kart.y = y;
      }
    }
  }

  private handleChat(client: Client, msg: ChatSendMessage) {
    const sender = this.state.players.get(client.sessionId);
    if (!sender) return;
    const text = String(msg.text ?? "").slice(0, 500).trim();
    if (!text) return;
    const scope =
      msg.scope === "nearby" || msg.scope === "dm" ? msg.scope : "everyone";
    const chat: ChatMessage = {
      id: nanoid(8),
      from: client.sessionId,
      fromName: sender.name,
      scope,
      text,
      ts: Date.now(),
    };
    if (scope === "dm") {
      const target = this.clients.find((c) => c.sessionId === msg.to);
      const targetPlayer = msg.to ? this.state.players.get(msg.to) : undefined;
      if (!target || !targetPlayer || msg.to === client.sessionId) return;
      chat.to = msg.to;
      chat.toName = targetPlayer.name;
      target.send(MSG.chatNew, chat);
      client.send(MSG.chatNew, chat);
      return;
    }
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
    // Theater playback for zones that no longer exist (or lost the kind)
    // must not linger.
    for (const zoneId of [...this.state.theaters.keys()]) {
      const zone = this.map.zones.find((z) => z.id === zoneId);
      if (!zone || zone.kind !== "theater") this.state.theaters.delete(zoneId);
    }
    // Kart fleet and door locks follow the edited object set.
    this.resetKarts();
    for (const key of [...this.state.doors.keys()]) {
      const [dx, dy] = key.split(",").map(Number);
      const stillDoor = this.map.objects.some(
        (o) => o.gid === DOOR_GID && o.x === dx && o.y === dy
      );
      if (!stillDoor) this.state.doors.delete(key);
    }
    this.state.mapJson = JSON.stringify(this.map);
    this.state.mapVersion++;
    client.send(MSG.mapSaveResult, { ok: true });
  }

  /** Anyone inside a theater zone can drive its shared screen. */
  private handleTheater(client: Client, msg: TheaterMessage) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.zoneId) return;
    const zone = this.map.zones.find((z) => z.id === p.zoneId);
    if (!zone || zone.kind !== "theater") return;

    if (msg.action === "set") {
      const videoId = String(msg.videoId ?? "");
      if (!/^[a-zA-Z0-9_-]{5,15}$/.test(videoId)) return;
      const t = new TheaterState();
      t.videoId = videoId;
      t.playing = true;
      t.timeMs = 0;
      t.updatedAt = Date.now();
      this.state.theaters.set(p.zoneId, t);
      return;
    }
    const t = this.state.theaters.get(p.zoneId);
    if (!t) return;
    if (msg.action === "stop") {
      this.state.theaters.delete(p.zoneId);
      return;
    }
    t.playing = msg.action === "play";
    t.timeMs = Math.max(0, Number(msg.timeMs) || 0);
    t.updatedAt = Date.now();
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
