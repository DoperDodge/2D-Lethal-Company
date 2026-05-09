import { FACILITY_H, FACILITY_W, MOONS, MonsterKind, SCRAP_ITEMS, TileType, ITEMS } from "@quota/shared";
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
  shipExit: Vec2;
};

/**
 * Generates a connected industrial facility:
 * 1. Carve N axis-aligned rooms with random sizes.
 * 2. Connect each room to the previous via L-shaped corridors.
 * 3. Place ship exit pad in the first room.
 * 4. Distribute scrap loot, monsters, items based on moon difficulty.
 * Re-rolls (up to 5x) if connectivity check fails.
 */
export function generateFacility(moonId: string, seed: number): GeneratedFacility {
  const moon = MOONS[moonId] ?? MOONS["experimentation"]!;

  for (let attempt = 0; attempt < 5; attempt++) {
    const rng = makeRng(seed + attempt * 7919);
    const result = tryGenerate(moon, rng);
    if (result) return result;
  }

  // Final fallback: a plain rectangular room so we never fail to spawn
  return fallbackFacility();
}

function tryGenerate(
  moon: { id: string; scrapMin: number; scrapMax: number; monsterBudget: number },
  rng: () => number,
): GeneratedFacility | null {
  const w = FACILITY_W;
  const h = FACILITY_H;
  const tiles = new Uint8Array(w * h);
  // Fill with walls
  tiles.fill(TileType.Wall);
  const grid: TileGrid = { w, h, tiles };

  const numRooms = rngInt(rng, 8, 12);
  const rooms: Room[] = [];
  let placeAttempts = 0;
  while (rooms.length < numRooms && placeAttempts < 200) {
    placeAttempts++;
    const rw = rngInt(rng, 5, 10);
    const rh = rngInt(rng, 5, 10);
    const rx = rngInt(rng, 2, w - rw - 2);
    const ry = rngInt(rng, 2, h - rh - 2);
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

  // Connect rooms with L-corridors in placement order
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

  // Connectivity check via flood fill from first room center
  if (!isConnected(grid, rooms)) return null;

  // Place ship exit pad in first room
  const startRoom = rooms[0]!;
  const exit: Vec2 = { x: startRoom.cx + 0.5, y: startRoom.cy + 0.5 };
  setTile(grid, startRoom.cx, startRoom.cy, TileType.Door); // visually distinct landing pad
  // Drop a few doors at room boundaries for flavor
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i]!;
    if (rng() < 0.4) setTile(grid, r.cx, r.y, TileType.Door);
  }

  // Scrap placement (avoid the start room so loot is earned)
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

  // Monster placement: keep them away from start room
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

  return { scene: grid, scrap, items: [], monsters, shipExit: exit };
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
    setTile(g, x, y + 1, TileType.Floor); // 2-wide corridor for nicer movement
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

function isConnected(g: TileGrid, rooms: Room[]): boolean {
  if (rooms.length === 0) return true;
  const start = rooms[0]!;
  const seen = new Uint8Array(g.w * g.h);
  const q: number[] = [start.cy * g.w + start.cx];
  seen[start.cy * g.w + start.cx] = 1;
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
      if (t === TileType.Floor || t === TileType.Door) {
        seen[nIdx] = 1;
        q.push(nIdx);
      }
    }
  }
  // All room centers reachable?
  for (const r of rooms) {
    if (!seen[r.cy * g.w + r.cx]) return false;
  }
  return true;
}

function fallbackFacility(): GeneratedFacility {
  const w = FACILITY_W;
  const h = FACILITY_H;
  const tiles = new Uint8Array(w * h);
  tiles.fill(TileType.Wall);
  const grid: TileGrid = { w, h, tiles };
  const room: Room = { x: 4, y: 4, w: w - 8, h: h - 8, cx: Math.floor(w / 2), cy: Math.floor(h / 2) };
  carveRoom(grid, room);
  setTile(grid, room.cx, room.cy, TileType.Door);
  return {
    scene: grid,
    scrap: [],
    items: [],
    monsters: [],
    shipExit: { x: room.cx + 0.5, y: room.cy + 0.5 },
  };
}
