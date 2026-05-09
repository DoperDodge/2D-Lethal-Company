export type PlayerId = string;
export type LobbyCode = string;
export type EntityId = number;
export type ItemId = string;

export type Vec2 = { x: number; y: number };

export const TileType = {
  Empty: 0,
  Floor: 1,
  Wall: 2,
  Door: 3,
  Vent: 4,
  ShipFloor: 5,
  ShipWall: 6,
  // Ship console: press E to open the buy/launch terminal.
  ShipConsole: 7,
  // Sell desk inside the company building (only on the Atrium sell moon).
  CompanyDesk: 8,
  // Outdoor moon surface (walkable dusty/concrete ground).
  Exterior: 9,
  // Impassable rocky terrain outside.
  ExteriorRock: 10,
  // Painted hazard pad where the ship is parked on a moon.
  LandingPad: 11,
  // Door between the moon surface and the procgen facility interior.
  FacilityEntrance: 12,
  // Decor inside the ship.
  ShipTerminal: 13,
  ShipChargeStation: 14,
  ShipBunk: 15,
  ShipLocker: 16,
  // Door between the moon surface and the inside of the ship.
  ShipDoor: 17,
  // Door between the moon surface and the company building (Atrium only).
  CompanyDoor: 18,
  // Walkable concrete plaza outside the company building.
  CompanyPlaza: 19,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

// Scene id: "ship" | "surface" | "interior" | "company".
// Players' positions are relative to the grid of whichever scene they're in.
export const Scene = {
  Ship: "ship",
  Surface: "surface",
  Interior: "interior",
  Company: "company",
} as const;
export type Scene = (typeof Scene)[keyof typeof Scene];

export type TileGrid = {
  w: number;
  h: number;
  tiles: Uint8Array; // length w*h, values from TileType
};

export type ScrapInstance = {
  id: EntityId;
  itemId: ItemId;
  pos: Vec2;
  value: number; // credit value
  carriedBy: PlayerId | null;
};

export type ItemInstance = {
  id: EntityId;
  itemId: ItemId;
  pos: Vec2;
  carriedBy: PlayerId | null;
};

export const MonsterKind = {
  Stalker: "stalker",
} as const;
export type MonsterKind = (typeof MonsterKind)[keyof typeof MonsterKind];

export type Monster = {
  id: EntityId;
  kind: MonsterKind;
  pos: Vec2;
  facing: number; // radians
  hp: number;
  state: "idle" | "wander" | "chase" | "attack";
  targetId: PlayerId | null;
};

export type PlayerState = {
  id: PlayerId;
  name: string;
  color: string;
  pos: Vec2;
  facing: number; // radians, where the player is looking
  vel: Vec2;
  hp: number;
  alive: boolean;
  scene: Scene;
  inventory: (ItemInstance | null)[];
  selectedSlot: number;
  flashlightOn: boolean;
  credits: number; // shared crew credits mirrored for HUD
  ping: number;
};

export type LobbyPhase = "lobby" | "in_ship" | "landing" | "in_facility" | "returning" | "day_end" | "game_over";

export type ShipState = {
  scene: TileGrid;
};

// One scene's static layout + initial entities.
// Sent on scene-change. Snapshots only carry per-tick state for the player's current scene.
export type SceneState = {
  scene: Scene;
  moonId?: string;
  moonName?: string;
  seed?: number;
  grid: TileGrid;
  scrap: ScrapInstance[];
  items: ItemInstance[];
  monsters: Monster[];
};

// Backwards-compat shape used by the protocol's scene_facility messages.
export type FacilityState = {
  moonId: string;
  moonName?: string;
  seed: number;
  scene: TileGrid;
  scrap: ScrapInstance[];
  items: ItemInstance[];
  monsters: Monster[];
  shipExit: Vec2;
  entrance?: Vec2;
};

export type GameSnapshot = {
  tick: number;
  phase: LobbyPhase;
  dayNumber: number;
  daysRemaining: number; // until quota
  quota: number;
  scrapSold: number;
  credits: number;
  timeRemaining: number; // seconds left in day
  players: PlayerState[];
  monsters: Monster[];
  scrap: ScrapInstance[];
  items: ItemInstance[];
};
