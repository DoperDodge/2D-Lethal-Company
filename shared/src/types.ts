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
  ShipExit: 7,
  CompanyDesk: 8,
  // Exterior surface (walkable dusty ground)
  Exterior: 9,
  // Impassable rocky terrain outside
  ExteriorRock: 10,
  // Painted hazard pad where the dropship lands (walkable)
  LandingPad: 11,
  // Main facility entrance door (walkable, marks transition exterior -> interior)
  FacilityEntrance: 12,
  // Ship interior decor (non-blocking visual)
  ShipTerminal: 13,
  ShipChargeStation: 14,
  ShipBunk: 15,
  ShipLocker: 16,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

export const Scene = {
  Ship: "ship",
  Facility: "facility",
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

export type FacilityState = {
  moonId: string;
  moonName?: string;
  seed: number;
  scene: TileGrid;
  scrap: ScrapInstance[];
  items: ItemInstance[];
  monsters: Monster[];
  // Where the dropship pad is on the facility map (player spawn for landings)
  shipExit: Vec2;
  // Main entrance to the bunker — visual marker used by the cutscene's "find the door" prompt
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
