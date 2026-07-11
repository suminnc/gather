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

/**
 * One playing speaker's audio. YouTube runs synchronized in a hidden
 * iframe; Spotify / Apple Music only ship embed widgets (no autoplay or
 * seek), so those render a compact player each listener starts.
 */
function SpeakerAudio({ id, info }: { id: string; info: SpeakerInfo }) {
  const src: MusicSource = {
    provider: info.provider as MusicSource["provider"],
    key: info.key,
  };
  // Estimated playback position when this state arrived (server clock).
  const receivedAt = useRef(Date.now());
  useEffect(() => {
    receivedAt.current = Date.now();
  }, [info]);

  if (info.provider === "youtube") {
    if (!info.playing) return null;
    const startSec = Math.floor(
      (info.timeMs + Math.max(0, Date.now() - info.updatedAt)) / 1000
    );
    return (
      <iframe
        key={`${info.key}:${info.timeMs}:${info.updatedAt}`}
        className="speaker-audio"
        src={`${musicEmbedUrl(src)}?autoplay=1&start=${startSec}&playsinline=1`}
        title={`Speaker ${id}`}
        allow="autoplay; encrypted-media"
      />
    );
  }
  return (
    <iframe
      className="speaker-embed"
      src={musicEmbedUrl(src)}
      title={`Speaker ${id}`}
      allow="encrypted-media"
      loading="lazy"
    />
  );
}

/**
 * Room music from placed speaker objects. Everyone in the speaker's room
 * (its zone, or the whole un-zoned outside) hears it; only players
 * standing next to the speaker get the controls.
 */
export function SpeakerPanel() {
  const map = useStore((s) => s.map);
  const me = useStore((s) => s.players.get(s.sessionId));
  const speakers = useStore((s) => s.speakers);
  const [url, setUrl] = useState("");
  const [muted, setMuted] = useState(false);

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

  const positionMs = (info: SpeakerInfo) =>
    info.playing
      ? info.timeMs + Math.max(0, Date.now() - info.updatedAt)
      : info.timeMs;

  const setMusic = () => {
    if (!near || !parseMusicSource(url)) return;
    sendSpeaker(near.id, "set", url);
    setUrl("");
    setMuted(false);
  };

  return (
    <div className="speaker-dock">
      {playing.length > 0 && (
        <div className="speaker-now">
          <span>🔊 room music</span>
          <button onClick={() => setMuted(!muted)}>
            {muted ? "Unmute" : "Mute for me"}
          </button>
        </div>
      )}
      {!muted &&
        playing.map((s) => <SpeakerAudio key={s.id} id={s.id} info={s.info} />)}

      {near && (
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
                  {nearState.playing ? "⏸" : "▶"}
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
      )}
    </div>
  );
}
