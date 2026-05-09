import {
  BUNKER_H,
  BUNKER_INSET,
  BUNKER_W,
  FACILITY_H,
  FACILITY_W,
  ITEMS,
  MOONS,
  MonsterKind,
  SCRAP_ITEMS,
  TileType,
} from "@quota/shared";
import type { Monster, ScrapInstance, ItemInstance, TileGrid, Vec2 } from "@quota/shared";
import { makeRng, rngInt, rngPick } from "./rng.js";
import { setTile, tileAt } from "../world/grid.js";

type Room = {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
};

let nextEntityId = 100_000;
const newId = () => nextEntityId++;

export type GeneratedFacility = {
  scene: TileGrid;
  scrap: ScrapInstance[];
  items: ItemInstance[];
  monsters: Monster[];
  shipExit: Vec2; // landing pad center (outdoors)
  entrance: Vec2; // bunker main door (where exterior meets interior)
};

const BUNKER_X0 = BUNKER_INSET;
const BUNKER_Y0 = BUNKER_INSET;
const BUNKER_X1 = BUNKER_INSET + BUNKER_W - 1;
const BUNKER_Y1 = BUNKER_INSET + BUNKER_H - 1;
const ENTRANCE_X = Math.floor(FACILITY_W / 2);
const ENTRANCE_Y = BUNKER_Y1; // south wall of bunker
const LANDING_PAD_CY = BUNKER_Y1 + 7; // 7 tiles south of entrance

export function generateFacility(moonId: string, seed: number): GeneratedFacility {
  const moon = MOONS[moonId] ?? MOONS["experimentation"]!;
  for (let attempt = 0; attempt < 5; attempt++) {
    const rng = makeRng(seed + attempt * 7919);
    const result = tryGenerate(moon, rng);
    if (result) return result;
  }
  return fallbackFacility();
}

