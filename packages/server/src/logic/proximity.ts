import { CONNECT_DIST, DISCONNECT_DIST } from "@gather/shared";
import type { Player, SpaceState } from "../rooms/schema/SpaceState";

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function chebyshev(a: Player, b: Player): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Whether a pair should be linked, honoring private-zone isolation and
 * connect/disconnect hysteresis. Zones override distance entirely: same zone
 * = linked, any zone mismatch = unlinked.
 */
function shouldLink(a: Player, b: Player, currentlyLinked: boolean): boolean {
  if (a.zoneId !== "" || b.zoneId !== "") {
    return a.zoneId !== "" && a.zoneId === b.zoneId;
  }
  const d = chebyshev(a, b);
  return currentlyLinked ? d <= DISCONNECT_DIST : d <= CONNECT_DIST;
}

export interface LinkDiff {
  added: Array<[string, string]>;
  removed: Array<[string, string]>;
}

/**
 * Recompute all pairwise links. Mutates `linked` (the room's persistent set
 * of pair keys) and returns the diff so the room can notify both endpoints.
 */
export function computeLinkDiff(
  state: SpaceState,
  linked: Set<string>
): LinkDiff {
  const ids = Array.from(state.players.keys());
  const diff: LinkDiff = { added: [], removed: [] };
  const seen = new Set<string>();

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = state.players.get(ids[i])!;
      const b = state.players.get(ids[j])!;
      const key = pairKey(ids[i], ids[j]);
      seen.add(key);
      const was = linked.has(key);
      const now = shouldLink(a, b, was);
      if (now && !was) {
        linked.add(key);
        diff.added.push([ids[i], ids[j]]);
      } else if (!now && was) {
        linked.delete(key);
        diff.removed.push([ids[i], ids[j]]);
      }
    }
  }

  // Drop links whose members left the room.
  for (const key of Array.from(linked)) {
    if (!seen.has(key)) {
      linked.delete(key);
      const [a, b] = key.split("|");
      diff.removed.push([a, b]);
    }
  }

  return diff;
}
