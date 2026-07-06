import { useState } from "react";
import { validateMap, type CustomTile } from "@gather/shared";
import { sendMapSave } from "../net/connection";
import {
  bumpDraft,
  exitEditor,
  patchEditor,
  showEditorToast,
  useStore,
  type EditorTool,
} from "../store";
import { FloatingPanel } from "../ui/FloatingPanel";
import { TileDesigner } from "./TileDesigner";

const FLOOR_GIDS = [0, 1, 2, 3, 4, 5, 6, 7];
const WALL_GIDS = [8, 9, 10, 11, 12, 13, 14, 15];
const OBJECT_GIDS = [16, 17, 18, 19, 20, 21, 22, 23];

function TileSwatch({
  gid,
  custom,
  selected,
  onClick,
  onDelete,
}: {
  gid: number;
  /** Data URL when this is a user design (rendered from the image). */
  custom?: string;
  selected: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <button
      className={`swatch ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      {/* The tile renders in an inner 32×32 span so the button's border
          doesn't crop the sprite or shift its background origin. */}
      <span
        className="swatch-img"
        style={
          custom
            ? { backgroundImage: `url(${custom})` }
            : {
                backgroundImage: "url(/assets/tiles/tiles.png)",
                backgroundPosition: `-${(gid % 8) * 32}px -${Math.floor(gid / 8) * 32}px`,
              }
        }
      />
      {onDelete && (
        <span
          className="swatch-delete"
          title="Delete design"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ✕
        </span>
      )}
    </button>
  );
}

function SwatchRow({
  title,
  gids,
  tool,
  kind,
}: {
  title: string;
  gids: number[];
  tool: EditorTool;
  kind: CustomTile["kind"];
}) {
  const editor = useStore((s) => s.editor);
  const customs = (editor.draft?.customTiles ?? []).filter(
    (c) => c.kind === kind
  );
  const deleteCustom = (gid: number) => {
    const { draft } = useStore.getState().editor;
    if (!draft?.customTiles) return;
    draft.customTiles = draft.customTiles.filter((c) => c.gid !== gid);
    bumpDraft();
  };
  return (
    <div className="editor-section">
      <div className="editor-section-title">{title}</div>
      <div className="swatch-row">
        {gids.map((gid) => (
          <TileSwatch
            key={gid}
            gid={gid}
            selected={editor.tool === tool && editor.gid === gid}
            onClick={() => patchEditor({ tool, gid })}
          />
        ))}
        {customs.map((c) => (
          <TileSwatch
            key={c.gid}
            gid={c.gid}
            custom={c.data}
            selected={editor.tool === tool && editor.gid === c.gid}
            onClick={() => patchEditor({ tool, gid: c.gid })}
            onDelete={() => deleteCustom(c.gid)}
          />
        ))}
      </div>
    </div>
  );
}

function ToolButton({ tool, label }: { tool: EditorTool; label: string }) {
  const active = useStore((s) => s.editor.tool === tool);
  return (
    <button
      className={active ? "active" : ""}
      onClick={() => patchEditor({ tool })}
    >
      {label}
    </button>
  );
}

function PendingZoneForm() {
  const pending = useStore((s) => s.editor.pendingZone);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#7c3aed");
  if (!pending) return null;

  const confirm = () => {
    const { draft } = useStore.getState().editor;
    if (!draft || !name.trim()) return;
    draft.zones.push({
      id: `z${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim().slice(0, 32),
      color,
      ...pending,
    });
    patchEditor({ pendingZone: null });
    bumpDraft();
    setName("");
  };

  return (
    <div className="editor-section pending-zone">
      <div className="editor-section-title">
        New zone ({pending.w}×{pending.h})
      </div>
      <input
        autoFocus
        placeholder="Zone name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={() => useStore.setState({ typingLock: true })}
        onBlur={() => useStore.setState({ typingLock: false })}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirm();
        }}
      />
      <div className="zone-form-row">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <button onClick={confirm} disabled={!name.trim()}>
          Add
        </button>
        <button onClick={() => patchEditor({ pendingZone: null })}>
          Discard
        </button>
      </div>
    </div>
  );
}

export function EditorPanel() {
  // draftRev subscription keeps the zone/spawn lists fresh as the scene
  // mutates the draft in place.
  useStore((s) => s.editor.draftRev);
  const draft = useStore((s) => s.editor.draft);
  const [designing, setDesigning] = useState(false);
  if (!draft) return null;

  const save = () => {
    if (!validateMap(draft)) {
      showEditorToast("Invalid map — needs ≥1 spawn on walkable ground");
      return;
    }
    sendMapSave(draft);
  };

  const deleteZone = (id: string) => {
    draft.zones = draft.zones.filter((z) => z.id !== id);
    bumpDraft();
  };

  return (
    <FloatingPanel
      id="editor"
      className="editor-panel"
      defaultRect={{ x: -12, y: 60, w: 320 }}
    >
      <div className="editor-header fp-drag">
        <span>Map editor</span>
        <div>
          <button className="primary" onClick={save}>
            Save
          </button>
          <button onClick={exitEditor}>Cancel</button>
        </div>
      </div>

      <SwatchRow title="Floor" gids={FLOOR_GIDS} tool="floor" kind="floor" />
      <SwatchRow title="Walls" gids={WALL_GIDS} tool="wall" kind="wall" />
      <SwatchRow
        title="Objects"
        gids={OBJECT_GIDS}
        tool="object"
        kind="object"
      />

      <div className="editor-section">
        <button onClick={() => setDesigning(!designing)}>
          {designing ? "Close tile designer" : "🎨 Design your own tile…"}
        </button>
      </div>
      {designing && <TileDesigner onClose={() => setDesigning(false)} />}

      <div className="editor-section">
        <div className="editor-section-title">Tools</div>
        <div className="tool-row">
          <ToolButton tool="eraseWall" label="Erase wall" />
          <ToolButton tool="eraseObject" label="Erase object" />
          <ToolButton tool="zone" label="Draw zone" />
          <ToolButton tool="spawn" label="Spawns" />
        </div>
        <div className="editor-hint">
          Zones: drag a rectangle. Spawns: click to add/remove (
          {draft.spawns.length} placed). Pan with WASD/arrows.
        </div>
      </div>

      <PendingZoneForm />

      {draft.zones.length > 0 && (
        <div className="editor-section">
          <div className="editor-section-title">Zones</div>
          {draft.zones.map((z) => (
            <div key={z.id} className="zone-row">
              <span className="zone-color" style={{ background: z.color }} />
              <span className="zone-name">{z.name}</span>
              <button onClick={() => deleteZone(z.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </FloatingPanel>
  );
}
