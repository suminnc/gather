import { useEffect, useRef, useState } from "react";
import {
  CUSTOM_GID_BASE,
  CUSTOM_TILE_RES,
  MAX_CUSTOM_TILES,
  MAX_CUSTOM_TILE_DATA,
  type CustomTile,
} from "@gather/shared";
import { bumpDraft, patchEditor, showEditorToast, useStore } from "../store";
import { FloatingPanel } from "../ui/FloatingPanel";

const RES = CUSTOM_TILE_RES; // backing pixels per tile side
const VIEW = 384; // on-screen canvas size (RES * 6)
const PEN_SIZES = [1, 2, 4] as const;

/**
 * High-quality downscale of a square source region onto the backing
 * canvas. Halves repeatedly before the final draw — a single bilinear
 * drawImage from a huge photo to 64px loses most of the detail.
 */
function bakeSquare(
  target: HTMLCanvasElement,
  img: CanvasImageSource,
  sx: number,
  sy: number,
  sSize: number
): void {
  let src: CanvasImageSource = img;
  let size = sSize;
  let cut = { x: sx, y: sy };
  while (size >= RES * 2) {
    const half = Math.round(size / 2);
    const step = document.createElement("canvas");
    step.width = half;
    step.height = half;
    const sctx = step.getContext("2d")!;
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(src, cut.x, cut.y, size, size, 0, 0, half, half);
    src = step;
    size = half;
    cut = { x: 0, y: 0 };
  }
  const ctx = target.getContext("2d")!;
  ctx.clearRect(0, 0, RES, RES);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, cut.x, cut.y, size, size, 0, 0, RES, RES);
}

interface CropState {
  img: HTMLImageElement;
  /** Selection square in image pixels. */
  x: number;
  y: number;
  size: number;
}

