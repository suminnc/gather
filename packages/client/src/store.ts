import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { ChatMessage, Direction, MapDoc } from "@gather/shared";

export interface PlayerInfo {
  name: string;
  avatar: string;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  zoneId: string;
  micOn: boolean;
  camOn: boolean;
  sharing: boolean;
}

export interface PeerMedia {
  camStream: MediaStream | null;
  screenStream: MediaStream | null;
}

export type EditorTool =
  | "floor"
  | "wall"
  | "eraseWall"
  | "object"
  | "eraseObject"
  | "zone"
  | "spawn";

export interface PendingZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EditorState {
  active: boolean;
  tool: EditorTool;
  /** Selected tileset gid for the floor/wall/object paint tools. */
  gid: number;
  /** Deep copy of the live map being edited; mutated in place by the scene. */
  draft: MapDoc | null;
  /** Bumped after any draft mutation so React/scene observers refresh. */
  draftRev: number;
  /** Zone rect drawn in the scene, awaiting name/color in the panel. */
  pendingZone: PendingZone | null;
  toast: string | null;
}

export interface MediaState {
  hasMedia: boolean;
  /** getUserMedia failed (permission denied / no device / in use). */
  denied: boolean;
  micOn: boolean;
  camOn: boolean;
  sharing: boolean;
}

interface GatherStore {
  spaceId: string;
  sessionId: string;
  connected: boolean;
  map: MapDoc | null;
  /** Bumped whenever the live map is replaced (join + every editor save). */
  mapRev: number;
  players: Map<string, PlayerInfo>;
  chat: ChatMessage[];
  /** True while a text input has focus, so the scene ignores WASD. */
  typingLock: boolean;
  /** Direction held on the mobile D-pad; null when released. */
  touchDir: Direction | null;
  media: MediaState;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  /** Remote media for currently linked call peers. */
  peers: Map<string, PeerMedia>;
  editor: EditorState;
}

const initialEditor: EditorState = {
  active: false,
  tool: "floor",
  gid: 0,
  draft: null,
  draftRev: 0,
  pendingZone: null,
  toast: null,
};

export const useStore = create<GatherStore>()(
  subscribeWithSelector(
    (): GatherStore => ({
      spaceId: "",
      sessionId: "",
      connected: false,
      map: null,
      mapRev: 0,
      players: new Map(),
      chat: [],
      typingLock: false,
      touchDir: null,
      media: {
        hasMedia: false,
        denied: false,
        micOn: false,
        camOn: false,
        sharing: false,
      },
      localStream: null,
      screenStream: null,
      peers: new Map(),
      editor: initialEditor,
    })
  )
);

export function updatePlayer(id: string, info: PlayerInfo): void {
  useStore.setState((s) => ({ players: new Map(s.players).set(id, info) }));
}

export function removePlayer(id: string): void {
  useStore.setState((s) => {
    const players = new Map(s.players);
    players.delete(id);
    return { players };
  });
}

export function setMap(map: MapDoc): void {
  useStore.setState((s) => ({ map, mapRev: s.mapRev + 1 }));
}

const CHAT_CLIENT_LIMIT = 200;

export function pushChat(msg: ChatMessage): void {
  useStore.setState((s) => ({
    chat: [...s.chat, msg].slice(-CHAT_CLIENT_LIMIT),
  }));
}

export function setChatHistory(msgs: ChatMessage[]): void {
  useStore.setState({ chat: msgs.slice(-CHAT_CLIENT_LIMIT) });
}

export function setPeerMedia(id: string, media: PeerMedia): void {
  useStore.setState((s) => ({ peers: new Map(s.peers).set(id, media) }));
}

export function removePeerMedia(id: string): void {
  useStore.setState((s) => {
    const peers = new Map(s.peers);
    peers.delete(id);
    return { peers };
  });
}

export function patchEditor(patch: Partial<EditorState>): void {
  useStore.setState((s) => ({ editor: { ...s.editor, ...patch } }));
}

export function bumpDraft(): void {
  useStore.setState((s) => ({
    editor: { ...s.editor, draftRev: s.editor.draftRev + 1 },
  }));
}

export function enterEditor(): void {
  const map = useStore.getState().map;
  if (!map) return;
  patchEditor({
    active: true,
    draft: structuredClone(map),
    draftRev: 0,
    pendingZone: null,
    toast: null,
  });
}

export function exitEditor(): void {
  patchEditor({ active: false, draft: null, pendingZone: null });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showEditorToast(text: string): void {
  patchEditor({ toast: text });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => patchEditor({ toast: null }), 3000);
}