function tryGenerate(
  moon: { id: string; scrapMin: number; scrapMax: number; monsterBudget: number },
  rng: () => number,
): GeneratedFacility | null {
  const w = FACILITY_W;
  const h = FACILITY_H;
  const tiles = new Uint8Array(w * h);
  const grid: TileGrid = { w, h, tiles };

  // 1. Fill the entire map with exterior surface
  tiles.fill(TileType.Exterior);

  // 2. Scatter exterior rocks for visual interest, biased away from the path
  scatterExteriorRocks(grid, rng);

  // 3. Carve the bunker footprint: walls on perimeter, walls on interior (will be overwritten by rooms)
  for (let y = BUNKER_Y0; y <= BUNKER_Y1; y++) {
    for (let x = BUNKER_X0; x <= BUNKER_X1; x++) {
      setTile(grid, x, y, TileType.Wall);
    }
  }

  // 4. Procgen rooms inside the bunker
  const numRooms = rngInt(rng, 8, 12);
  const rooms: Room[] = [];
  // Always reserve a "lobby" room near the entrance
  const lobbyW = rngInt(rng, 6, 8);
  const lobbyH = rngInt(rng, 5, 7);
  const lobby: Room = {
    x: ENTRANCE_X - Math.floor(lobbyW / 2),
    y: BUNKER_Y1 - lobbyH - 1,
    w: lobbyW,
    h: lobbyH,
    cx: 0,
    cy: 0,
  };
  lobby.cx = Math.floor(lobby.x + lobby.w / 2);
  lobby.cy = Math.floor(lobby.y + lobby.h / 2);
  if (
    lobby.x < BUNKER_X0 + 1 ||
    lobby.y < BUNKER_Y0 + 1 ||
    lobby.x + lobby.w > BUNKER_X1 ||
    lobby.y + lobby.h > BUNKER_Y1
  ) {
    return null;
  }
  rooms.push(lobby);
  carveRoom(grid, lobby);

  // Place additional rooms inside the bunker, avoiding overlap with reserved rooms
  let placeAttempts = 0;
  while (rooms.length < numRooms && placeAttempts < 250) {
    placeAttempts++;
    const rw = rngInt(rng, 5, 9);
    const rh = rngInt(rng, 5, 9);
    const rx = rngInt(rng, BUNKER_X0 + 1, BUNKER_X1 - rw - 1);
    const ry = rngInt(rng, BUNKER_Y0 + 1, BUNKER_Y1 - rh - 1);
    const room: Room = {
      x: rx,
      y: ry,
      w: rw,
      h: rh,
      cx: Math.floor(rx + rw / 2),
      cy: Math.floor(ry + rh / 2),
    };
    if (rooms.some((r) => roomsOverlap(r, room, 1))) continue;
    rooms.push(room);
    carveRoom(grid, room);
  }

  if (rooms.length < 4) return null;

  // 5. Connect rooms with L-corridors in placement order
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1]!;
    const b = rooms[i]!;
    if (rng() < 0.5) {
      carveHCorridor(grid, a.cx, b.cx, a.cy);
      carveVCorridor(grid, a.cy, b.cy, b.cx);
    } else {
      carveVCorridor(grid, a.cy, b.cy, a.cx);
      carveHCorridor(grid, a.cx, b.cx, b.cy);
    }
  }

  // 6. Carve the entrance door on the south bunker wall, connecting exterior to lobby
  setTile(grid, ENTRANCE_X, ENTRANCE_Y, TileType.FacilityEntrance);
  setTile(grid, ENTRANCE_X + 1, ENTRANCE_Y, TileType.FacilityEntrance);
  // Make sure the lobby connects to the entrance (carve a small corridor if needed)
  for (let y = lobby.y + lobby.h; y <= ENTRANCE_Y; y++) {
    setTile(grid, ENTRANCE_X, y, TileType.Floor);
    setTile(grid, ENTRANCE_X + 1, y, TileType.Floor);
  }
  setTile(grid, ENTRANCE_X, ENTRANCE_Y, TileType.FacilityEntrance);
  setTile(grid, ENTRANCE_X + 1, ENTRANCE_Y, TileType.FacilityEntrance);

  // 7. Connectivity check: every room must be reachable from the entrance
  if (!isConnected(grid, rooms, { x: ENTRANCE_X, y: ENTRANCE_Y - 1 })) return null;

  // 8. Carve the landing pad on the exterior, south of the entrance
  carveLandingPad(grid, ENTRANCE_X, LANDING_PAD_CY);
  // Clear a path from landing pad to entrance so rocks don't block movement
  for (let y = ENTRANCE_Y + 1; y < LANDING_PAD_CY - 2; y++) {
    setTile(grid, ENTRANCE_X, y, TileType.Exterior);
    setTile(grid, ENTRANCE_X + 1, y, TileType.Exterior);
    setTile(grid, ENTRANCE_X - 1, y, TileType.Exterior);
    setTile(grid, ENTRANCE_X + 2, y, TileType.Exterior);
  }

  // 9. Add a couple of decorative doors at room boundaries
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i]!;
    if (rng() < 0.35) setTile(grid, r.cx, r.y, TileType.Door);
  }

  // 10. Scrap placement — interior rooms only, biased away from lobby
  const scrapCount = rngInt(rng, moon.scrapMin, moon.scrapMax);
  const scrap: ScrapInstance[] = [];
  for (let i = 0; i < scrapCount; i++) {
    const room = rooms[rngInt(rng, 1, rooms.length - 1)]!;
    const sx = rngInt(rng, room.x + 1, room.x + room.w - 2);
    const sy = rngInt(rng, room.y + 1, room.y + room.h - 2);
    if (tileAt(grid, sx, sy) !== TileType.Floor) continue;
    const itemId = rngPick(rng, SCRAP_ITEMS);
    const baseValue = ITEMS[itemId]?.baseValue ?? 10;
    const value = Math.max(1, Math.floor(baseValue * (0.7 + rng() * 0.6)));
    scrap.push({
      id: newId(),
      itemId,
      pos: { x: sx + 0.5, y: sy + 0.5 },
      value,
      carriedBy: null,
    });
  }

  // 11. Monster placement — far from the lobby
  const monsters: Monster[] = [];
  for (let i = 0; i < moon.monsterBudget; i++) {
    const room = rooms[rngInt(rng, Math.max(1, rooms.length - 4), rooms.length - 1)]!;
    monsters.push({
      id: newId(),
      kind: MonsterKind.Stalker,
      pos: { x: room.cx + 0.5, y: room.cy + 0.5 },
      facing: rng() * Math.PI * 2,
      hp: 50,
      state: "wander",
      targetId: null,
    });
  }

  return {
    scene: grid,
    scrap,
    items: [],
    monsters,
    shipExit: { x: ENTRANCE_X + 0.5, y: LANDING_PAD_CY + 0.5 },
    entrance: { x: ENTRANCE_X + 0.5, y: ENTRANCE_Y + 0.5 },
  };
}

