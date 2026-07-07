import { useEffect, useRef, useState } from "react";
import { sendTheater } from "../net/connection";
import { setTheaterCams, useStore } from "../store";

/** Accepts a YouTube URL in any common form, or a bare video id. */
function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[a-zA-Z0-9_-]{5,15}$/.test(s)) return s;
  const m =
    s.match(/[?&]v=([a-zA-Z0-9_-]{5,15})/) ??
    s.match(/youtu\.be\/([a-zA-Z0-9_-]{5,15})/) ??
    s.match(/\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{5,15})/);
  return m ? m[1] : null;
}

/**
 * Shown while standing in a theater zone. With a video set it covers the
 * screen with a viewer's-seat room: curtains, glowing screen, and seat
 * silhouettes in front. Walk out of the zone (WASD still works) or
 * minimize to leave the view.
 */
export function TheaterOverlay() {
  const map = useStore((s) => s.map);
  const zoneId = useStore((s) => s.players.get(s.sessionId)?.zoneId ?? "");
  const theater = useStore((s) => s.theaters.get(zoneId));
  const cams = useStore((s) => s.theaterCams);
  const [minimized, setMinimized] = useState(false);
  const [url, setUrl] = useState("");
  const [picking, setPicking] = useState(false);
  // Estimated playback position when the current state arrived.
  const receivedAt = useRef(Date.now());
  useEffect(() => {
    receivedAt.current = Date.now();
  }, [theater]);

  const zone = map?.zones.find((z) => z.id === zoneId);
  if (!zone || zone.kind !== "theater") return null;

  const positionMs = (): number => {
    if (!theater) return 0;
    if (!theater.playing) return theater.timeMs;
    // Prefer server wall-clock (survives late joins); it's within normal
    // NTP skew of the viewer's clock.
    return theater.timeMs + Math.max(0, Date.now() - theater.updatedAt);
  };

  const setVideo = () => {
    const id = parseVideoId(url);
    if (!id) return;
    sendTheater("set", id);
    setUrl("");
    setPicking(false);
    setMinimized(false);
  };

  const urlForm = (
    <div className="theater-form">
      <input
        placeholder="Paste a YouTube link…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onFocus={() => useStore.setState({ typingLock: true })}
        onBlur={() => useStore.setState({ typingLock: false })}
        onKeyDown={(e) => {
          if (e.key === "Enter") setVideo();
        }}
      />
      <button className="primary" onClick={setVideo} disabled={!parseVideoId(url)}>
        Play
      </button>
    </div>
  );

  if (!theater) {
    return (
      <div className="theater-bar">
        <span>🎬 {zone.name}</span>
        {urlForm}
      </div>
    );
  }

  if (minimized) {
    return (
      <button className="theater-bar" onClick={() => setMinimized(false)}>
        🎬 {zone.name} — back to the screen
      </button>
    );
  }

  const startSec = Math.floor(positionMs() / 1000);
  // Native controls stay on: if the browser blocks unmuted autoplay the
  // viewer can just press play (local-only), while the shared state is
  // driven by the buttons below.
  const src =
    `https://www.youtube.com/embed/${theater.videoId}` +
    `?autoplay=${theater.playing ? 1 : 0}&start=${startSec}` +
    `&rel=0&modestbranding=1&playsinline=1`;

  return (
    <div className="theater-overlay">
      <div className="theater-curtain left" />
      <div className="theater-curtain right" />
      <div className="theater-room">
        <div className="theater-screen">
          <iframe
            key={`${theater.videoId}:${theater.playing}:${theater.timeMs}`}
            src={src}
            title="Theater screen"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
        <div className="theater-controls">
          <button
            onClick={() =>
              sendTheater(theater.playing ? "pause" : "play", undefined, positionMs())
            }
          >
            {theater.playing ? "⏸ Pause for everyone" : "▶ Play"}
          </button>
          <button onClick={() => setPicking(!picking)}>Change video</button>
          <button
            onClick={() => setTheaterCams(!cams)}
            title="Show or hide everyone's cameras over the theater"
          >
            {cams ? "🎥 Hide cameras" : "🎥 Show cameras"}
          </button>
          <button onClick={() => sendTheater("stop")}>⏹ End</button>
          <button onClick={() => setMinimized(true)} title="Keep walking around">
            Minimize
          </button>
        </div>
        {picking && urlForm}
        <div className="theater-seats">
          {Array.from({ length: 14 }, (_, i) => (
            <div key={i} className="theater-seat" />
          ))}
        </div>
      </div>
    </div>
  );
}
