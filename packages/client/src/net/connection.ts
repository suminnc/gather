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

export async function connect(
  spaceId: string,
  name: string,
  avatar: string
): Promise<void> {
  // Dev: Vite serves the app on :5173 while the game server runs on :2567.
  const endpoint = import.meta.env.DEV
    ? `ws://${location.hostname}:2567`
    : location.origin.replace(/^http/, "ws");
  const client = new Client(endpoint);
  const r = await client.joinOrCreate("space", { spaceId, name, avatar });
  room = r;

  const manager = new PeerManager(r.sessionId, {
    rtc: (to, data) => r.send(MSG.rtc, { to, data }),
    mediaState: (micOn, camOn) => r.send(MSG.mediaState, { micOn, camOn }),
    screenAnnounce: (streamId) => r.send(MSG.screenAnnounce, { streamId }),
    screenStop: () => r.send(MSG.screenStop),
  });
  peers = manager;

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
  r.onMessage(MSG.mapSaveResult, (m: { ok: boolean; error?: string }) => {
    if (m.ok) {
      showEditorToast("Map saved");
      exitEditor();
    } else {
      showEditorToast(`Save failed: ${m.error ?? "unknown error"}`);
    }
  });

  r.onLeave(() => {
    useStore.setState({ connected: false });
    manager.destroy();
  });

  useStore.setState({ connected: true, sessionId: r.sessionId, spaceId });

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
