import { useState } from "react";
import { enterEditor, exitEditor, useStore } from "../store";

export function Hud() {
  const [copied, setCopied] = useState(false);
  const spaceId = useStore((s) => s.spaceId);
  const inviteToken = useStore((s) => s.inviteToken);
  const connected = useStore((s) => s.connected);
  const editing = useStore((s) => s.editor.active);
  const zoneName = useStore((s) => {
    const me = s.players.get(s.sessionId);
    if (!me || !me.zoneId || !s.map) return null;
    return s.map.zones.find((z) => z.id === me.zoneId)?.name ?? null;
  });

  return (
    <div className="hud">
      <span className={`dot ${connected ? "on" : "off"}`} />
      <span className="hud-space">{spaceId}</span>
      {zoneName && <span className="hud-zone">{zoneName}</span>}
      <button
        title="Copy an invite link to this workspace"
        onClick={() => {
          // With auth enabled the link carries a signed invite token so the
          // recipient is admitted (and remembered as a member) on join.
          const url = inviteToken
            ? `${location.origin}/space/${spaceId}?invite=${inviteToken}`
            : location.href;
          const markCopied = () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          };
          // Clipboard API can reject (permissions, focus loss); fall back to
          // the legacy selection-based copy so the button never fails silently.
          navigator.clipboard.writeText(url).then(markCopied, () => {
            const ta = document.createElement("textarea");
            ta.value = url;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            if (ok) markCopied();
          });
        }}
      >
        {copied ? "Copied!" : "Invite"}
      </button>
      <button
        className={editing ? "active" : ""}
        onClick={() => (editing ? exitEditor() : enterEditor())}
      >
        {editing ? "Exit editor" : "Edit map"}
      </button>
    </div>
  );
}
