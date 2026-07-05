import { useEffect, useRef } from "react";
import { useStore } from "../store";

function StreamView({
  stream,
  muted,
  mirrored,
}: {
  stream: MediaStream;
  muted: boolean;
  mirrored?: boolean;
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

export function VideoDock() {
  const localStream = useStore((s) => s.localStream);
  const screenStream = useStore((s) => s.screenStream);
  const media = useStore((s) => s.media);
  const peers = useStore((s) => s.peers);
  const players = useStore((s) => s.players);
  const sessionId = useStore((s) => s.sessionId);
  const myName = players.get(sessionId)?.name ?? "me";

  const screens = Array.from(peers).filter(([, m]) => m.screenStream);
  const cams = Array.from(peers);

  return (
    <div className="video-dock">
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
        return (
          <div key={id} className="tile">
            {/* The cam stream also carries the peer's audio, so it stays
                mounted (hidden) even while their camera is off. */}
            {m.camStream && (
              <div className={camOn ? undefined : "hidden-video"}>
                <StreamView stream={m.camStream} muted={false} />
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
