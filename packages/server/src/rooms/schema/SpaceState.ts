import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") name = "";
  @type("string") avatar = "avatar_0";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") dir = "down";
  @type("boolean") moving = false;
  /** "" when not inside a private area; server-derived from zone rects. */
  @type("string") zoneId = "";
  @type("boolean") micOn = true;
  @type("boolean") camOn = true;
  @type("boolean") sharing = false;
  /** True while standing on a chair object. */
  @type("boolean") sitting = false;
  /** Kart id while riding, "" otherwise. */
  @type("string") riding = "";
}

/** A rideable go-kart; unridden karts sit at (x, y). */
export class Kart extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") rider = "";
}

/** Synchronized watch-together playback for one theater zone. */
export class TheaterState extends Schema {
  @type("string") videoId = "";
  @type("boolean") playing = false;
  /** Playback position at `updatedAt`. */
  @type("number") timeMs = 0;
  /** Server wall-clock when timeMs was captured. */
  @type("number") updatedAt = 0;
}

/** Music playing from one placed speaker object; heard room-wide. */
export class SpeakerState extends Schema {
  /** Validated music source: "provider:key" (see shared parseMusicSource). */
  @type("string") provider = "";
  @type("string") key = "";
  @type("boolean") playing = false;
  /** Playback position at `updatedAt` (YouTube sync only). */
  @type("number") timeMs = 0;
  @type("number") updatedAt = 0;
}

export class SpaceState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  /** Serialized MapDoc; only changes on explicit editor save. */
  @type("string") mapJson = "";
  /** Bumped on save so clients know to rebuild the tilemap. */
  @type("number") mapVersion = 0;
  /** zoneId -> playback state, for zones with kind "theater". */
  @type({ map: TheaterState }) theaters = new MapSchema<TheaterState>();
  /** kartId (map object id) -> kart. */
  @type({ map: Kart }) karts = new MapSchema<Kart>();
  /** "x,y" -> locked, for door objects. Runtime-only state. */
  @type({ map: "boolean" }) doors = new MapSchema<boolean>();
  /** speaker object id -> music playback. Runtime-only state. */
  @type({ map: SpeakerState }) speakers = new MapSchema<SpeakerState>();
}
