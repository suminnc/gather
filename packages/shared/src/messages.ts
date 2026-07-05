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

export type ChatScope = "nearby" | "everyone";

export interface ChatSendMessage {
  scope: ChatScope;
  text: string;
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
  // server -> client
  proximity: "proximity",
  rtcRelay: "rtc:relay",
  chatNew: "chat:new",
  chatHistory: "chat:history",
  screenAnnounceRelay: "screen:announce:relay",
  screenStopRelay: "screen:stop:relay",
  mapSaveResult: "map:save:result",
} as const;
