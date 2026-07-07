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
  sitting: boolean;
  /** Kart id while riding, "" otherwise. */
  riding: string;
}

export interface KartInfo {
  x: number;
  y: number;
  rider: string;
}

export interface PeerMedia {
  camStream: MediaStream | null;
  screenStream: MediaStream | null;
}

export interface TheaterInfo {
  videoId: string;
  playing: boolean;
  timeMs: number;
  /** Server wall-clock when timeMs was captured. */
  updatedAt: number;
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
  /** Joined via "continue as guest": no lock/invite privileges. */
  isGuest: boolean;
  /** Signed token for the Invite button's link; null in guest mode. */
  inviteToken: string | null;
  map: MapDoc | null;
  /** Bumped whenever the live map is replaced (join + every editor save). */
  mapRev: number;
  players: Map<string, PlayerInfo>;
  chat: ChatMessage[];
  /** True while a text input has focus, so the scene ignores WASD. */
  typingLock: boolean;
  /** Vector held on the mobile D-pad ([dx, dy], diagonals allowed). */
  touchVec: [number, number] | null;
  media: MediaState;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  /** Remote media for currently linked call peers. */
  peers: Map<string, PeerMedia>;
  /** zoneId -> shared playback for theater zones. */
  theaters: Map<string, TheaterInfo>;
  /** Keep peer cameras visible on top of the theater overlay. */
  theaterCams: boolean;
  karts: Map<string, KartInfo>;
  /** "x,y" keys of locked door objects. */
  lockedDoors: Set<string>;
  /** sessionId -> latest reaction; seq bumps so repeats retrigger. */
  emotes: Map<string, { emote: number; seq: number }>;
  /** Open-a-DM-thread request from outside the chat panel (People list). */
  dmRequest: string | null;
  /** Camera locate request; seq bumps so repeat clicks retrigger. */
  locate: { id: string; seq: number } | null;
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
      isGuest: false,
      inviteToken: null,
      map: null,
      mapRev: 0,
      players: new Map(),
      chat: [],
      typingLock: false,
      touchVec: null,
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
      theaters: new Map(),
      theaterCams: localStorage.getItem("gather:theaterCams") !== "0",
      karts: new Map(),
      lockedDoors: new Set(),
      emotes: new Map(),
      dmRequest: null,
      locate: null,
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
    const emotes = new Map(s.emotes);
    emotes.delete(id);
    return { players, emotes };
  });
}

let emoteSeq = 0;

export function setEmote(id: string, emote: number): void {
  useStore.setState((s) => ({
    emotes: new Map(s.emotes).set(id, { emote, seq: ++emoteSeq }),
  }));
}

let locateSeq = 0;

export function requestLocate(id: string): void {
  useStore.setState({ locate: { id, seq: ++locateSeq } });
}

export function requestDm(id: string): void {
  useStore.setState({ dmRequest: id });
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

export function setKart(id: string, info: KartInfo): void {
  useStore.setState((s) => ({ karts: new Map(s.karts).set(id, info) }));
}

export function removeKart(id: string): void {
  useStore.setState((s) => {
    const karts = new Map(s.karts);
    karts.delete(id);
    return { karts };
  });
}

export function setDoorLocked(key: string, locked: boolean): void {
  useStore.setState((s) => {
    const lockedDoors = new Set(s.lockedDoors);
    if (locked) lockedDoors.add(key);
    else lockedDoors.delete(key);
    return { lockedDoors };
  });
}

export function setTheaterCams(on: boolean): void {
  localStorage.setItem("gather:theaterCams", on ? "1" : "0");
  useStore.setState({ theaterCams: on });
}

export function setTheater(zoneId: string, info: TheaterInfo): void {
  useStore.setState((s) => ({ theaters: new Map(s.theaters).set(zoneId, info) }));
}

export function removeTheater(zoneId: string): void {
  useStore.setState((s) => {
    const theaters = new Map(s.theaters);
    theaters.delete(zoneId);
    return { theaters };
  });
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
