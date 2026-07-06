import { useEffect, useState } from "react";
import { AVATARS } from "@gather/shared";
import { connect, fetchSpaces, type SpaceListing } from "./net/connection";
import { useStore } from "./store";
import { GameCanvas } from "./game/GameCanvas";
import { Hud } from "./ui/Hud";
import { ChatPanel } from "./ui/ChatPanel";
import { VideoDock } from "./ui/VideoDock";
import { MediaControls } from "./ui/MediaControls";
import { TouchControls } from "./ui/TouchControls";
import { EditorPanel } from "./editor/EditorPanel";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);

function JoinScreen({ spaceId, invited }: { spaceId: string; invited: boolean }) {
  const [name, setName] = useState(
    () => localStorage.getItem("gather:name") ?? ""
  );
  const [avatar, setAvatar] = useState(
    () => localStorage.getItem("gather:avatar") ?? AVATARS[0]
  );
  const [space, setSpace] = useState(spaceId);
  const [spaces, setSpaces] = useState<SpaceListing[]>([]);
  // "waking" until the first listing succeeds: on free hosting the server
  // may be cold-starting, which must read differently than "nobody online".
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchSpaces()
        .then((list) => {
          if (!alive) return;
          setSpaces(list);
          setServerUp(true);
        })
        .catch(() => alive && setServerUp((up) => up && false));
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const join = async () => {
    const trimmed = name.trim();
    const target = slugify(space) || "lobby";
    if (!trimmed || joining) return;
    setJoining(true);
    setError(null);
    localStorage.setItem("gather:name", trimmed);
    localStorage.setItem("gather:avatar", avatar);
    history.replaceState(null, "", `/space/${target}`);
    try {
      await connect(target, trimmed, avatar);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to connect");
      setJoining(false);
    }
  };

  // A tab that got disconnected while backgrounded reloads itself with
  // ?rejoin=1 (see connection.ts); rejoin silently so the person stays
  // present in the space they invited others to.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("rejoin")) return;
    history.replaceState(null, "", location.pathname);
    if (name.trim()) void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="join-screen">
      <div className="join-card">
        <h1>gather</h1>
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
        <div className="ws-section">
          <div className="ws-title">Join a workspace</div>
          {spaces.length > 0 ? (
            <div className="space-list">
              {spaces.map((s) => (
                <button
                  key={s.spaceId}
                  className={`space-opt ${
                    slugify(space) === s.spaceId ? "selected" : ""
                  }`}
                  onClick={() => setSpace(s.spaceId)}
                >
                  <span>
                    {slugify(space) === s.spaceId ? "✓ " : ""}
                    {s.spaceId}
                  </span>
                  <span className="space-count">
                    {s.clients}/{s.maxClients} online
                  </span>
                </button>
              ))}
            </div>
          ) : serverUp ? (
            <p className="ws-empty">
              {invited
                ? "Nobody's here yet — join below and you'll be the first one in."
                : "Nobody is online yet — start a workspace below and invite people with its link."}
            </p>
          ) : (
            <p className="ws-empty">
              {serverUp === null
                ? "Checking who's online…"
                : "Waking up the server — free hosting naps when idle. This can take up to a minute; hang tight."}
            </p>
          )}
          <div className="ws-title ws-or">or create your own</div>
          <input
            placeholder="new-workspace-name"
            value={space}
            maxLength={32}
            onChange={(e) => setSpace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void join();
            }}
          />
        </div>
        <button
          className="primary join-btn"
          disabled={!name.trim() || joining}
          onClick={() => void join()}
        >
          {joining
            ? "Joining…"
            : `${
                // An invited slug always says "Join": the room is created on
                // demand server-side, and "Create" reads like a broken link
                // to someone who was just sent this URL.
                spaces.some((s) => s.spaceId === (slugify(space) || "lobby")) ||
                (invited && (slugify(space) || "lobby") === spaceId)
                  ? "Join"
                  : "Create"
              } ${slugify(space) || "lobby"}`}
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
      <TouchControls />
      {editing && <EditorPanel />}
      {toast && <div className="toast">{toast}</div>}
      {!connected && <div className="disconnected">Disconnected — reload to rejoin</div>}
    </div>
  );
}

export default function App({
  spaceId,
  invited,
}: {
  spaceId: string;
  invited: boolean;
}) {
  const joined = useStore((s) => s.sessionId !== "");
  return joined ? (
    <SpaceView />
  ) : (
    <JoinScreen spaceId={spaceId} invited={invited} />
  );
}
