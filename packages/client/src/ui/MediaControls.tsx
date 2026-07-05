import { peers } from "../net/connection";
import { useStore } from "../store";

export function MediaControls() {
  const media = useStore((s) => s.media);

  return (
    <div className="media-controls">
      <button
        disabled={!media.hasMedia}
        className={media.micOn ? "active" : "muted"}
        title={media.hasMedia ? "Toggle microphone" : "No mic/cam access"}
        onClick={() => peers?.setMic(!media.micOn)}
      >
        {media.micOn ? "🎤" : "🔇"}
      </button>
      <button
        disabled={!media.hasMedia}
        className={media.camOn ? "active" : "muted"}
        title={media.hasMedia ? "Toggle camera" : "No mic/cam access"}
        onClick={() => peers?.setCam(!media.camOn)}
      >
        {media.camOn ? "📷" : "🚫"}
      </button>
      <button
        className={media.sharing ? "active" : ""}
        title={media.sharing ? "Stop sharing" : "Share screen"}
        onClick={() =>
          media.sharing ? peers?.stopScreenShare() : void peers?.startScreenShare()
        }
      >
        🖥️
      </button>
    </div>
  );
}
