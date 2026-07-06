import { useEffect, useRef, useState } from "react";
import { AVATARS } from "@gather/shared";
import {
  connect,
  fetchConfig,
  fetchSpaces,
  type ServerConfig,
  type SpaceListing,
} from "./net/connection";
import {
  getStoredAuth,
  renderGoogleButton,
  signOut,
  storeAuth,
  type AuthInfo,
} from "./auth";
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

function JoinScreen({
  spaceId,
  invited,
  invite,
}: {
  spaceId: string;
  invited: boolean;
  invite: string | null;
}) {
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
  // null while the server hasn't answered /api/config yet.
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const [auth, setAuth] = useState<AuthInfo | null>(getStoredAuth);
  const [guest, setGuest] = useState(
    () => sessionStorage.getItem("gather:guest") === "1"
  );
  const googleBtn = useRef<HTMLDivElement>(null);

  // Keep the invite token for this tab so a guest's ?rejoin=1 reload (which
  // strips the query string) can still present it.
  useEffect(() => {
    if (invite) sessionStorage.setItem(`gather:invite:${spaceId}`, invite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const inviteFor = (target: string) =>
    (target === spaceId ? invite : null) ??
    sessionStorage.getItem(`gather:invite:${target}`) ??
    undefined;

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      fetchConfig()
        .then((c) => alive && setCfg(c))
        .catch(() => {
          if (!alive) return;
          setServerUp(false);
          retry = setTimeout(load, 5000);
        });
    load();
    return () => {
      alive = false;
      clearTimeout(retry);
    };
  }, []);

  useEffect(() => {
    if (!cfg || (cfg.auth && !auth)) return;
    let alive = true;
    const load = () =>
      fetchSpaces(auth?.idToken)
        .then((list) => {
          if (!alive) return;
          setSpaces(list);
          setServerUp(true);
        })
        .catch((err) => {
          if (!alive) return;
          if (err instanceof Error && err.message === "401") {
            storeAuth(null);
            setAuth(null);
          } else {
            setServerUp((up) => up && false);
          }
        });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [cfg, auth]);

  // `guest` must be a dependency: leaving guest mode re-mounts the button
  // container, and without a re-run the gate shows an empty gap.
  useEffect(() => {
    if (!cfg?.auth || auth || guest || !googleBtn.current) return;
    const clientId =
      cfg.googleClientIds?.[location.origin] ?? cfg.googleClientId;
    renderGoogleButton(clientId, googleBtn.current, setAuth).catch(() =>
      setError("Couldn't load Google sign-in — check your connection.")
    );
  }, [cfg, auth, guest]);

  // Default the display name to the Google profile name.
  useEffect(() => {
    if (auth && !name) setName(auth.name.slice(0, 24));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  const join = async () => {
    const trimmed = name.trim();
    const target = slugify(space) || "lobby";
    if (!trimmed || joining) return;
    if (cfg?.auth && !auth && !guest) return;
    setJoining(true);
    setError(null);
    localStorage.setItem("gather:name", trimmed);
    localStorage.setItem("gather:avatar", avatar);
    history.replaceState(null, "", `/space/${target}`);
    try {
      await connect(target, trimmed, avatar, {
        idToken: auth?.idToken,
        invite: inviteFor(target),
        guest: !auth && guest,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed to connect";
      if (msg.includes("not_invited")) {
        setError(
          "You haven't been invited to this workspace — ask a member for an invite link."
        );
      } else if (msg.includes("sign_in_to_create")) {
        setError(
          "Guests can't create workspaces — sign in with Google to create one."
        );
      } else if (msg.includes("sign_in_required")) {
        setError("Your sign-in expired — please sign in again.");
        storeAuth(null);
        setAuth(null);
      } else {
        setError(msg);
      }
      setJoining(false);
    }
  };

  // A tab that got disconnected while backgrounded reloads itself with
  // ?rejoin=1 (see connection.ts); rejoin silently so the person stays
  // present in the space they invited others to. Waits for /api/config so
  // it knows whether a token is required.
  const rejoinPending = useRef(
    new URLSearchParams(location.search).has("rejoin")
  );
  useEffect(() => {
    if (!rejoinPending.current || !cfg) return;
    rejoinPending.current = false;
    history.replaceState(null, "", location.pathname);
    if (name.trim() && (!cfg.auth || auth || guest)) void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  return (
    <div className="join-screen">
      <div className="join-card">
        <h1>gather</h1>
        {cfg === null ? (
          <p className="ws-empty">
            {serverUp === false
              ? "Waking up the server — free hosting naps when idle. This can take up to a minute; hang tight."
              : "Connecting to the server…"}
          </p>
        ) : cfg.auth && !auth && !guest ? (
          <div className="auth-gate">
            <p className="ws-empty">
              {invited
                ? `Sign in with Google to join ${spaceId}.`
                : "Sign in with Google to continue."}
            </p>
            <div ref={googleBtn} className="google-btn" />
            <button
              className="linklike"
              onClick={() => {
                sessionStorage.setItem("gather:guest", "1");
                setGuest(true);
                setError(null);
              }}
            >
              or continue as guest
            </button>
          </div>
        ) : (
          <>
        {cfg.auth && (
          <p className="auth-line">
            {auth ? auth.email : "joining as a guest"}
            {" · "}
            <button
              className="linklike"
              onClick={() => {
                if (auth) {
                  signOut();
                  setAuth(null);
                } else {
                  sessionStorage.removeItem("gather:guest");
                  setGuest(false);
                }
                setError(null);
              }}
            >
              {auth ? "sign out" : "sign in instead"}
            </button>
          </p>
        )}
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
          ) : cfg?.auth && !auth && guest ? (
            <p className="ws-empty">
              {invited && inviteFor(spaceId)
                ? "You're invited — join below."
                : "As a guest you can only enter workspaces you have an invite link for."}
            </p>
          ) : serverUp ? (
            <p className="ws-empty">
              {invited
                ? "Nobody's here yet — join below and you'll be the first one in."
                : cfg?.auth
                  ? "No workspaces yet — create one below and share its invite link."
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
          </>
        )}
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
  invite,
}: {
  spaceId: string;
  invited: boolean;
  invite: string | null;
}) {
  const joined = useStore((s) => s.sessionId !== "");
  return joined ? (
    <SpaceView />
  ) : (
    <JoinScreen spaceId={spaceId} invited={invited} invite={invite} />
  );
}
