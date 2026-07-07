import { useStore } from "../store";

// Coarse pointer = touch device; ?touch forces it for testing.
export const IS_TOUCH_DEVICE =
  window.matchMedia("(pointer: coarse)").matches ||
  new URLSearchParams(location.search).has("touch");

interface Pad {
  label: string;
  dx: number;
  dy: number;
  col: number;
  row: number;
}

const PADS: Pad[] = [
  { label: "↖", dx: -1, dy: -1, col: 1, row: 1 },
  { label: "▲", dx: 0, dy: -1, col: 2, row: 1 },
  { label: "↗", dx: 1, dy: -1, col: 3, row: 1 },
  { label: "◀", dx: -1, dy: 0, col: 1, row: 2 },
  { label: "▶", dx: 1, dy: 0, col: 3, row: 2 },
  { label: "↙", dx: -1, dy: 1, col: 1, row: 3 },
  { label: "▼", dx: 0, dy: 1, col: 2, row: 3 },
  { label: "↘", dx: 1, dy: 1, col: 3, row: 3 },
];

function PadButton({ pad }: { pad: Pad }) {
  const active = useStore(
    (s) => s.touchVec?.[0] === pad.dx && s.touchVec?.[1] === pad.dy
  );
  const hold = () => useStore.setState({ touchVec: [pad.dx, pad.dy] });
  const release = () => {
    const v = useStore.getState().touchVec;
    if (v && v[0] === pad.dx && v[1] === pad.dy) {
      useStore.setState({ touchVec: null });
    }
  };
  return (
    <button
      className={`pad-btn ${active ? "active" : ""}`}
      style={{ gridColumn: pad.col, gridRow: pad.row }}
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // pointer already gone; press/release still works without capture
        }
        hold();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {pad.label}
    </button>
  );
}

export function TouchControls() {
  if (!IS_TOUCH_DEVICE) return null;
  return (
    <div className="touch-pad">
      {PADS.map((pad) => (
        <PadButton key={pad.label} pad={pad} />
      ))}
    </div>
  );
}
