import { useEffect, useRef, useState } from "react";
import type { ChatScope } from "@gather/shared";
import { sendChat } from "../net/connection";
import { useStore } from "../store";

export function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const sessionId = useStore((s) => s.sessionId);
  const [scope, setScope] = useState<ChatScope>("nearby");
  const [text, setText] = useState("");
  const [open, setOpen] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, open]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendChat(scope, trimmed);
    setText("");
  };

  if (!open) {
    return (
      <button className="chat-open" onClick={() => setOpen(true)}>
        💬 Chat
      </button>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span>Chat</span>
        <button onClick={() => setOpen(false)}>—</button>
      </div>
      <div className="chat-log" ref={logRef}>
        {chat.map((m) => (
          <div
            key={m.id}
            className={`chat-msg ${m.from === sessionId ? "mine" : ""}`}
          >
            <span className="chat-scope">
              {m.scope === "everyone" ? "📢" : "💬"}
            </span>
            <span className="chat-from">{m.fromName}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <button
          className="chat-scope-toggle"
          title="Nearby reaches players in your zone or within 5 tiles"
          onClick={() => setScope(scope === "nearby" ? "everyone" : "nearby")}
        >
          {scope === "nearby" ? "💬 nearby" : "📢 everyone"}
        </button>
        <input
          value={text}
          placeholder="Message…"
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => useStore.setState({ typingLock: true })}
          onBlur={() => useStore.setState({ typingLock: false })}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </div>
    </div>
  );
}
