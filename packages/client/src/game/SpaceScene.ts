import Phaser from "phaser";
import {
  AVATARS,
  MOVE_MS,
  TILE_SIZE,
  isWalkable,
  tileIndex,
  type Direction,
  type MapDoc,
} from "@gather/shared";
import { bumpDraft, patchEditor, useStore, type PlayerInfo } from "../store";
import { sendMove } from "../net/connection";

const DIR_ROW: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };
const DIR_DELTA: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

const px = (tile: number) => tile * TILE_SIZE + TILE_SIZE / 2;

interface PlayerEntry {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  avatar: string;
  /** Tile position this entry is at or tweening toward. */
  x: number;
  y: number;
  tween?: Phaser.Tweens.Tween;
}

export class SpaceScene extends Phaser.Scene {
  private tilemap?: Phaser.Tilemaps.Tilemap;
  private floorLayer?: Phaser.Tilemaps.TilemapLayer;
  private wallsLayer?: Phaser.Tilemaps.TilemapLayer;
  private decor: Phaser.GameObjects.GameObject[] = [];
  private spawnMarkers: Phaser.GameObjects.GameObject[] = [];
  private entries = new Map<string, PlayerEntry>();
  private unsubs: Array<() => void> = [];

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private myId = "";
  private localX = 0;
  private localY = 0;
  private localDir: Direction = "down";
  private hopping = false;
  private sentMoving = false;
  private sentDir: Direction = "down";

  private zoneDragStart: { x: number; y: number } | null = null;
  private zonePreview?: Phaser.GameObjects.Graphics;

  constructor() {
    super("space");
  }

  preload(): void {
    const frame = { frameWidth: TILE_SIZE, frameHeight: TILE_SIZE };
    this.load.spritesheet("tiles", "/assets/tiles/tiles.png", frame);
    for (const avatar of AVATARS) {
      this.load.spritesheet(avatar, `/assets/avatars/${avatar}.png`, frame);
    }
  }

