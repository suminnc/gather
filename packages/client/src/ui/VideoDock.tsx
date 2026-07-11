import { useEffect, useRef, type ReactNode } from "react";
import { CONNECT_DIST, DISCONNECT_DIST } from "@gather/shared";
import {
  setVideoGallery,
  togglePinnedTile,
  useStore,
  type PlayerInfo,
} from "../store";

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

interface TileDef {
  key: string;
  screen: boolean;
  opacity?: number;
  content: ReactNode;
  label: ReactNode;
}

/**
 * Everyone currently in your call, as a corner dock, a full-screen
 * gallery (Zoom-style), or with one tile pinned big in either layout.
 */
export function VideoDock() {
  const localStream = useStore((s) => s.localStream);
  const screenStream = useStore((s) => s.screenStream);
  const media = useStore((s) => s.media);
  const peers = useStore((s) => s.peers);
  const players = useStore((s) => s.players);
  const sessionId = useStore((s) => s.sessionId);
  const gallery = useStore((s) => s.videoGallery);
  const pinned = useStore((s) => s.pinnedTile);
  // Standing in a theater with a video set puts the overlay above this
  // dock; the theaterCams option lifts a compact dock back on top of it.
  const overTheater = useStore((s) => {
    if (!s.theaterCams) return false;
    const zoneId = s.players.get(s.sessionId)?.zoneId ?? "";
    if (!zoneId || !s.theaters.has(zoneId)) return false;
    return s.map?.zones.find((z) => z.id === zoneId)?.kind === "theater";
  });
  const myName = players.get(sessionId)?.name ?? "me";

  useEffect(() => {
    if (!gallery) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVideoGallery(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gallery]);

  const tiles: TileDef[] = [];

  if (screenStream) {
    tiles.push({
      key: "screen:me",
      screen: true,
      content: <StreamView stream={screenStream} muted />,
      label: <>🖥️ your screen</>,
    });
  }
  for (const [id, m] of peers) {
    if (!m.screenStream) continue;
    tiles.push({
      key: `screen:${id}`,
      screen: true,
      content: <StreamView stream={m.screenStream} muted />,
      label: <>🖥️ {players.get(id)?.name ?? "guest"}</>,
    });
  }

  tiles.push({
    key: "cam:me",
    screen: false,
    content:
      localStream && media.camOn ? (
        <StreamView stream={localStream} muted mirrored />
      ) : (
        <div className="cam-off">{myName.slice(0, 1).toUpperCase()}</div>
      ),
    label: (
      <>
        {media.micOn ? "" : "🔇 "}
        {myName} (you)
      </>
    ),
  });

  for (const [id, m] of peers) {
    const p = players.get(id);
    const camOn = (p?.camOn ?? true) && m.camStream;
    const fade = fadeFactor(players.get(sessionId), p);
    tiles.push({
      key: `cam:${id}`,
      screen: false,
      opacity: 0.3 + 0.7 * fade,
      content: (
        <>
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
        </>
      ),
      label: (
        <>
          {p?.micOn === false ? "🔇 " : ""}
          {p?.name ?? "guest"}
        </>
      ),
    });
  }

  // A pin outlives its target (peer left, share stopped): fall back cleanly.
  const activePin = tiles.some((t) => t.key === pinned) ? pinned : null;

  const renderTile = (t: TileDef) => (
    <div
      key={t.key}
      className={`tile ${t.screen ? "screen" : ""} ${
        activePin === t.key ? "pinned" : ""
      }`}
      style={t.opacity !== undefined ? { opacity: t.opacity } : undefined}
    >
      {t.content}
      <span className="tile-name">{t.label}</span>
      <button
        className="tile-pin"
        title={activePin === t.key ? "Unpin" : "Pin (make bigger)"}
        onClick={() => togglePinnedTile(t.key)}
      >
        📌
      </button>
    </div>
  );

  if (gallery) {
    const main = tiles.find((t) => t.key === activePin);
    const rest = main ? tiles.filter((t) => t !== main) : tiles;
    return (
      <div className="video-gallery">
        <div className="gallery-top">
          <span>
            {tiles.filter((t) => !t.screen).length} in call
            {activePin ? " — pinned" : ""}
          </span>
          <button onClick={() => setVideoGallery(false)}>✕ Close</button>
        </div>
        {main ? (
          <>
            <div className="gallery-main">{renderTile(main)}</div>
            {rest.length > 0 && (
              <div className="gallery-strip">{rest.map(renderTile)}</div>
            )}
          </>
        ) : (
          <div className="gallery-grid">{tiles.map(renderTile)}</div>
        )}
      </div>
    );
  }

  const ordered = activePin
    ? [
        ...tiles.filter((t) => t.key === activePin),
        ...tiles.filter((t) => t.key !== activePin),
      ]
    : tiles;

  return (
    <div className={`video-dock ${overTheater ? "over-theater" : ""}`}>
      {media.denied && (
        <div className="media-warning">
          ⚠️ Camera/mic unavailable — check the site permissions in your
          browser, then reload.
        </div>
      )}
      <button
        className="gallery-open"
        title="Gallery view (full screen)"
        onClick={() => setVideoGallery(true)}
      >
        ⛶ Gallery
      </button>
      {ordered.map(renderTile)}
    </div>
  );
}
