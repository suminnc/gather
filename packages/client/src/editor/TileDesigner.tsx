import { useEffect, useRef, useState } from "react";
import {
  CUSTOM_GID_BASE,
  MAX_CUSTOM_TILES,
  MAX_CUSTOM_TILE_DATA,
  TILE_SIZE,
  type CustomTile,
} from "@gather/shared";
import { bumpDraft, patchEditor, showEditorToast, useStore } from "../store";
import { FloatingPanel } from "../ui/FloatingPanel";

const SCALE = 8; // display pixels per tile pixel

/**
 * Pixel editor for custom tile designs. Draws into a 32×32 backing canvas
 * (mirrored at 8× for editing); "Add" bakes it into the draft's
 * customTiles as a PNG data URL, where it syncs like any map edit.
 */
export function TileDesigner({ onClose }: { onClose: () => void }) {
  const backing = useRef<HTMLCanvasElement>(
    (() => {
      const c = document.createElement("canvas");
      c.width = TILE_SIZE;
      c.height = TILE_SIZE;
      return c;
    })()
  );
  const display = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState("#a8845c");
  const [erasing, setErasing] = useState(false);
  const [kind, setKind] = useState<CustomTile["kind"]>("floor");
  const drawing = useRef(false);
  /** Last painted pixel, for filling in fast strokes. */
  const lastPx = useRef<{ x: number; y: number } | null>(null);

  const repaint = () => {
    const view = display.current;
    if (!view) return;
    const ctx = view.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(backing.current, 0, 0, view.width, view.height);
    // pixel grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i <= TILE_SIZE; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i * SCALE, 0);
      ctx.lineTo(i * SCALE, view.height);
      ctx.moveTo(0, i * SCALE);
      ctx.lineTo(view.width, i * SCALE);
      ctx.stroke();
    }
  };

  useEffect(repaint, []);

  const paintAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const view = display.current!;
    const rect = view.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * TILE_SIZE);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * TILE_SIZE);
    if (x < 0 || y < 0 || x >= TILE_SIZE || y >= TILE_SIZE) return;
    const ctx = backing.current.getContext("2d")!;
    // Pointer events skip pixels on fast strokes; fill the line from the
    // previous position (same trick as the map painter).
    const from = lastPx.current ?? { x, y };
    const steps = Math.max(Math.abs(x - from.x), Math.abs(y - from.y), 1);
    for (let s = 0; s <= steps; s++) {
      const ix = Math.round(from.x + ((x - from.x) * s) / steps);
      const iy = Math.round(from.y + ((y - from.y) * s) / steps);
      if (erasing) {
        ctx.clearRect(ix, iy, 1, 1);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(ix, iy, 1, 1);
      }
    }
    lastPx.current = { x, y };
    repaint();
  };

  const importPng = (file: File) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const ctx = backing.current.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
      ctx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE);
      URL.revokeObjectURL(url);
      repaint();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showEditorToast("Couldn't read that image");
    };
    img.src = url;
  };

  const add = () => {
    const { draft } = useStore.getState().editor;
    if (!draft) return;
    const customs = (draft.customTiles ??= []);
    if (customs.length >= MAX_CUSTOM_TILES) {
      showEditorToast(`Design limit reached (${MAX_CUSTOM_TILES})`);
      return;
    }
    const data = backing.current.toDataURL("image/png");
    if (data.length > MAX_CUSTOM_TILE_DATA) {
      showEditorToast("Design too detailed to store — simplify it a little");
      return;
    }
    const gid =
      customs.reduce((m, c) => Math.max(m, c.gid), CUSTOM_GID_BASE - 1) + 1;
    customs.push({ gid, kind, data });
    bumpDraft();
    // Hand the new design straight to the matching paint tool.
    patchEditor({ tool: kind, gid });
    showEditorToast("Design added — paint with it, then Save the map");
  };

  return (
    <FloatingPanel
      id="tile-designer"
      className="tile-designer"
      defaultRect={{ x: -352, y: 60, w: 296 }}
      resizable={false}
    >
      <div className="editor-header fp-drag">
        <span>Tile designer</span>
        <div>
          <button onClick={onClose}>✕</button>
        </div>
      </div>
      <canvas
        ref={display}
        width={TILE_SIZE * SCALE}
        height={TILE_SIZE * SCALE}
        className="designer-canvas"
        onPointerDown={(e) => {
          drawing.current = true;
          lastPx.current = null;
          e.currentTarget.setPointerCapture(e.pointerId);
          paintAt(e);
        }}
        onPointerMove={(e) => {
          if (drawing.current) paintAt(e);
        }}
        onPointerUp={() => {
          drawing.current = false;
          lastPx.current = null;
        }}
      />
      <div className="designer-row">
        <input
          type="color"
          value={color}
          onChange={(e) => {
            setColor(e.target.value);
            setErasing(false);
          }}
          title="Brush color"
        />
        <button
          className={erasing ? "active" : ""}
          onClick={() => setErasing(!erasing)}
        >
          Eraser
        </button>
        <button
          onClick={() => {
            backing.current
              .getContext("2d")!
              .clearRect(0, 0, TILE_SIZE, TILE_SIZE);
            repaint();
          }}
        >
          Clear
        </button>
        <button onClick={() => fileInput.current?.click()}>Import…</button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importPng(f);
            e.target.value = "";
          }}
        />
      </div>
      <div className="designer-row">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as CustomTile["kind"])}
        >
          <option value="floor">Floor</option>
          <option value="wall">Wall</option>
          <option value="object">Object</option>
        </select>
        <button className="primary" onClick={add}>
          Add to palette
        </button>
      </div>
    </FloatingPanel>
  );
}