/** Non-square imports: drag the square over the part to keep. */
function CropPicker({
  crop,
  onChange,
  onConfirm,
  onCancel,
}: {
  crop: CropState;
  onChange: (c: CropState) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dragFrom = useRef<{ px: number; py: number; x: number; y: number } | null>(
    null
  );
  const { img } = crop;
  const scale = Math.min(VIEW / img.width, VIEW / img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const maxSize = Math.min(img.width, img.height);

  useEffect(() => {
    const view = canvas.current;
    if (!view) return;
    const ctx = view.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    // Dim everything outside the selection.
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    const sx = crop.x * scale;
    const sy = crop.y * scale;
    const ss = crop.size * scale;
    ctx.fillRect(0, 0, w, sy);
    ctx.fillRect(0, sy + ss, w, h - sy - ss);
    ctx.fillRect(0, sy, sx, ss);
    ctx.fillRect(sx + ss, sy, w - sx - ss, ss);
    ctx.strokeStyle = "#9ee6a8";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, ss - 2, ss - 2);
  }, [crop, img, w, h, scale]);

  const clampPos = (x: number, y: number, size: number) => ({
    x: Math.round(Math.min(Math.max(0, x), img.width - size)),
    y: Math.round(Math.min(Math.max(0, y), img.height - size)),
  });

  return (
    <>
      <canvas
        ref={canvas}
        width={w}
        height={h}
        className="designer-crop"
        onPointerDown={(e) => {
          dragFrom.current = {
            px: e.clientX,
            py: e.clientY,
            x: crop.x,
            y: crop.y,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const from = dragFrom.current;
          if (!from) return;
          const pos = clampPos(
            from.x + (e.clientX - from.px) / scale,
            from.y + (e.clientY - from.py) / scale,
            crop.size
          );
          onChange({ ...crop, ...pos });
        }}
        onPointerUp={() => {
          dragFrom.current = null;
        }}
      />
      <div className="designer-row">
        <span className="designer-hint">Crop</span>
        <input
          type="range"
          min={Math.max(8, Math.round(maxSize / 8))}
          max={maxSize}
          value={crop.size}
          onChange={(e) => {
            const size = Number(e.target.value);
            // Keep the selection centered where it was while resizing.
            const cx = crop.x + crop.size / 2;
            const cy = crop.y + crop.size / 2;
            onChange({
              ...crop,
              size,
              ...clampPos(cx - size / 2, cy - size / 2, size),
            });
          }}
        />
      </div>
      <div className="designer-row">
        <button className="primary" onClick={onConfirm}>
          Use selection
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

/**
 * Editor for custom tile designs. Draws into a 64×64 backing canvas
 * (mirrored at 6× for editing); imports keep their detail via a smooth
 * downscale (never nearest-neighbor), with a crop step for non-square
 * images. "Add" bakes it into the draft's customTiles as a PNG data URL,
 * where it syncs like any map edit.
 */
export function TileDesigner({ onClose }: { onClose: () => void }) {
  const backing = useRef<HTMLCanvasElement>(
    (() => {
      const c = document.createElement("canvas");
      c.width = RES;
      c.height = RES;
      return c;
    })()
  );
  const display = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState("#a8845c");
  const [erasing, setErasing] = useState(false);
  const [pen, setPen] = useState<number>(2);
  const [kind, setKind] = useState<CustomTile["kind"]>("floor");
  const [crop, setCrop] = useState<CropState | null>(null);
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
    const step = (VIEW / RES) * 8;
    for (let i = step; i < VIEW; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, view.height);
      ctx.moveTo(0, i);
      ctx.lineTo(view.width, i);
      ctx.stroke();
    }
  };

  useEffect(repaint, [crop]);

  const paintAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const view = display.current!;
    const rect = view.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * RES);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * RES);
    if (x < 0 || y < 0 || x >= RES || y >= RES) return;
    const ctx = backing.current.getContext("2d")!;
    const off = Math.floor(pen / 2);
    // Pointer events skip pixels on fast strokes; fill the line from the
    // previous position (same trick as the map painter).
    const from = lastPx.current ?? { x, y };
    const steps = Math.max(Math.abs(x - from.x), Math.abs(y - from.y), 1);
    for (let s = 0; s <= steps; s++) {
      const ix = Math.round(from.x + ((x - from.x) * s) / steps) - off;
      const iy = Math.round(from.y + ((y - from.y) * s) / steps) - off;
      if (erasing) {
        ctx.clearRect(ix, iy, pen, pen);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(ix, iy, pen, pen);
      }
    }
    lastPx.current = { x, y };
    repaint();
  };

  const importImage = (file: File) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.width === img.height) {
        bakeSquare(backing.current, img, 0, 0, img.width);
        repaint();
        return;
      }
      // Non-square: let the user pick which part to keep.
      const size = Math.min(img.width, img.height);
      setCrop({
        img,
        size,
        x: Math.round((img.width - size) / 2),
        y: Math.round((img.height - size) / 2),
      });
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
      defaultRect={{ x: -480, y: 60, w: 424 }}
      resizable={false}
    >
      <div className="editor-header fp-drag">
        <span>Tile designer</span>
        <div>
          <button onClick={onClose}>✕</button>
        </div>
      </div>
      {crop ? (
        <CropPicker
          crop={crop}
          onChange={setCrop}
          onConfirm={() => {
            bakeSquare(backing.current, crop.img, crop.x, crop.y, crop.size);
            setCrop(null);
          }}
          onCancel={() => setCrop(null)}
        />
      ) : (
        <>
          <canvas
            ref={display}
            width={VIEW}
            height={VIEW}
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
            <div className="pen-sizes">
              {PEN_SIZES.map((s) => (
                <button
                  key={s}
                  className={pen === s ? "active" : ""}
                  title={`${s}px pen`}
                  onClick={() => setPen(s)}
                >
                  <span
                    className="pen-dot"
                    style={{ width: s * 3, height: s * 3 }}
                  />
                </button>
              ))}
            </div>
            <button
              className={erasing ? "active" : ""}
              onClick={() => setErasing(!erasing)}
            >
              Eraser
            </button>
            <button
              onClick={() => {
                backing.current.getContext("2d")!.clearRect(0, 0, RES, RES);
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
                if (f) importImage(f);
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
        </>
      )}
    </FloatingPanel>
  );
}
