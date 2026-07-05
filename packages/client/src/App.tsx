import { useState } from "react";
import { AVATARS } from "@gather/shared";
import { connect } from "./net/connection";
import { useStore } from "./store";
import { GameCanvas } from "./game/GameCanvas";
import { Hud } from "./ui/Hud";
import { ChatPanel } from "./ui/ChatPanel";
import { VideoDock } from "./ui/VideoDock";
import { MediaControls } from "./ui/MediaControls";
import { EditorPanel } from "./editor/EditorPanel";

function JoinScreen({ spaceId }: { spaceId: string }) {
  const [name, setName] = useState(
    () => localStorage.getItem("gather:name") ?? ""
  );
  const [avatar, setAvatar] = useState(
    () => localStorage.getItem("gather:avatar") ?? AVATARS[0]
  );
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    const trimmed = name.trim();
    if (!trimmed || joining) return;
    setJoining(true);
    setError(null);
    localStorage.setItem("gather:name", trimmed);
    localStorage.setItem("gather:avatar", avatar);
    try {
      await connect(spaceId, trimmed, avatar);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to connect");
      setJoining(false);
    }
  };

  return (
    <div className="join-screen">
      <div className="join-card">
        <h1>gather</h1>
        <p className="join-space">
          joining <strong>{spaceId}</strong>
        </p>
        <input
          autoFocus
          placeholder="Your name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void join();
          }}
        />
        <div className="avatar-grid">
          {AVATARS.map((a) => (
            <button
              key={a}
              className={`avatar-opt ${avatar === a ? "selected" : ""}`}
              onClick={() => setAvatar(a)}
            >
              <span
                className="avatar-img"
                style={{ backgroundImage: `url(/assets/avatars/${a}.png)` }}
              />
            </button>
          ))}
        </div>
        <button
          className="primary join-btn"
          disabled={!name.trim() || joining}
          onClick={() => void join()}
        >
          {joining ? "Joining…" : "Join space"}
        </button>
        {error && <p className="join-error">{error}</p>}
      </div>
    </div>
  );
}

function SpaceView() {
  const map = useStore((s) => s.map);
  const editing = useStore((s) => s.editor.active);
  const toast = useStore((s) => s.editor.toast);
  const connected = useStore((s) => s.connected);

  if (!map) return <div className="loading">loading map…</div>;

  return (
    <div className="space-view">
      <GameCanvas />
      <Hud />
      <VideoDock />
      <ChatPanel />
      <MediaControls />
      {editing && <EditorPanel />}
      {toast && <div className="toast">{toast}</div>}
      {!connected && <div className="disconnected">Disconnected — reload to rejoin</div>}
    </div>
  );
}

export default function App({ spaceId }: { spaceId: string }) {
  const joined = useStore((s) => s.sessionId !== "");
  return joined ? <SpaceView /> : <JoinScreen spaceId={spaceId} />;
}
