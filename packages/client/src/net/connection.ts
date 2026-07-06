import { Client, getStateCallbacks, type Room } from "colyseus.js";
import {
  MSG,
  type ChatMessage,
  type ChatScope,
  type Direction,
  type MapDoc,
  type ProximityMessage,
  type RtcRelayMessage,
  type ScreenAnnounceRelay,
  type ScreenStopRelay,
} from "@gather/shared";
import {
  pushChat,
  removePlayer,
  setChatHistory,
  setMap,
  showEditorToast,
  updatePlayer,
  useStore,
  exitEditor,
} from "../store";
import { PeerManager } from "../rtc/PeerManager";

let room: Room | null = null;
export let peers: PeerManager | null = null;

// Where the game server lives. Priority: explicit VITE_SERVER_URL (set
// when the client is hosted separately, e.g. Vercel + Render server),
// then the :2567 dev server, then same-origin (single-server deploys).
const httpBase = (
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  (import.meta.env.DEV ? `http://${location.hostname}:2567` : "")
).replace(/\/+$/, "");

export interface SpaceListing {
  spaceId: string;
  clients: number;
  maxClients: number;
}

export interface ServerConfig {
  auth: boolean;
  googleClientId: string;
}

export async function fetchConfig(): Promise<ServerConfig> {
  const res = await fetch(`${httpBase}/api/config`);
  if (!res.ok) throw new Error(`config failed: ${res.status}`);
  return (await res.json()) as ServerConfig;
}

export async function fetchSpaces(idToken?: string): Promise<SpaceListing[]> {
  const res = await fetch(`${httpBase}/api/spaces`, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
  if (res.status === 401) throw new Error("401");
  if (!res.ok) throw new Error(`spaces listing failed: ${res.status}`);
  return (await res.json()) as SpaceListing[];
}

// A backgrounded tab tears down its connection (see onPageHide below), so
// someone who joins, then switches apps to send the invite link, silently
// vanishes from the space. When the tab becomes visible again, reload
// through ?rejoin=1 — the join screen auto-joins, and a fresh page load
// guarantees clean Phaser/store state.
let hasJoined = false;
let rejoinHooked = false;

function armAutoRejoin(): void {
  if (rejoinHooked) return;
  rejoinHooked = true;
  const maybeRejoin = () => {
    if (document.visibilityState !== "visible") return;
    if (!hasJoined || useStore.getState().connected) return;
    location.replace(`${location.pathname}?rejoin=1`);
  };
  document.addEventListener("resume", maybeRejoin);
  document.addEventListener("visibilitychange", maybeRejoin);
  window.addEventListener("pageshow", maybeRejoin);
}

export async function connect(
  spaceId: string,
  name: string,
  avatar: string,
  auth?: { idToken?: string; invite?: string }
): Promise<void> {
  const endpoint = (httpBase || location.origin).replace(/^http/, "ws");
  const client = new Client(endpoint);
  const r = await client.joinOrCreate("space", {
    spaceId,
    name,
    avatar,
    idToken: auth?.idToken,
    invite: auth?.invite,
  });
  room = r;

  const manager = new PeerManager(r.sessionId, {
    rtc: (to, data) => r.send(MSG.rtc, { to, data }),
    mediaState: (micOn, camOn) => r.send(MSG.mediaState, { micOn, camOn }),
    screenAnnounce: (streamId) => r.send(MSG.screenAnnounce, { streamId }),
    screenStop: () => r.send(MSG.screenStop),
  });
  peers = manager;
  if (import.meta.env.DEV) (window as any).__peers = manager;

  // The client has no schema classes; state arrives via reflection, so the
  // callback proxy and state are used untyped.
  const $ = getStateCallbacks(r) as unknown as (obj: unknown) => any;
  const state = r.state as any;

  $(state).players.onAdd((p: any, id: string) => {
    const sync = () =>
      updatePlayer(id, {
        name: p.name,
        avatar: p.avatar,
        x: p.x,
        y: p.y,
        dir: p.dir as Direction,
        moving: p.moving,
        zoneId: p.zoneId,
        micOn: p.micOn,
        camOn: p.camOn,
        sharing: p.sharing,
      });
    $(p).onChange(sync);
    sync();
  });
  $(state).players.onRemove((_p: any, id: string) => {
    removePlayer(id);
    manager.onPeerLeft(id);
  });

  // mapJson only changes on join/save; the decoded string keeps its identity
  // between patches, so a reference check keeps this cheap.
  let lastMapJson = "";
  const syncMap = () => {
    if (state.mapJson && state.mapJson !== lastMapJson) {
      lastMapJson = state.mapJson;
      setMap(JSON.parse(state.mapJson) as MapDoc);
    }
  };
  r.onStateChange(syncMap);
  syncMap();

  r.onMessage(MSG.proximity, (m: ProximityMessage) => manager.onProximity(m));
  r.onMessage(MSG.rtcRelay, (m: RtcRelayMessage) => void manager.onRtcRelay(m));
  r.onMessage(MSG.chatNew, (m: ChatMessage) => pushChat(m));
  r.onMessage(MSG.chatHistory, (ms: ChatMessage[]) => setChatHistory(ms));
  r.onMessage(MSG.screenAnnounceRelay, (m: ScreenAnnounceRelay) =>
    manager.onScreenAnnounce(m.from, m.streamId)
  );
  r.onMessage(MSG.screenStopRelay, (m: ScreenStopRelay) =>
    manager.onScreenStop(m.from)
  );
  r.onMessage(MSG.inviteToken, (m: { token: string }) => {
    useStore.setState({ inviteToken: m.token });
  });
  r.onMessage(MSG.mapSaveResult, (m: { ok: boolean; error?: string }) => {
    if (m.ok) {
      showEditorToast("Map saved");
      exitEditor();
    } else {
      showEditorToast(`Save failed: ${m.error ?? "unknown error"}`);
    }
  });

  // Closing/refreshing the tab must leave the room immediately so other
  // players don't see a ghost. Also force-close the socket: a frozen
  // (bfcached/hidden) page keeps its WebSocket alive and answers pings
  // at the network layer, so the server would never reap it.
  const onPageHide = () => {
    manager.destroy();
    void r.leave(true);
    try {
      (r as unknown as { connection?: { close?: () => void } }).connection?.close?.();
    } catch {
      // already closed
    }
  };
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("freeze", onPageHide);

  r.onLeave(() => {
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("freeze", onPageHide);
    useStore.setState({ connected: false });
    manager.destroy();
  });

  useStore.setState({ connected: true, sessionId: r.sessionId, spaceId });
  hasJoined = true;
  armAutoRejoin();

  // Fire-and-forget: the permission prompt shouldn't block entering the
  // space; tracks are added to existing connections once granted.
  void manager.initMedia();
}

export function sendMove(
  x: number,
  y: number,
  dir: Direction,
  moving: boolean
): void {
  room?.send(MSG.move, { x, y, dir, moving });
}

export function sendChat(scope: ChatScope, text: string): void {
  room?.send(MSG.chatSend, { scope, text });
}

export function sendMapSave(map: MapDoc): void {
  room?.send(MSG.mapSave, { map });
}
