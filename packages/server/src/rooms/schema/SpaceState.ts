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
}

export class SpaceState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  /** Serialized MapDoc; only changes on explicit editor save. */
  @type("string") mapJson = "";
  /** Bumped on save so clients know to rebuild the tilemap. */
  @type("number") mapVersion = 0;
}
