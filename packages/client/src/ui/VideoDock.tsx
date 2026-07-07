import { useEffect, useRef } from "react";
import { CONNECT_DIST, DISCONNECT_DIST } from "@gather/shared";
import { useStore, type PlayerInfo } from "../store";

function StreamView({
  stream,
  muted,
  mirrored,
  volume = 1,
}: {
  stream: MediaStream;
  muted: boolean;
  mirrored?: boolean;
  volume?: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    // Autoplay can be denied despite the attribute (e.g. stale user
    // activation); retry explicitly and again on the next interaction.
    const play = () => el.play().catch(() => {});
    play();
    document.addEventListener("pointerdown", play, { once: true });
    return () => document.removeEventListener("pointerdown", play);
  }, [stream]);
  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={mirrored ? "mirrored" : undefined}
    />
  );
}

/**
 * Gather-style proximity fade: full presence up close, fading linearly
 * until silent right where the server drops the link. Same private zone
 * never fades.
 */
function fadeFactor(me?: PlayerInfo, peer?: PlayerInfo): number {
  if (!me || !peer) return 1;
  if (me.zoneId !== "" && me.zoneId === peer.zoneId) return 1;
  const d = Math.max(Math.abs(me.x - peer.x), Math.abs(me.y - peer.y));
  const fadeStart = CONNECT_DIST - 1;
  if (d <= fadeStart) return 1;
  return Math.max(0, (DISCONNECT_DIST - d) / (DISCONNECT_DIST - fadeStart));
}

export function VideoDock() {
  const localStream = useStore((s) => s.localStream);
  const screenStream = useStore((s) => s.screenStream);
  const media = useStore((s) => s.media);
  const peers = useStore((s) => s.peers);
  const players = useStore((s) => s.players);
  const sessionId = useStore((s) => s.sessionId);
  // Standing in a theater with a video set puts the overlay above this
  // dock; the theaterCams option lifts a compact dock back on top of it.
  const overTheater = useStore((s) => {
    if (!s.theaterCams) return false;
    const zoneId = s.players.get(s.sessionId)?.zoneId ?? "";
    if (!zoneId || !s.theaters.has(zoneId)) return false;
    return s.map?.zones.find((z) => z.id === zoneId)?.kind === "theater";
  });
  const myName = players.get(sessionId)?.name ?? "me";

  const screens = Array.from(peers).filter(([, m]) => m.screenStream);
  const cams = Array.from(peers);

  return (
    <div className={`video-dock ${overTheater ? "over-theater" : ""}`}>
      {media.denied && (
        <div className="media-warning">
          ⚠️ Camera/mic unavailable — check the site permissions in your
          browser, then reload.
        </div>
      )}

      {screenStream && (
        <div className="tile screen">
          <StreamView stream={screenStream} muted />
          <span className="tile-name">🖥️ your screen</span>
        </div>
      )}

      {screens.map(([id, m]) => (
        <div key={`screen-${id}`} className="tile screen">
          <StreamView stream={m.screenStream!} muted />
          <span className="tile-name">
            🖥️ {players.get(id)?.name ?? "guest"}
          </span>
        </div>
      ))}

      <div className="tile">
        {localStream && media.camOn ? (
          <StreamView stream={localStream} muted mirrored />
        ) : (
          <div className="cam-off">{myName.slice(0, 1).toUpperCase()}</div>
        )}
        <span className="tile-name">
          {media.micOn ? "" : "🔇 "}
          {myName} (you)
        </span>
      </div>

      {cams.map(([id, m]) => {
        const p = players.get(id);
        const camOn = (p?.camOn ?? true) && m.camStream;
        const fade = fadeFactor(players.get(sessionId), p);
        return (
          <div
            key={id}
            className="tile"
            style={{ opacity: 0.3 + 0.7 * fade }}
          >
            {/* The cam stream also carries the peer's audio, so it stays
                mounted (hidden) even while their camera is off. */}
            {m.camStream && (
              <div className={camOn ? undefined : "hidden-video"}>
                <StreamView stream={m.camStream} muted={false} volume={fade} />
              </div>
            )}
            {!camOn && (
              <div className="cam-off">
                {(p?.name ?? "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <span className="tile-name">
              {p?.micOn === false ? "🔇 " : ""}
              {p?.name ?? "guest"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
