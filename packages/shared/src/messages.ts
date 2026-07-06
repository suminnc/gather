import type { MapDoc } from "./mapTypes";

export type Direction = "up" | "down" | "left" | "right";

/** client -> server */
export interface MoveMessage {
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
}

export interface MediaStateMessage {
  micOn: boolean;
  camOn: boolean;
}

export type ChatScope = "nearby" | "everyone" | "dm";

export interface ChatSendMessage {
  scope: ChatScope;
  text: string;
  /** DM target sessionId (required when scope is "dm"). */
  to?: string;
}

/**
 * Relayed WebRTC signaling payload (perfect negotiation). Structural types so
 * the server (no DOM lib) can typecheck; the client narrows them to
 * RTCSessionDescriptionInit / RTCIceCandidateInit.
 */
export interface RtcData {
  description?: { type: string; sdp?: string };
  candidate?: Record<string, unknown> | null;
}

export interface RtcSendMessage {
  to: string;
  data: RtcData;
}

export interface ScreenAnnounceMessage {
  streamId: string;
}

export interface MapSaveMessage {
  map: MapDoc;
}

export interface DoorToggleMessage {
  x: number;
  y: number;
}

export interface KartMountMessage {
  kartId: string;
}

/** Watch-together control, applied to the sender's current theater zone. */
export interface TheaterMessage {
  action: "set" | "play" | "pause" | "stop";
  /** YouTube video id (for "set"). */
  videoId?: string;
  /** Playback position for play/pause. */
  timeMs?: number;
}

/** server -> client */
export interface ProximityMessage {
  added: string[];
  removed: string[];
}

export interface RtcRelayMessage {
  from: string;
  data: RtcData;
}

export interface ChatMessage {
  id: string;
  from: string;
  fromName: string;
  scope: ChatScope;
  text: string;
  ts: number;
  /** DM recipient (sessionId), present when scope is "dm". */
  to?: string;
  toName?: string;
}

export interface ScreenAnnounceRelay {
  from: string;
  streamId: string;
}

export interface ScreenStopRelay {
  from: string;
}

export const MSG = {
  // client -> server
  move: "move",
  mediaState: "media:state",
  chatSend: "chat:send",
  rtc: "rtc",
  screenAnnounce: "screen:announce",
  screenStop: "screen:stop",
  mapSave: "map:save",
  theater: "theater",
  doorToggle: "door:toggle",
  kartMount: "kart:mount",
  kartDismount: "kart:dismount",
  // server -> client
  proximity: "proximity",
  rtcRelay: "rtc:relay",
  chatNew: "chat:new",
  chatHistory: "chat:history",
  screenAnnounceRelay: "screen:announce:relay",
  screenStopRelay: "screen:stop:relay",
  mapSaveResult: "map:save:result",
  /** Sent to each member on join so the Invite button can build a link. */
  inviteToken: "invite:token",
} as const;
