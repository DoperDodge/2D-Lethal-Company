// Tick & timing
export const TICK_RATE = 20; // Hz, authoritative server tick
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 20; // Hz outbound to clients

// World grid
export const TILE_SIZE = 24; // pixels per tile (client render scale)
export const FACILITY_W = 80;
export const FACILITY_H = 80;
// Inset bunker footprint inside the facility map
export const BUNKER_INSET = 14;
export const BUNKER_W = FACILITY_W - BUNKER_INSET * 2;
export const BUNKER_H = FACILITY_H - BUNKER_INSET * 2;
export const SHIP_W = 22;
export const SHIP_H = 16;

// Render / loop
export const RENDER_FPS_CAP = 60;
export const SNAPSHOT_RENDER_DELAY_MS = 90; // interpolation delay (~2 ticks)

// Cutscene
export const LANDING_CUTSCENE_MS = 3500;

// Player
export const PLAYER_RADIUS = 0.35; // tiles
export const PLAYER_SPEED = 4.0; // tiles per second
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_INVENTORY_SLOTS = 4;

// Vision / FOV
export const SIGHT_CONE_DEG = 90; // forward cone
export const SIGHT_CONE_HALF_RAD = (SIGHT_CONE_DEG / 2) * (Math.PI / 180);
export const SIGHT_RANGE_FLASHLIGHT = 14; // tiles
export const SIGHT_RANGE_AMBIENT = 5; // tiles, no light source
export const PERIPHERAL_RANGE = 2; // tiles (dim)
export const FOG_REMEMBERED_ALPHA = 0.25; // dim factor for previously-seen tiles

// Chat
export const PROXIMITY_TEXT_RADIUS = 12; // tiles
export const PROXIMITY_VOICE_MAX_RADIUS = 16; // tiles for voice falloff
export const VOICE_WALL_ATTENUATION = 0.45; // multiplier per blocking tile crossed

// Lobby
export const MAX_PLAYERS_PER_LOBBY_DEFAULT = 4;
export const LOBBY_CODE_LENGTH = 4;

// Quota / day cycle
export const STARTING_CREDITS = 60;
export const STARTING_QUOTA = 130;
export const QUOTA_INCREMENT = 1.6; // multiplier each cycle
export const DAY_LENGTH_SECONDS = 240; // 4 minute days
export const DAYS_PER_QUOTA_CYCLE = 3;
export const DOOR_CLOSE_WARNING_SEC = 30;

// Network
export const HEARTBEAT_MS = 5_000;
export const CLIENT_TIMEOUT_MS = 15_000;
