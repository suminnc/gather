import { sendKartDismount } from "../net/connection";
import { useStore } from "../store";

/** Shown while riding a go-kart; E does the same from the keyboard. */
export function KartButton() {
  const riding = useStore((s) => !!s.players.get(s.sessionId)?.riding);
  if (!riding) return null;
  return (
    <button className="kart-btn" onClick={() => sendKartDismount()}>
      ⏏ Hop off (E)
    </button>
  );
}
