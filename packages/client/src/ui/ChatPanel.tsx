import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@gather/shared";
import { sendChat } from "../net/connection";
import { useStore } from "../store";
import { IS_TOUCH_DEVICE } from "./TouchControls";
import { FloatingPanel } from "./FloatingPanel";

/** Conversation key: a shared scope, or a per-person DM thread. */
type Convo = "nearby" | "everyone" | `dm:${string}`;

const inConvo = (m: ChatMessage, convo: Convo, self: string): boolean => {
  if (convo === "nearby" || convo === "everyone") return m.scope === convo;
  const peer = convo.slice(3);
  return (
    m.scope === "dm" &&
    ((m.from === peer && m.to === self) || (m.from === self && m.to === peer))
  );
};

export function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const sessionId = useStore((s) => s.sessionId);
  const players = useStore((s) => s.players);
  const [convo, setConvo] = useState<Convo>("nearby");
  const [text, setText] = useState("");
  // Phones don't have room for an always-open chat next to the D-pad.
  const [open, setOpen] = useState(!IS_TOUCH_DEVICE);
  const [picking, setPicking] = useState(false);
  /** DM threads opened locally (before any message exists). */
  const [openDms, setOpenDms] = useState<string[]>([]);
  /** Messages already seen per conversation, for unread badges. */
  const [seen, setSeen] = useState<Record<string, number>>({});
  const logRef = useRef<HTMLDivElement>(null);

  // Every peer that appears in a DM is a thread, even after they leave.
  const dmPeers = useMemo(() => {
    const peers = new Map<string, string>(); // sessionId -> display name
    for (const id of openDms) {
      peers.set(id, players.get(id)?.name ?? "left");
    }
    for (const m of chat) {
      if (m.scope !== "dm") continue;
      const peer = m.from === sessionId ? m.to! : m.from;
      const name = m.from === sessionId ? m.toName! : m.fromName;
      peers.set(peer, players.get(peer)?.name ?? name);
    }
    return peers;
  }, [chat, openDms, players, sessionId]);

  const messages = useMemo(
    () => chat.filter((m) => inConvo(m, convo, sessionId)),
    [chat, convo, sessionId]
  );

  const unread = (c: Convo): number =>
    chat.filter((m) => inConvo(m, c, sessionId)).length - (seen[c] ?? 0);

  // Viewing a conversation marks it read.
  useEffect(() => {
    setSeen((s) => ({ ...s, [convo]: messages.length }));
  }, [convo, messages.length]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, open, convo]);

  // The People panel opens DM threads from outside this component.
  const dmRequest = useStore((s) => s.dmRequest);
  useEffect(() => {
    if (!dmRequest) return;
    useStore.setState({ dmRequest: null });
    setOpen(true);
    setOpenDms((d) => (d.includes(dmRequest) ? d : [...d, dmRequest]));
    setConvo(`dm:${dmRequest}`);
  }, [dmRequest]);

  // A DM from someone new should surface as a thread with a badge even if
  // the recipient never opened it, which dmPeers already handles; if the
  // active DM peer left, fall back to nearby.
  useEffect(() => {
    if (convo.startsWith("dm:") && !dmPeers.has(convo.slice(3))) {
      setConvo("nearby");
    }
  }, [convo, dmPeers]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (convo.startsWith("dm:")) {
      sendChat("dm", trimmed, convo.slice(3));
    } else {
      sendChat(convo as "nearby" | "everyone", trimmed);
    }
    setText("");
  };

  if (!open) {
    const total = chat.length - Object.values(seen).reduce((a, b) => a + b, 0);
    return (
      <button className="chat-open" onClick={() => setOpen(true)}>
        💬 Chat{total > 0 ? ` (${total})` : ""}
      </button>
    );
  }

  const others = [...players.entries()].filter(([id]) => id !== sessionId);

  return (
    <FloatingPanel
      id="chat"
      className="chat-panel"
      defaultRect={{ x: 12, y: -12, w: 300, h: 320 }}
    >
      <div className="chat-header fp-drag">
        <span>Chat</span>
        <button onClick={() => setOpen(false)}>—</button>
      </div>
      <div className="chat-tabs">
        {(["nearby", "everyone"] as const).map((c) => (
          <button
            key={c}
            className={`chat-tab ${convo === c ? "active" : ""}`}
            onClick={() => setConvo(c)}
          >
            {c === "nearby" ? "💬 nearby" : "📢 everyone"}
            {unread(c) > 0 && convo !== c && (
              <span className="chat-badge">{unread(c)}</span>
            )}
          </button>
        ))}
        {[...dmPeers.entries()].map(([id, name]) => {
          const c: Convo = `dm:${id}`;
          return (
            <button
              key={id}
              className={`chat-tab ${convo === c ? "active" : ""}`}
              title={players.has(id) ? name : `${name} (left)`}
              onClick={() => setConvo(c)}
            >
              🔒 {name}
              {unread(c) > 0 && convo !== c && (
                <span className="chat-badge">{unread(c)}</span>
              )}
            </button>
          );
        })}
        <button
          className="chat-tab chat-tab-new"
          title="Message someone directly"
          onClick={() => setPicking(!picking)}
        >
          +
        </button>
      </div>
      {picking && (
        <div className="chat-picker">
          {others.length === 0 && (
            <span className="chat-picker-empty">Nobody else is here yet.</span>
          )}
          {others.map(([id, p]) => (
            <button
              key={id}
              onClick={() => {
                setOpenDms((d) => (d.includes(id) ? d : [...d, id]));
                setConvo(`dm:${id}`);
                setPicking(false);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="chat-log" ref={logRef}>
        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-msg ${m.from === sessionId ? "mine" : ""}`}
          >
            <span className="chat-from">{m.fromName}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          value={text}
          placeholder={
            convo.startsWith("dm:")
              ? `Message ${dmPeers.get(convo.slice(3)) ?? ""}…`
              : `Message ${convo}…`
          }
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => useStore.setState({ typingLock: true })}
          onBlur={() => useStore.setState({ typingLock: false })}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </div>
    </FloatingPanel>
  );
}
