import { DOOR_GID, doorInsideZones } from "@gather/shared";
import { sendDoorToggle } from "../net/connection";
import { useStore } from "../store";

/**
 * Shown while standing next to a door you may operate (inside its zone;
 * guests never see it). Replaces the old click-on-the-door interaction.
 */
export function DoorButton() {
  const map = useStore((s) => s.map);
  const isGuest = useStore((s) => s.isGuest);
  const me = useStore((s) => s.players.get(s.sessionId));
  const lockedDoors = useStore((s) => s.lockedDoors);

  if (isGuest || !map || !me) return null;

  const door = map.objects.find((o) => {
    if (o.gid !== DOOR_GID) return false;
    if (Math.max(Math.abs(me.x - o.x), Math.abs(me.y - o.y)) > 1) return false;
    const inside = doorInsideZones(map, o.x, o.y);
    return inside.length === 0 || inside.includes(me.zoneId);
  });
  if (!door) return null;

  const locked = lockedDoors.has(`${door.x},${door.y}`);
  return (
    <button
      className="door-btn"
      onClick={() => sendDoorToggle(door.x, door.y)}
    >
      {locked ? "🔓 Unlock door" : "🔒 Lock door"}
    </button>
  );
}
