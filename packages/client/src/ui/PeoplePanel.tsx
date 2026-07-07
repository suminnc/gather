import { useState } from "react";
import { requestDm, requestLocate, useStore } from "../store";
import { FloatingPanel } from "./FloatingPanel";

/** Who's in the space, with locate-on-map and direct-message shortcuts. */
export function PeoplePanel() {
  const [open, setOpen] = useState(false);
  const players = useStore((s) => s.players);
  const sessionId = useStore((s) => s.sessionId);
  const map = useStore((s) => s.map);

  if (!open) {
    return (
      <button className="people-open" onClick={() => setOpen(true)}>
        👥 {players.size}
      </button>
    );
  }

  const zoneName = (zoneId: string) =>
    zoneId ? map?.zones.find((z) => z.id === zoneId)?.name : undefined;

  const rows = [...players.entries()].sort(([aId, a], [bId, b]) => {
    if (aId === sessionId) return -1;
    if (bId === sessionId) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <FloatingPanel
      id="people"
      className="people-panel"
      defaultRect={{ x: 12, y: 52, w: 230, h: 260 }}
    >
      <div className="people-header fp-drag">
        <span>People ({players.size})</span>
        <button onClick={() => setOpen(false)}>—</button>
      </div>
      <div className="people-list">
        {rows.map(([id, p]) => (
          <div key={id} className="people-row">
            <span className={`people-name ${id === sessionId ? "people-you" : ""}`}>
              {p.micOn ? "" : "🔇 "}
              {p.riding ? "🏎 " : p.sitting ? "🪑 " : ""}
              {p.name}
              {id === sessionId ? " (you)" : ""}
            </span>
            {zoneName(p.zoneId) && (
              <span className="people-zone">{zoneName(p.zoneId)}</span>
            )}
            <button title="Show on map" onClick={() => requestLocate(id)}>
              📍
            </button>
            {id !== sessionId && (
              <button title="Message directly" onClick={() => requestDm(id)}>
                💬
              </button>
            )}
          </div>
        ))}
      </div>
    </FloatingPanel>
  );
}
