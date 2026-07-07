import Phaser from "phaser";
import {
  AVATARS,
  DOOR_GID,
  EMOTES,
  KART_GID,
  KART_SPEED_FACTOR,
  MOVE_MS,
  TILE_SIZE,
  isWalkable,
  tileIndex,
  type Direction,
  type MapDoc,
} from "@gather/shared";
import { bumpDraft, patchEditor, useStore, type PlayerInfo } from "../store";
import {
  sendDoorToggle,
  sendEmote,
  sendKartDismount,
  sendKartMount,
  sendMove,
} from "../net/connection";

const DIR_ROW: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };
const DIR_DELTA: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

const px = (tile: number) => tile * TILE_SIZE + TILE_SIZE / 2;

const EMOTE_KEYS = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"] as const;

/** Bresenham line between two tiles, inclusive of both endpoints. */
function lineTiles(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Array<[number, number]> {
  const tiles: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    tiles.push([x, y]);
    if (x === x1 && y === y1) return tiles;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

interface PlayerEntry {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  /** Kart drawn under the avatar while riding. */
  kart?: Phaser.GameObjects.Image;
  avatar: string;
  /** Tile position this entry is at or tweening toward. */
  x: number;
  y: number;
  tween?: Phaser.Tweens.Tween;
}

/** Frame slots occupied by the base sheet (8×8 grid of 32px tiles). */
const BASE_FRAMES = 64;
const SHEET_COLS = 8;
/** Live texture combining the base sheet with the map's custom tiles. */
const TILES_KEY = "tiles-live";

export class SpaceScene extends Phaser.Scene {
  private tilemap?: Phaser.Tilemaps.Tilemap;
  private floorLayer?: Phaser.Tilemaps.TilemapLayer;
  private wallsLayer?: Phaser.Tilemaps.TilemapLayer;
  private decor: Phaser.GameObjects.GameObject[] = [];
  /** gid → frame index in the live texture, for custom tiles. */
  private customFrames = new Map<number, number>();
  /** Signature of the custom tiles baked into the live texture. */
  private tilesSig: string | null = null;
  private buildSeq = 0;
  private worldW = 0;
  private worldH = 0;
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

  private kartSprites = new Map<string, Phaser.GameObjects.Image>();
  /** Door decor images by "x,y", for lock tinting. */
  private doorSprites = new Map<string, Phaser.GameObjects.Image>();

  private zoneDragStart: { x: number; y: number } | null = null;
  private zonePreview?: Phaser.GameObjects.Graphics;
  /** Last tile painted in the current drag, for stroke interpolation. */
  private lastPaint: { x: number; y: number } | null = null;

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

    // enableCapture=false: capturing preventDefaults these keys globally,
    // which silently ate W/A/S/D (and arrow cursoring) in the chat input.
    this.keys = this.input.keyboard!.addKeys(
      "W,A,S,D,UP,DOWN,LEFT,RIGHT,E,ONE,TWO,THREE,FOUR,FIVE,SIX",
      false
    ) as Record<string, Phaser.Input.Keyboard.Key>;
    // Event-based (not JustDown polling): key state can be reset between
    // the DOM event and the next update tick, e.g. on focus changes.
    EMOTE_KEYS.forEach((key, i) => {
      this.keys[key].on(
        Phaser.Input.Keyboard.Events.DOWN,
        (_key: unknown, e: KeyboardEvent | undefined) => {
          const { typingLock, editor } = useStore.getState();
          if (!typingLock && !editor.active && !e?.repeat) sendEmote(i);
        }
      );
    });
    if (import.meta.env.DEV) (window as any).__scene = this;

    const store = useStore.getState();
    this.myId = store.sessionId;
    void this.buildMap(store.map!);
    this.syncPlayers(store.players);

    const me = this.entries.get(this.myId);
    if (me) {
      this.localX = Math.round((me.container.x - TILE_SIZE / 2) / TILE_SIZE);
      this.localY = Math.round((me.container.y - TILE_SIZE / 2) / TILE_SIZE);
      this.cameras.main.startFollow(me.container, true, 0.15, 0.15);
    }
    this.cameras.main.setZoom(2);

    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_p: unknown, _over: unknown, _dx: number, dy: number) => {
        const cam = this.cameras.main;
        cam.setZoom(
          Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 1 / 1.15 : 1.15), 1, 4)
        );
        // Re-pad bounds so a fully zoomed-out view stays centered.
        this.applyCameraBounds();
      }
    );
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.applyCameraBounds());

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
      ),
      useStore.subscribe(
        (s) => s.karts,
        (karts) => this.syncKarts(karts)
      ),
      useStore.subscribe(
        (s) => s.lockedDoors,
        (locked) => this.tintDoors(locked)
      ),
      useStore.subscribe(
        (s) => s.emotes,
        (emotes) => this.syncEmotes(emotes)
      ),
      useStore.subscribe(
        (s) => s.locate,
        (locate) => {
          if (locate) this.locatePlayer(locate.id);
        }
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

    // E hops off a kart, leaving it on the current tile.
    if (
      Phaser.Input.Keyboard.JustDown(this.keys.E) &&
      useStore.getState().players.get(this.myId)?.riding
    ) {
      sendKartDismount();
      return;
    }

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

    const doorLocked = useStore.getState().lockedDoors.has(`${nx},${ny}`);
    if (!map || !isWalkable(map, nx, ny) || doorLocked) {
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

    // Stepping next to or onto a free kart mounts it.
    const riding = useStore.getState().players.get(this.myId)?.riding;
    if (!riding) {
      for (const [kartId, kart] of useStore.getState().karts) {
        if (!kart.rider && kart.x === nx && kart.y === ny) {
          sendKartMount(kartId);
          break;
        }
      }
    }

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
      duration: riding ? MOVE_MS / KART_SPEED_FACTOR : MOVE_MS,
      onUpdate: () => entry.container.setDepth(entry.container.y),
      onComplete: () => {
        this.hopping = false;
      },
    });
  }

  // ---------- map rendering ----------

  private frameForGid(gid: number): number {
    if (gid < BASE_FRAMES) return gid;
    return this.customFrames.get(gid) ?? -1;
  }

  /**
   * Rebuild the live texture: base sheet on top, the map's custom tiles
   * appended below (frame = BASE_FRAMES + index). Data URLs decode
   * asynchronously, so map builds await this.
   */
  private async prepareTiles(doc: MapDoc): Promise<void> {
    const customs = doc.customTiles ?? [];
    const sig = customs.map((c) => `${c.gid}:${c.data.length}`).join(",");
    if (sig === this.tilesSig && this.textures.exists(TILES_KEY)) return;

    const total = BASE_FRAMES + customs.length;
    const rows = Math.ceil(total / SHEET_COLS);
    const canvas = document.createElement("canvas");
    canvas.width = SHEET_COLS * TILE_SIZE;
    canvas.height = rows * TILE_SIZE;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.textures.get("tiles").getSourceImage() as CanvasImageSource,
      0,
      0
    );

    const frames = new Map<number, number>();
    await Promise.all(
      customs.map(
        (c, i) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              const f = BASE_FRAMES + i;
              ctx.drawImage(
                img,
                (f % SHEET_COLS) * TILE_SIZE,
                Math.floor(f / SHEET_COLS) * TILE_SIZE,
                TILE_SIZE,
                TILE_SIZE
              );
              frames.set(c.gid, f);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = c.data;
          })
      )
    );

    if (this.textures.exists(TILES_KEY)) this.textures.remove(TILES_KEY);
    const tex = this.textures.addCanvas(TILES_KEY, canvas)!;
    for (let f = 0; f < total; f++) {
      tex.add(
        f,
        0,
        (f % SHEET_COLS) * TILE_SIZE,
        Math.floor(f / SHEET_COLS) * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE
      );
    }
    this.customFrames = frames;
    this.tilesSig = sig;
  }

  private async buildMap(doc: MapDoc): Promise<void> {
    const seq = ++this.buildSeq;
    // Destroy consumers of the live texture before it is replaced.
    this.decor.forEach((o) => o.destroy());
    this.decor = [];
    this.floorLayer?.destroy();
    this.wallsLayer?.destroy();
    this.tilemap?.destroy();
    this.floorLayer = undefined;
    this.wallsLayer = undefined;
    this.tilemap = undefined;

    await this.prepareTiles(doc);
    if (seq !== this.buildSeq) return; // superseded by a newer build

    this.tilemap = this.make.tilemap({
      width: doc.width,
      height: doc.height,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const tileset = this.tilemap.addTilesetImage(
      TILES_KEY,
      TILES_KEY,
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

    this.worldW = doc.width * TILE_SIZE;
    this.worldH = doc.height * TILE_SIZE;
    this.applyCameraBounds();
  }

  /**
   * Camera bounds padded so that when the viewport outgrows the world
   * (zoomed fully out or a small map), clamping centers the world on
   * screen instead of pinning it to the top-left.
   */
  private applyCameraBounds(): void {
    if (!this.worldW) return;
    const cam = this.cameras.main;
    const padX = Math.max(0, (cam.displayWidth - this.worldW) / 2);
    const padY = Math.max(0, (cam.displayHeight - this.worldH) / 2);
    cam.setBounds(-padX, -padY, this.worldW + padX * 2, this.worldH + padY * 2);
  }

  private fillLayers(doc: MapDoc): void {
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        const i = tileIndex(doc, x, y);
        const f = doc.layers.floor[i] >= 0 ? this.frameForGid(doc.layers.floor[i]) : -1;
        const w = doc.layers.walls[i] >= 0 ? this.frameForGid(doc.layers.walls[i]) : -1;
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
    this.doorSprites.clear();
    for (const obj of doc.objects) {
      const frame = this.frameForGid(obj.gid);
      if (frame < 0) continue; // design was deleted
      if (obj.gid === KART_GID) continue; // karts render from live state
      const img = this.add
        .image(px(obj.x), px(obj.y), TILES_KEY, frame)
        .setDepth(px(obj.y));
      if (obj.gid === DOOR_GID) {
        this.doorSprites.set(`${obj.x},${obj.y}`, img);
      }
      this.decor.push(img);
    }
    this.tintDoors(useStore.getState().lockedDoors);
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
            resolution: 4,
          })
          .setDepth(2)
      );
    }
  }

  private onMapReplaced(): void {
    const { map, editor, players } = useStore.getState();
    if (!map || editor.active) return; // draft view stays until save/cancel
    void this.buildMap(map);
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
        this.applySeatAndKart(entry, info);
        // Local movement is client-driven; only correct on server respawn.
        const idle = !this.hopping && !this.heldDirection();
        if (idle && (info.x !== this.localX || info.y !== this.localY)) {
          this.snapLocal(info.x, info.y);
        }
        continue;
      }

      this.applySeatAndKart(entry, info);

      if (info.x !== entry.x || info.y !== entry.y) {
        entry.x = info.x;
        entry.y = info.y;
        entry.sprite.play(`${entry.avatar}-walk-${info.dir}`, true);
        entry.tween?.stop();
        entry.tween = this.tweens.add({
          targets: entry.container,
          x: px(info.x),
          y: px(info.y),
          duration: info.riding ? MOVE_MS / KART_SPEED_FACTOR : MOVE_MS,
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
        // Render the texture at 4x so camera zoom doesn't blur it.
        resolution: 4,
      })
      .setOrigin(0.5);
    const container = this.add
      .container(px(info.x), px(info.y), [sprite, label])
      .setDepth(px(info.y));
    return { container, sprite, label, avatar, x: info.x, y: info.y };
  }

  /** Chair squat + kart-under-avatar visuals, driven by server state. */
  private applySeatAndKart(entry: PlayerEntry, info: PlayerInfo): void {
    entry.sprite.y = info.sitting ? 6 : 0;
    if (info.riding && !entry.kart) {
      const frame = this.frameForGid(KART_GID);
      entry.kart = this.add.image(0, 6, TILES_KEY, frame);
      entry.container.addAt(entry.kart, 0);
    } else if (!info.riding && entry.kart) {
      entry.kart.destroy();
      entry.kart = undefined;
    }
  }

  /** Unridden karts sit on the map; ridden ones render under their rider. */
  private syncKarts(karts: Map<string, { x: number; y: number; rider: string }>): void {
    for (const [id, kart] of karts) {
      let img = this.kartSprites.get(id);
      if (kart.rider) {
        img?.destroy();
        this.kartSprites.delete(id);
        continue;
      }
      if (!img) {
        const frame = this.frameForGid(KART_GID);
        img = this.add.image(px(kart.x), px(kart.y), TILES_KEY, frame);
        this.kartSprites.set(id, img);
      }
      img.setPosition(px(kart.x), px(kart.y)).setDepth(px(kart.y) - 1);
    }
    for (const [id, img] of this.kartSprites) {
      if (!karts.has(id)) {
        img.destroy();
        this.kartSprites.delete(id);
      }
    }
  }

  private tintDoors(locked: Set<string>): void {
    for (const [key, img] of this.doorSprites) {
      const isLocked = locked.has(key);
      img.setAlpha(isLocked ? 1 : 0.55);
      img.setTint(isLocked ? 0xff8888 : 0xffffff);
    }
  }

  private lastEmoteSeq = new Map<string, number>();

  /** Float the new reactions up from their sender's head. */
  private syncEmotes(emotes: Map<string, { emote: number; seq: number }>): void {
    for (const [id, e] of emotes) {
      if (this.lastEmoteSeq.get(id) === e.seq) continue;
      this.lastEmoteSeq.set(id, e.seq);
      const entry = this.entries.get(id);
      if (!entry) continue;
      const text = this.add
        .text(entry.container.x, entry.container.y - 34, EMOTES[e.emote], {
          fontSize: "18px",
          resolution: 4,
        })
        .setOrigin(0.5)
        .setDepth(10000);
      this.tweens.add({
        targets: text,
        y: text.y - 24,
        alpha: 0,
        duration: 1800,
        ease: "Cubic.easeOut",
        onComplete: () => text.destroy(),
      });
    }
  }

  /** Fly the camera to a player, pulse a ring on them, then fly back. */
  private locatePlayer(id: string): void {
    if (useStore.getState().editor.active) return;
    const target = this.entries.get(id);
    if (!target) return;
    const cam = this.cameras.main;
    cam.stopFollow();
    cam.pan(target.container.x, target.container.y, 450, "Sine.easeInOut");
    const ring = this.add
      .circle(target.container.x, target.container.y - 4, 12)
      .setStrokeStyle(3, 0xffd166, 1)
      .setDepth(10001);
    this.tweens.add({
      targets: ring,
      scale: 2,
      alpha: 0,
      duration: 550,
      repeat: 2,
      onComplete: () => ring.destroy(),
    });
    this.time.delayedCall(1900, () => {
      const me = this.entries.get(this.myId);
      if (!me || useStore.getState().editor.active) return;
      cam.pan(me.container.x, me.container.y, 450, "Sine.easeInOut");
      this.time.delayedCall(470, () =>
        cam.startFollow(me.container, true, 0.15, 0.15)
      );
    });
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
    return useStore.getState().touchDir;
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
      if (map) void this.buildMap(map); // discard painted draft tiles
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
    // A new/removed custom design means the live texture is stale; a full
    // rebuild (from the draft, preserving painted tiles) re-bakes it.
    const sig = (editor.draft.customTiles ?? [])
      .map((c) => `${c.gid}:${c.data.length}`)
      .join(",");
    if (sig !== this.tilesSig) {
      void this.buildMap(editor.draft);
      return; // buildMap redraws decor; spawn markers redraw below next rev
    }
    this.redrawDecor(editor.draft);
    this.spawnMarkers.forEach((m) => m.destroy());
    // Rings below the players so a spawn under someone's feet doesn't
    // read as a dot stuck on them.
    this.spawnMarkers = editor.draft.spawns.map((s) =>
      this.add
        .circle(px(s.x), px(s.y), 9, 0x22cc88, 0.15)
        .setStrokeStyle(2, 0x22cc88, 0.9)
        .setDepth(3)
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
    if (!editor.active || !editor.draft) {
      if (isDown && !editor.active) this.onWorldClick(pointer);
      return;
    }
    const draft = editor.draft;
    const world = pointer.positionToCamera(
      this.cameras.main
    ) as Phaser.Math.Vector2;
    const tx = Math.floor(world.x / TILE_SIZE);
    const ty = Math.floor(world.y / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= draft.width || ty >= draft.height) return;

    switch (editor.tool) {
      case "floor":
      case "wall":
      case "eraseWall": {
        // Fast drags skip tiles between pointer events; paint the whole
        // stroke from the previous position.
        const from = isDown || !this.lastPaint ? { x: tx, y: ty } : this.lastPaint;
        let changed = false;
        for (const [px_, py_] of lineTiles(from.x, from.y, tx, ty)) {
          if (this.paintTile(draft, editor.tool, editor.gid, px_, py_)) {
            changed = true;
          }
        }
        this.lastPaint = { x: tx, y: ty };
        if (changed) bumpDraft();
        break;
      }
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

  /** Clicking an adjacent door toggles its lock. */
  private onWorldClick(pointer: Phaser.Input.Pointer): void {
    const map = useStore.getState().map;
    if (!map) return;
    const world = pointer.positionToCamera(
      this.cameras.main
    ) as Phaser.Math.Vector2;
    const tx = Math.floor(world.x / TILE_SIZE);
    const ty = Math.floor(world.y / TILE_SIZE);
    const isDoor = map.objects.some(
      (o) => o.gid === DOOR_GID && o.x === tx && o.y === ty
    );
    if (!isDoor) return;
    if (Math.max(Math.abs(this.localX - tx), Math.abs(this.localY - ty)) > 1) {
      return;
    }
    sendDoorToggle(tx, ty);
  }

  private paintTile(
    draft: MapDoc,
    tool: "floor" | "wall" | "eraseWall",
    gid: number,
    tx: number,
    ty: number
  ): boolean {
    if (tx < 0 || ty < 0 || tx >= draft.width || ty >= draft.height) {
      return false;
    }
    const i = tileIndex(draft, tx, ty);
    switch (tool) {
      case "floor": {
        if (draft.layers.floor[i] === gid) return false;
        draft.layers.floor[i] = gid;
        const f = this.frameForGid(gid);
        if (f >= 0) this.floorLayer!.putTileAt(f, tx, ty);
        return true;
      }
      case "wall": {
        if (draft.layers.walls[i] === gid) return false;
        draft.layers.walls[i] = gid;
        const f = this.frameForGid(gid);
        if (f >= 0) this.wallsLayer!.putTileAt(f, tx, ty);
        return true;
      }
      case "eraseWall":
        if (draft.layers.walls[i] === -1) return false;
        draft.layers.walls[i] = -1;
        this.wallsLayer!.removeTileAt(tx, ty);
        return true;
    }
  }

  private onEditorPointerUp(): void {
    this.lastPaint = null;
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