  create(): void {
    for (const avatar of AVATARS) {
      for (const dir of Object.keys(DIR_ROW) as Direction[]) {
        const row = DIR_ROW[dir];
        this.anims.create({
          key: `${avatar}-walk-${dir}`,
          frames: this.anims.generateFrameNumbers(avatar, {
            frames: [row * 3, row * 3 + 1, row * 3 + 2, row * 3 + 1],
          }),
          frameRate: 8,
          repeat: -1,
        });
      }
    }

    this.keys = this.input.keyboard!.addKeys(
      "W,A,S,D,UP,DOWN,LEFT,RIGHT"
    ) as Record<string, Phaser.Input.Keyboard.Key>;
    if (import.meta.env.DEV) (window as any).__scene = this;

    const store = useStore.getState();
    this.myId = store.sessionId;
    this.buildMap(store.map!);
    this.syncPlayers(store.players);

    const me = this.entries.get(this.myId);
    if (me) {
      this.localX = Math.round((me.container.x - TILE_SIZE / 2) / TILE_SIZE);
      this.localY = Math.round((me.container.y - TILE_SIZE / 2) / TILE_SIZE);
      this.cameras.main.startFollow(me.container, true, 0.15, 0.15);
    }
    this.cameras.main.setZoom(2);

    this.zonePreview = this.add.graphics().setDepth(10000);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) =>
      this.onEditorPointer(p, true)
    );
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.onEditorPointer(p, false);
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => this.onEditorPointerUp());

    this.unsubs.push(
      useStore.subscribe(
        (s) => s.players,
        (players) => this.syncPlayers(players)
      ),
      useStore.subscribe(
        (s) => s.mapRev,
        () => this.onMapReplaced()
      ),
      useStore.subscribe(
        (s) => s.editor.active,
        (active) => this.onEditorToggled(active)
      ),
      useStore.subscribe(
        (s) => s.editor.draftRev,
        () => this.redrawEditorOverlays()
      )
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
    });
  }

  update(): void {
    const { typingLock, editor } = useStore.getState();

    if (editor.active) {
      this.panCamera();
      return;
    }
    if (typingLock || this.hopping) return;

    const dir = this.heldDirection();
    if (!dir) {
      if (this.sentMoving) {
        this.sentMoving = false;
        sendMove(this.localX, this.localY, this.localDir, false);
        this.setIdle(this.myId, this.localDir);
      }
      return;
    }

    this.localDir = dir;
    const map = useStore.getState().map;
    const [dx, dy] = DIR_DELTA[dir];
    const nx = this.localX + dx;
    const ny = this.localY + dy;

    if (!map || !isWalkable(map, nx, ny)) {
      // Blocked: just face that way (dist 0 keeps the server happy).
      this.setIdle(this.myId, dir);
      if (this.sentDir !== dir || this.sentMoving) {
        this.sentDir = dir;
        this.sentMoving = false;
        sendMove(this.localX, this.localY, dir, false);
      }
      return;
    }

    this.localX = nx;
    this.localY = ny;
    this.hopping = true;
    this.sentMoving = true;
    this.sentDir = dir;
    sendMove(nx, ny, dir, true);

    const entry = this.entries.get(this.myId);
    if (!entry) return;
    entry.x = nx;
    entry.y = ny;
    entry.sprite.play(`${entry.avatar}-walk-${dir}`, true);
    entry.tween?.stop();
    entry.tween = this.tweens.add({
      targets: entry.container,
      x: px(nx),
      y: px(ny),
      duration: MOVE_MS,
      onUpdate: () => entry.container.setDepth(entry.container.y),
      onComplete: () => {
        this.hopping = false;
      },
    });
  }

  // ---------- map rendering ----------

  private buildMap(doc: MapDoc): void {
    this.floorLayer?.destroy();
    this.wallsLayer?.destroy();
    this.tilemap?.destroy();

    this.tilemap = this.make.tilemap({
      width: doc.width,
      height: doc.height,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const tileset = this.tilemap.addTilesetImage(
      "tiles",
      "tiles",
      TILE_SIZE,
      TILE_SIZE,
      0,
      0
    )!;
    this.floorLayer = this.tilemap.createBlankLayer("floor", tileset)!;
    this.wallsLayer = this.tilemap.createBlankLayer("walls", tileset)!;
    this.floorLayer.setDepth(0);
    this.wallsLayer.setDepth(1);
    this.fillLayers(doc);
    this.redrawDecor(doc);

    const w = doc.width * TILE_SIZE;
    const h = doc.height * TILE_SIZE;
    this.cameras.main.setBounds(0, 0, w, h);
  }

  private fillLayers(doc: MapDoc): void {
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        const i = tileIndex(doc, x, y);
        const f = doc.layers.floor[i];
        const w = doc.layers.walls[i];
        if (f >= 0) this.floorLayer!.putTileAt(f, x, y);
        else this.floorLayer!.removeTileAt(x, y);
        if (w >= 0) this.wallsLayer!.putTileAt(w, x, y);
        else this.wallsLayer!.removeTileAt(x, y);
      }
    }
  }

  /** Objects + zone overlays, from the live map or the editor draft. */
  private redrawDecor(doc: MapDoc): void {
    this.decor.forEach((o) => o.destroy());
    this.decor = [];
    for (const obj of doc.objects) {
      this.decor.push(
        this.add
          .image(px(obj.x), px(obj.y), "tiles", obj.gid)
          .setDepth(px(obj.y))
      );
    }
    for (const zone of doc.zones) {
      const color = Number.parseInt(zone.color.replace("#", ""), 16);
      this.decor.push(
        this.add
          .rectangle(
            zone.x * TILE_SIZE,
            zone.y * TILE_SIZE,
            zone.w * TILE_SIZE,
            zone.h * TILE_SIZE,
            Number.isNaN(color) ? 0x7c3aed : color,
            0.12
          )
          .setOrigin(0)
          .setDepth(2),
        this.add
          .text(zone.x * TILE_SIZE + 3, zone.y * TILE_SIZE + 2, zone.name, {
            fontFamily: "monospace",
            fontSize: "10px",
            color: zone.color,
          })
          .setDepth(2)
      );
    }
  }

  private onMapReplaced(): void {
    const { map, editor, players } = useStore.getState();
    if (!map || editor.active) return; // draft view stays until save/cancel
    this.buildMap(map);
    // The server may have respawned us out of a new wall.
    const me = players.get(this.myId);
    if (me && !this.hopping) this.snapLocal(me.x, me.y);
  }

  private snapLocal(x: number, y: number): void {
    this.localX = x;
    this.localY = y;
    const entry = this.entries.get(this.myId);
    if (entry) {
      entry.tween?.stop();
      entry.x = x;
      entry.y = y;
      entry.container.setPosition(px(x), px(y)).setDepth(px(y));
    }
  }

  // ---------- players ----------

  private syncPlayers(players: Map<string, PlayerInfo>): void {
    for (const [id, info] of players) {
      let entry = this.entries.get(id);
      if (!entry) {
        entry = this.createEntry(id, info);
        this.entries.set(id, entry);
        if (id === this.myId) {
          this.localX = info.x;
          this.localY = info.y;
        }
        continue;
      }

      const label = info.micOn ? info.name : `🔇 ${info.name}`;
      if (entry.label.text !== label) entry.label.setText(label);

      if (id === this.myId) {
        // Local movement is client-driven; only correct on server respawn.
        const idle = !this.hopping && !this.heldDirection();
        if (idle && (info.x !== this.localX || info.y !== this.localY)) {
          this.snapLocal(info.x, info.y);
        }
        continue;
      }

      if (info.x !== entry.x || info.y !== entry.y) {
        entry.x = info.x;
        entry.y = info.y;
        entry.sprite.play(`${entry.avatar}-walk-${info.dir}`, true);
        entry.tween?.stop();
        entry.tween = this.tweens.add({
          targets: entry.container,
          x: px(info.x),
          y: px(info.y),
          duration: MOVE_MS,
          onUpdate: () => entry.container.setDepth(entry.container.y),
          onComplete: () => {
            const latest = useStore.getState().players.get(id);
            if (latest && !latest.moving) this.setIdle(id, latest.dir);
          },
        });
      } else if (!info.moving) {
        this.setIdle(id, info.dir);
      }
    }

    for (const [id, entry] of this.entries) {
      if (!players.has(id)) {
        entry.tween?.stop();
        entry.container.destroy();
        this.entries.delete(id);
      }
    }
  }

  private createEntry(id: string, info: PlayerInfo): PlayerEntry {
    const avatar = (AVATARS as readonly string[]).includes(info.avatar)
      ? info.avatar
      : AVATARS[0];
    const sprite = this.add
      .sprite(0, 0, avatar, DIR_ROW[info.dir] * 3 + 1)
      .setOrigin(0.5);
    const label = this.add
      .text(0, -24, info.micOn ? info.name : `🔇 ${info.name}`, {
        fontFamily: "monospace",
        fontSize: "9px",
        color: id === this.myId ? "#9ee6a8" : "#ffffff",
        backgroundColor: "rgba(0,0,0,0.55)",
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5);
    const container = this.add
      .container(px(info.x), px(info.y), [sprite, label])
      .setDepth(px(info.y));
    return { container, sprite, label, avatar, x: info.x, y: info.y };
  }

  private setIdle(id: string, dir: Direction): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.sprite.stop();
    entry.sprite.setFrame(DIR_ROW[dir] * 3 + 1);
  }

  private heldDirection(): Direction | null {
    const k = this.keys;
    if (k.UP.isDown || k.W.isDown) return "up";
    if (k.DOWN.isDown || k.S.isDown) return "down";
    if (k.LEFT.isDown || k.A.isDown) return "left";
    if (k.RIGHT.isDown || k.D.isDown) return "right";
    return null;
  }

  // ---------- editor ----------

  private onEditorToggled(active: boolean): void {
    const cam = this.cameras.main;
    if (active) {
      cam.stopFollow();
      this.redrawEditorOverlays();
    } else {
      this.zonePreview?.clear();
      this.zoneDragStart = null;
      this.spawnMarkers.forEach((m) => m.destroy());
      this.spawnMarkers = [];
      const map = useStore.getState().map;
      if (map) this.buildMap(map); // discard painted draft tiles
      const me = useStore.getState().players.get(this.myId);
      if (me) this.snapLocal(me.x, me.y);
      const entry = this.entries.get(this.myId);
      if (entry) cam.startFollow(entry.container, true, 0.15, 0.15);
    }
  }

  /** Draft decor + spawn markers; tiles are painted incrementally. */
  private redrawEditorOverlays(): void {
    const { editor } = useStore.getState();
    if (!editor.active || !editor.draft) return;
    this.redrawDecor(editor.draft);
    this.spawnMarkers.forEach((m) => m.destroy());
    this.spawnMarkers = editor.draft.spawns.map((s) =>
      this.add.circle(px(s.x), px(s.y), 5, 0x22cc88, 0.9).setDepth(9999)
    );
  }

  private panCamera(): void {
    if (useStore.getState().typingLock) return;
    const cam = this.cameras.main;
    const k = this.keys;
    const speed = 6;
    if (k.UP.isDown || k.W.isDown) cam.scrollY -= speed;
    if (k.DOWN.isDown || k.S.isDown) cam.scrollY += speed;
    if (k.LEFT.isDown || k.A.isDown) cam.scrollX -= speed;
    if (k.RIGHT.isDown || k.D.isDown) cam.scrollX += speed;
  }

  private onEditorPointer(pointer: Phaser.Input.Pointer, isDown: boolean): void {
    const { editor } = useStore.getState();
    if (!editor.active || !editor.draft) return;
    const draft = editor.draft;
    const world = pointer.positionToCamera(
      this.cameras.main
    ) as Phaser.Math.Vector2;
    const tx = Math.floor(world.x / TILE_SIZE);
    const ty = Math.floor(world.y / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= draft.width || ty >= draft.height) return;
    const i = tileIndex(draft, tx, ty);

    switch (editor.tool) {
      case "floor":
        if (draft.layers.floor[i] === editor.gid) return;
        draft.layers.floor[i] = editor.gid;
        this.floorLayer!.putTileAt(editor.gid, tx, ty);
        bumpDraft();
        break;
      case "wall":
        if (draft.layers.walls[i] === editor.gid) return;
        draft.layers.walls[i] = editor.gid;
        this.wallsLayer!.putTileAt(editor.gid, tx, ty);
        bumpDraft();
        break;
      case "eraseWall":
        if (draft.layers.walls[i] === -1) return;
        draft.layers.walls[i] = -1;
        this.wallsLayer!.removeTileAt(tx, ty);
        bumpDraft();
        break;
      case "object": {
        if (!isDown) return;
        draft.objects = draft.objects.filter((o) => o.x !== tx || o.y !== ty);
        draft.objects.push({
          id: `o${Math.random().toString(36).slice(2, 8)}`,
          gid: editor.gid,
          x: tx,
          y: ty,
        });
        bumpDraft();
        break;
      }
      case "eraseObject": {
        if (!isDown) return;
        const before = draft.objects.length;
        draft.objects = draft.objects.filter((o) => o.x !== tx || o.y !== ty);
        if (draft.objects.length !== before) bumpDraft();
        break;
      }
      case "spawn": {
        if (!isDown) return;
        const existing = draft.spawns.findIndex(
          (s) => s.x === tx && s.y === ty
        );
        if (existing >= 0) {
          if (draft.spawns.length > 1) {
            draft.spawns.splice(existing, 1);
            bumpDraft();
          }
        } else {
          draft.spawns.push({ x: tx, y: ty });
          bumpDraft();
        }
        break;
      }
      case "zone": {
        if (isDown) this.zoneDragStart = { x: tx, y: ty };
        if (!this.zoneDragStart) return;
        const rect = this.zoneRect(this.zoneDragStart, tx, ty);
        this.zonePreview!.clear()
          .lineStyle(2, 0xffffff, 0.9)
          .strokeRect(
            rect.x * TILE_SIZE,
            rect.y * TILE_SIZE,
            rect.w * TILE_SIZE,
            rect.h * TILE_SIZE
          );
        break;
      }
    }
  }

  private onEditorPointerUp(): void {
    if (!this.zoneDragStart) return;
    const { editor } = useStore.getState();
    this.zonePreview?.clear();
    const start = this.zoneDragStart;
    this.zoneDragStart = null;
    if (!editor.active || editor.tool !== "zone" || !editor.draft) return;
    const pointer = this.input.activePointer;
    const world = pointer.positionToCamera(
      this.cameras.main
    ) as Phaser.Math.Vector2;
    const tx = Phaser.Math.Clamp(
      Math.floor(world.x / TILE_SIZE),
      0,
      editor.draft.width - 1
    );
    const ty = Phaser.Math.Clamp(
      Math.floor(world.y / TILE_SIZE),
      0,
      editor.draft.height - 1
    );
    patchEditor({ pendingZone: this.zoneRect(start, tx, ty) });
  }

  private zoneRect(
    start: { x: number; y: number },
    tx: number,
    ty: number
  ): { x: number; y: number; w: number; h: number } {
    const x = Math.min(start.x, tx);
    const y = Math.min(start.y, ty);
    return {
      x,
      y,
      w: Math.abs(start.x - tx) + 1,
      h: Math.abs(start.y - ty) + 1,
    };
  }
}