function scatterExteriorRocks(g: TileGrid, rng: () => number): void {
  // Border the map with a ring of rocks (impassable map edge)
  for (let x = 0; x < g.w; x++) {
    setTile(g, x, 0, TileType.ExteriorRock);
    setTile(g, x, g.h - 1, TileType.ExteriorRock);
  }
  for (let y = 0; y < g.h; y++) {
    setTile(g, 0, y, TileType.ExteriorRock);
    setTile(g, g.w - 1, y, TileType.ExteriorRock);
  }
  // Random scattered rocks across the exterior (leave a margin around bunker)
  const total = g.w * g.h;
  const targetRocks = Math.floor(total * 0.04);
  let placed = 0;
  let attempts = 0;
  while (placed < targetRocks && attempts < targetRocks * 10) {
    attempts++;
    const x = rngInt(rng, 1, g.w - 2);
    const y = rngInt(rng, 1, g.h - 2);
    // Keep area between landing pad and entrance clear
    if (x >= BUNKER_X0 - 1 && x <= BUNKER_X1 + 1 && y >= BUNKER_Y0 - 1 && y <= BUNKER_Y1 + 1) continue;
    if (
      Math.abs(x - ENTRANCE_X) < 4 &&
      y > BUNKER_Y1 &&
      y < LANDING_PAD_CY + 4
    ) {
      continue;
    }
    if (g.tiles[y * g.w + x] !== TileType.Exterior) continue;
    setTile(g, x, y, TileType.ExteriorRock);
    placed++;
  }
}

function carveLandingPad(g: TileGrid, cx: number, cy: number): void {
  // 5x5 pad with painted hazard markings
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setTile(g, cx + dx, cy + dy, TileType.LandingPad);
    }
  }
}

function roomsOverlap(a: Room, b: Room, pad: number): boolean {
  return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
}

function carveRoom(g: TileGrid, r: Room): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      setTile(g, x, y, TileType.Floor);
    }
  }
}
function carveHCorridor(g: TileGrid, x1: number, x2: number, y: number): void {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  for (let x = lo; x <= hi; x++) {
    setTile(g, x, y, TileType.Floor);
    setTile(g, x, y + 1, TileType.Floor);
  }
}
function carveVCorridor(g: TileGrid, y1: number, y2: number, x: number): void {
  const lo = Math.min(y1, y2);
  const hi = Math.max(y1, y2);
  for (let y = lo; y <= hi; y++) {
    setTile(g, x, y, TileType.Floor);
    setTile(g, x + 1, y, TileType.Floor);
  }
}

function isConnected(g: TileGrid, rooms: Room[], from: { x: number; y: number }): boolean {
  const seen = new Uint8Array(g.w * g.h);
  const q: number[] = [from.y * g.w + from.x];
  seen[from.y * g.w + from.x] = 1;
  while (q.length > 0) {
    const idx = q.shift()!;
    const x = idx % g.w;
    const y = Math.floor(idx / g.w);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of dirs) {
      const nx = x + dx!;
      const ny = y + dy!;
      const nIdx = ny * g.w + nx;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      if (seen[nIdx]) continue;
      const t = g.tiles[nIdx];
      if (t === TileType.Floor || t === TileType.Door || t === TileType.FacilityEntrance) {
        seen[nIdx] = 1;
        q.push(nIdx);
      }
    }
  }
  for (const r of rooms) {
    if (!seen[r.cy * g.w + r.cx]) return false;
  }
  return true;
}

function fallbackFacility(): GeneratedFacility {
  const w = FACILITY_W;
  const h = FACILITY_H;
  const tiles = new Uint8Array(w * h);
  tiles.fill(TileType.Exterior);
  const grid: TileGrid = { w, h, tiles };
  // Map border
  for (let x = 0; x < w; x++) {
    setTile(grid, x, 0, TileType.ExteriorRock);
    setTile(grid, x, h - 1, TileType.ExteriorRock);
  }
  for (let y = 0; y < h; y++) {
    setTile(grid, 0, y, TileType.ExteriorRock);
    setTile(grid, w - 1, y, TileType.ExteriorRock);
  }
  // One open bunker
  for (let y = BUNKER_Y0; y <= BUNKER_Y1; y++) {
    for (let x = BUNKER_X0; x <= BUNKER_X1; x++) {
      const onEdge = x === BUNKER_X0 || x === BUNKER_X1 || y === BUNKER_Y0 || y === BUNKER_Y1;
      setTile(grid, x, y, onEdge ? TileType.Wall : TileType.Floor);
    }
  }
  setTile(grid, ENTRANCE_X, ENTRANCE_Y, TileType.FacilityEntrance);
  setTile(grid, ENTRANCE_X + 1, ENTRANCE_Y, TileType.FacilityEntrance);
  carveLandingPad(grid, ENTRANCE_X, LANDING_PAD_CY);
  return {
    scene: grid,
    scrap: [],
    items: [],
    monsters: [],
    shipExit: { x: ENTRANCE_X + 0.5, y: LANDING_PAD_CY + 0.5 },
    entrance: { x: ENTRANCE_X + 0.5, y: ENTRANCE_Y + 0.5 },
  };
}
