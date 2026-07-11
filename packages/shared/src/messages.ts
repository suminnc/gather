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

/** Reaction shown above the sender's head; index into EMOTES. */
export interface EmoteSendMessage {
  emote: number;
}

/** Watch-together control, applied to the sender's current theater zone. */
export interface TheaterMessage {
  action: "set" | "play" | "pause" | "stop";
  /** YouTube video id (for "set"). */
  videoId?: string;
  /** Playback position for play/pause. */
  timeMs?: number;
}

/** Music control for one placed speaker object (by map object id). */
export interface SpeakerMessage {
  id: string;
  action: "set" | "play" | "pause" | "stop";
  /** Pasted music link (for "set"); validated via parseMusicSource. */
  url?: string;
  /** Playback position for play/pause (YouTube only). */
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

export interface EmoteRelayMessage {
  from: string;
  emote: number;
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
  emote: "emote",
  speaker: "speaker",
  // server -> client
  proximity: "proximity",
  rtcRelay: "rtc:relay",
  chatNew: "chat:new",
  chatHistory: "chat:history",
  screenAnnounceRelay: "screen:announce:relay",
  screenStopRelay: "screen:stop:relay",
  emoteRelay: "emote:new",
  mapSaveResult: "map:save:result",
  /** Sent to each member on join so the Invite button can build a link. */
  inviteToken: "invite:token",
} as const;
