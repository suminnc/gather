import type { Direction } from "@gather/shared";
import { useStore } from "../store";

// Coarse pointer = touch device; ?touch forces it for testing.
export const IS_TOUCH_DEVICE =
  window.matchMedia("(pointer: coarse)").matches ||
  new URLSearchParams(location.search).has("touch");

const ARROWS: Record<Direction, string> = {
  up: "▲",
  down: "▼",
  left: "◀",
  right: "▶",
};

function PadButton({ dir }: { dir: Direction }) {
  const active = useStore((s) => s.touchDir === dir);
  const hold = () => useStore.setState({ touchDir: dir });
  const release = () => {
    if (useStore.getState().touchDir === dir) {
      useStore.setState({ touchDir: null });
    }
  };
  return (
    <button
      className={`pad-btn pad-${dir} ${active ? "active" : ""}`}
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
      {ARROWS[dir]}
    </button>
  );
}

export function TouchControls() {
  if (!IS_TOUCH_DEVICE) return null;
  return (
    <div className="touch-pad">
      <PadButton dir="up" />
      <PadButton dir="left" />
      <PadButton dir="right" />
      <PadButton dir="down" />
    </div>
  );
}
