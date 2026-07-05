import type { ProximityMessage, RtcData, RtcRelayMessage } from "@gather/shared";
import {
  removePeerMedia,
  setPeerMedia,
  useStore,
  type PeerMedia,
} from "../store";

export interface Signaling {
  rtc(to: string, data: RtcData): void;
  mediaState(micOn: boolean, camOn: boolean): void;
  screenAnnounce(streamId: string): void;
  screenStop(): void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

interface PeerConn {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** All remote MediaStreams received on this connection, by stream id. */
  streams: Map<string, MediaStream>;
}

/**
 * Full-mesh WebRTC manager. The server's proximity ticks decide who is
 * linked; each link is one RTCPeerConnection negotiated with the MDN
 * "perfect negotiation" pattern (politeness by session-id order).
 */
export class PeerManager {
  private conns = new Map<string, PeerConn>();
  /** peerId -> announced screen-share MediaStream id (kept across relinks). */
  private screenIds = new Map<string, string>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;

  constructor(
    private myId: string,
    private signal: Signaling
  ) {}

  /** Request cam+mic. Joining works without media if the user denies. */
  async initMedia(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 },
        audio: true,
      });
      this.localStream = stream;
      for (const conn of this.conns.values()) {
        for (const track of stream.getTracks()) conn.pc.addTrack(track, stream);
      }
      useStore.setState((s) => ({
        localStream: stream,
        media: { ...s.media, hasMedia: true, micOn: true, camOn: true },
      }));
      this.signal.mediaState(true, true);
    } catch {
      useStore.setState((s) => ({
        media: { ...s.media, hasMedia: false, micOn: false, camOn: false },
      }));
      this.signal.mediaState(false, false);
    }
  }

  onProximity(msg: ProximityMessage): void {
    for (const id of msg.added) this.ensureConn(id);
    for (const id of msg.removed) this.closeConn(id);
  }

  onPeerLeft(id: string): void {
    this.closeConn(id);
    this.screenIds.delete(id);
  }

  onScreenAnnounce(from: string, streamId: string): void {
    this.screenIds.set(from, streamId);
    this.refreshPeer(from);
  }

  onScreenStop(from: string): void {
    this.screenIds.delete(from);
    this.refreshPeer(from);
  }

  async onRtcRelay(msg: RtcRelayMessage): Promise<void> {
    // An offer can beat our own proximity notification; link on demand.
    const conn = this.conns.get(msg.from) ?? this.ensureConn(msg.from);
    const { pc } = conn;
    try {
      if (msg.data.description) {
        const desc = msg.data.description as RTCSessionDescriptionInit;
        const collision =
          desc.type === "offer" &&
          (conn.makingOffer || pc.signalingState !== "stable");
        conn.ignoreOffer = !conn.polite && collision;
        if (conn.ignoreOffer) return;
        await pc.setRemoteDescription(desc);
        if (desc.type === "offer") {
          await pc.setLocalDescription();
          this.signal.rtc(msg.from, {
            description: pc.localDescription!.toJSON(),
          });
        }
      } else if (msg.data.candidate !== undefined) {
        try {
          await pc.addIceCandidate(
            (msg.data.candidate as RTCIceCandidateInit | null) ?? undefined
          );
        } catch (err) {
          if (!conn.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error(`rtc negotiation with ${msg.from} failed:`, err);
    }
  }

  setMic(on: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = on));
    useStore.setState((s) => ({ media: { ...s.media, micOn: on } }));
    const m = useStore.getState().media;
    this.signal.mediaState(m.micOn, m.camOn);
  }

  setCam(on: boolean): void {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = on));
    useStore.setState((s) => ({ media: { ...s.media, camOn: on } }));
    const m = useStore.getState().media;
    this.signal.mediaState(m.micOn, m.camOn);
  }

  async startScreenShare(): Promise<void> {
    if (this.screenStream) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch {
      return; // user cancelled the picker
    }
    this.screenStream = stream;
    for (const conn of this.conns.values()) {
      for (const track of stream.getTracks()) conn.pc.addTrack(track, stream);
    }
    this.signal.screenAnnounce(stream.id);
    useStore.setState((s) => ({
      screenStream: stream,
      media: { ...s.media, sharing: true },
    }));
    // Browser "stop sharing" bar ends the track without our UI.
    stream.getVideoTracks()[0].addEventListener("ended", () =>
      this.stopScreenShare()
    );
  }

  stopScreenShare(): void {
    const stream = this.screenStream;
    if (!stream) return;
    this.screenStream = null;
    const tracks = new Set(stream.getTracks());
    for (const conn of this.conns.values()) {
      for (const sender of conn.pc.getSenders()) {
        if (sender.track && tracks.has(sender.track)) {
          conn.pc.removeTrack(sender);
        }
      }
    }
    for (const track of tracks) track.stop();
    this.signal.screenStop();
    useStore.setState((s) => ({
      screenStream: null,
      media: { ...s.media, sharing: false },
    }));
  }

  destroy(): void {
    for (const id of Array.from(this.conns.keys())) this.closeConn(id);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.screenStream = null;
  }

  private ensureConn(id: string): PeerConn {
    const existing = this.conns.get(id);
    if (existing) return existing;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const conn: PeerConn = {
      pc,
      polite: this.myId < id,
      makingOffer: false,
      ignoreOffer: false,
      streams: new Map(),
    };
    this.conns.set(id, conn);

    for (const stream of [this.localStream, this.screenStream]) {
      if (!stream) continue;
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
    }

    pc.onnegotiationneeded = async () => {
      try {
        conn.makingOffer = true;
        await pc.setLocalDescription();
        this.signal.rtc(id, { description: pc.localDescription!.toJSON() });
      } catch (err) {
        console.error(`rtc offer to ${id} failed:`, err);
      } finally {
        conn.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      this.signal.rtc(id, {
        candidate: candidate
          ? (candidate.toJSON() as Record<string, unknown>)
          : null,
      });
    };
    pc.ontrack = ({ streams }) => {
      for (const stream of streams) {
        conn.streams.set(stream.id, stream);
        stream.addEventListener("removetrack", () => {
          if (stream.getTracks().length === 0) {
            conn.streams.delete(stream.id);
            this.refreshPeer(id);
          }
        });
      }
      this.refreshPeer(id);
    };

    this.refreshPeer(id);
    return conn;
  }

  private closeConn(id: string): void {
    const conn = this.conns.get(id);
    if (!conn) return;
    this.conns.delete(id);
    conn.pc.onnegotiationneeded = null;
    conn.pc.onicecandidate = null;
    conn.pc.ontrack = null;
    conn.pc.close();
    removePeerMedia(id);
  }

  /** Recompute the peer's cam/screen streams for the video dock. */
  private refreshPeer(id: string): void {
    const conn = this.conns.get(id);
    if (!conn) return;
    const screenId = this.screenIds.get(id);
    const media: PeerMedia = { camStream: null, screenStream: null };
    for (const stream of conn.streams.values()) {
      if (screenId && stream.id === screenId) media.screenStream = stream;
      else media.camStream = stream;
    }
    setPeerMedia(id, media);
  }
}
