import { enterEditor, exitEditor, useStore } from "../store";

export function Hud() {
  const spaceId = useStore((s) => s.spaceId);
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
        className={editing ? "active" : ""}
        onClick={() => (editing ? exitEditor() : enterEditor())}
      >
        {editing ? "Exit editor" : "Edit map"}
      </button>
    </div>
  );
}
