import { useEffect, useRef, useState } from "react";
import {
  SPEAKER_CONTROL_DIST,
  SPEAKER_GID,
  musicEmbedUrl,
  parseMusicSource,
  zoneAt,
  type MusicSource,
} from "@gather/shared";
import { sendSpeaker } from "../net/connection";
import { useStore, type SpeakerInfo } from "../store";
import { FloatingPanel } from "./FloatingPanel";

const PANEL_W = 360;
const VOL_KEY = "gather:musicVol";

/**
 * One playing speaker's audio. YouTube runs synchronized in a hidden
 * iframe (volume driven over the embed's postMessage API); Spotify /
 * Apple Music only ship embed widgets (no autoplay, seek, or volume),
 * so those render a compact player each listener starts.
 */
function SpeakerAudio({
  id,
  info,
  volume,
}: {
  id: string;
  info: SpeakerInfo;
  volume: number;
}) {
  const src: MusicSource = {
    provider: info.provider as MusicSource["provider"],
    key: info.key,
  };
  const frame = useRef<HTMLIFrameElement>(null);

  const setVolume = (v: number) => {
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func: "setVolume", args: [v] }),
      "*"
    );
  };
  useEffect(() => setVolume(volume), [volume]);

  // The start offset must be captured once per playback state. This
  // component re-renders on every player step (the panel watches your
  // position), and recomputing it from the clock rewrites the iframe src,
  // reloading the player mid-song. Real state changes remount via `key`.
  const [playerUrl] = useState(() => {
    const startSec = Math.floor(
      (info.timeMs + Math.max(0, Date.now() - info.updatedAt)) / 1000
    );
    return `${musicEmbedUrl(src)}?autoplay=1&start=${startSec}&playsinline=1&enablejsapi=1`;
  });

  if (info.provider === "youtube") {
    if (!info.playing) return null;
    return (
      <iframe
        ref={frame}
        className="speaker-audio"
        src={playerUrl}
        title={`Speaker ${id}`}
        allow="autoplay; encrypted-media"
        onLoad={() => {
          // The player accepts commands only once it's ready; nudge the
          // volume a few times instead of loading the whole IFrame API.
          for (const delay of [300, 900, 2000]) {
            setTimeout(() => setVolume(volume), delay);
          }
        }}
      />
    );
  }
  return (
    <iframe
      ref={frame}
      className="speaker-embed"
      src={musicEmbedUrl(src)}
      title={`Speaker ${id}`}
      allow="encrypted-media"
      loading="lazy"
    />
  );
}

/**
 * The room's music window: one movable panel (top-center by default,
 * under the workspace bar) combining now-playing volume, the per-room
 * players, and the controls you get while standing next to a speaker.
 * Everyone in the speaker's room (its zone, or the whole un-zoned
 * outside) hears the music; the volume slider is local to you and only
 * affects music, not voice chat.
 */
export function SpeakerPanel() {
  const map = useStore((s) => s.map);
  const me = useStore((s) => s.players.get(s.sessionId));
  const speakers = useStore((s) => s.speakers);
  const [url, setUrl] = useState("");
  const [vol, setVol] = useState(() => {
    const saved = Number(localStorage.getItem(VOL_KEY));
    return Number.isFinite(saved) && localStorage.getItem(VOL_KEY) !== null
      ? Math.min(100, Math.max(0, saved))
      : 100;
  });

  if (!map || !me) return null;
  const myRoom = me.zoneId ?? "";
  const roomSpeakers = map.objects.filter(
    (o) =>
      o.gid === SPEAKER_GID && (zoneAt(map, o.x, o.y)?.id ?? "") === myRoom
  );
  if (roomSpeakers.length === 0) return null;

  const near = roomSpeakers.find(
    (o) =>
      Math.max(Math.abs(me.x - o.x), Math.abs(me.y - o.y)) <=
      SPEAKER_CONTROL_DIST
  );
  const nearState = near ? speakers.get(near.id) : undefined;
  const playing = roomSpeakers
    .map((o) => ({ id: o.id, info: speakers.get(o.id) }))
    .filter((s): s is { id: string; info: SpeakerInfo } => !!s.info);

  // Nothing to hear and nothing to control: no window.
  if (!near && playing.length === 0) return null;

  const positionMs = (info: SpeakerInfo) =>
    info.playing
      ? info.timeMs + Math.max(0, Date.now() - info.updatedAt)
      : info.timeMs;

  const changeVol = (v: number) => {
    setVol(v);
    localStorage.setItem(VOL_KEY, String(v));
  };

  const setMusic = () => {
    if (!near || !parseMusicSource(url)) return;
    sendSpeaker(near.id, "set", url);
    setUrl("");
  };

  return (
    <FloatingPanel
      id="music"
      className="music-panel"
      defaultRect={{
        x: Math.max(8, Math.round((innerWidth - PANEL_W) / 2)),
        y: 56,
        w: PANEL_W,
      }}
      resizable={false}
    >
      <div className="editor-header fp-drag">
        <span>🎵 Music</span>
        {playing.length > 0 && (
          <div className="music-volume" title="Music volume (just for you)">
            <span>{vol === 0 ? "🔇" : "🔊"}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={vol}
              onChange={(e) => changeVol(Number(e.target.value))}
            />
          </div>
        )}
      </div>

      {playing.map((s) => (
        // Keyed on playback state so real changes (set/play/pause/seek)
        // remount the player and recapture the start offset.
        <SpeakerAudio
          key={`${s.id}:${s.info.key}:${s.info.timeMs}:${s.info.updatedAt}`}
          id={s.id}
          info={s.info}
          volume={vol}
        />
      ))}
      {playing.some((s) => s.info.provider !== "youtube") && (
        <div className="music-hint">
          Spotify / Apple Music can't auto-start — press play on the widget.
        </div>
      )}

      {near ? (
        <div className="speaker-controls">
          <span title="You're next to a speaker">📻</span>
          {nearState ? (
            <>
              {nearState.provider === "youtube" && (
                <button
                  onClick={() =>
                    sendSpeaker(
                      near.id,
                      nearState.playing ? "pause" : "play",
                      undefined,
                      positionMs(nearState)
                    )
                  }
                >
                  {nearState.playing ? "⏸ Pause for room" : "▶ Play"}
                </button>
              )}
              <button onClick={() => sendSpeaker(near.id, "stop")}>⏹ Stop</button>
            </>
          ) : (
            <>
              <input
                placeholder="YouTube / Spotify / Apple Music link…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onFocus={() => useStore.setState({ typingLock: true })}
                onBlur={() => useStore.setState({ typingLock: false })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setMusic();
                  if (e.key === "Escape") e.currentTarget.blur();
                }}
              />
              <button
                className="primary"
                disabled={!parseMusicSource(url)}
                onClick={setMusic}
              >
                Play
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="music-hint">
          🔊 Room music — walk up to the speaker to control it.
        </div>
      )}
    </FloatingPanel>
  );
}
