import { ITEMS, MOONS, MonsterKind, SCRAP_ITEMS, TileType } from "@quota/shared";
import type { Monster, ScrapInstance, TileGrid, Vec2 } from "@quota/shared";
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
  monsters: Monster[];
  // Interior side of the entrance — where players spawn when entering and
  // re-emerge on (so they exit cleanly back to the surface).
  entrance: Vec2;
  seed: number;
};

const W = 60;
const H = 60;

/**
 * Procgen interior bunker. Re-rolled with a fresh random seed every time the
 * crew enters so two visits never feel the same.
 *
 * Layout: a closed rectangular bunker with N random rooms connected by
 * 2-wide L-shaped corridors. The entrance is a 2-tile gap on the south wall;
 * a corridor links it to the closest room.
 */
export function generateFacility(moonId: string): GeneratedFacility {
  // Each generation gets a fresh random seed — no determinism per moon/day.
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const moon = MOONS[moonId] ?? MOONS["experimentation"]!;

  for (let attempt = 0; attempt < 6; attempt++) {
    const rng = makeRng(seed + attempt * 7919);
    const result = tryGenerate(moon, rng, seed + attempt);
    if (result) return result;
  }
  return fallbackFacility(seed);
}

function tryGenerate(
  moon: { id: string; scrapMin: number; scrapMax: number; monsterBudget: number },
  rng: () => number,
  seed: number,
): GeneratedFacility | null {
  const tiles = new Uint8Array(W * H);
  tiles.fill(TileType.Wall);
  const grid: TileGrid = { w: W, h: H, tiles };

  // South-wall entrance position (mirrors the surface's facility-entrance)
  const entranceCx = Math.floor(W / 2);
  const entranceY = H - 1;

  // Place rooms
  const numRooms = rngInt(rng, 9, 14);
  const rooms: Room[] = [];

  // Always reserve a "lobby" room near the south entrance
  const lobbyW = rngInt(rng, 6, 9);
  const lobbyH = rngInt(rng, 5, 8);
  const lobby: Room = {
    x: entranceCx - Math.floor(lobbyW / 2),
    y: H - lobbyH - 3,
    w: lobbyW,
    h: lobbyH,
    cx: 0,
    cy: 0,
  };
  lobby.cx = Math.floor(lobby.x + lobby.w / 2);
  lobby.cy = Math.floor(lobby.y + lobby.h / 2);
  if (
    lobby.x < 2 ||
    lobby.y < 2 ||
    lobby.x + lobby.w > W - 2 ||
    lobby.y + lobby.h > H - 2
  ) {
    return null;
  }
  rooms.push(lobby);
  carveRoom(grid, lobby);

  // Random additional rooms
  let attempts = 0;
  while (rooms.length < numRooms && attempts < 250) {
    attempts++;
    const rw = rngInt(rng, 5, 10);
    const rh = rngInt(rng, 5, 9);
    const rx = rngInt(rng, 2, W - rw - 2);
    const ry = rngInt(rng, 2, H - rh - 2);
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
  if (rooms.length < 5) return null;

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

  // South-wall entrance, two tiles wide
  setTile(grid, entranceCx, entranceY, TileType.FacilityEntrance);
  setTile(grid, entranceCx + 1, entranceY, TileType.FacilityEntrance);
  // Carve a short corridor from entrance to lobby
  for (let y = lobby.y + lobby.h; y < entranceY; y++) {
    setTile(grid, entranceCx, y, TileType.Floor);
    setTile(grid, entranceCx + 1, y, TileType.Floor);
  }

  // Connectivity check from entrance interior
  if (!isConnected(grid, rooms, { x: entranceCx, y: entranceY - 1 })) return null;

  // Add a few random doors at room boundaries for character
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i]!;
    if (rng() < 0.3) setTile(grid, r.cx, r.y, TileType.Door);
  }

  // Scrap placement (avoid the lobby so the start area is empty)
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

  // Monster placement — far from the lobby
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
    monsters,
    entrance: { x: entranceCx + 0.5, y: entranceY - 0.5 },
    seed,
  };
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
function fallbackFacility(seed: number): GeneratedFacility {
  const tiles = new Uint8Array(W * H);
  tiles.fill(TileType.Wall);
  const grid: TileGrid = { w: W, h: H, tiles };
  const room: Room = { x: 4, y: 4, w: W - 8, h: H - 8, cx: Math.floor(W / 2), cy: Math.floor(H / 2) };
  carveRoom(grid, room);
  const entranceCx = Math.floor(W / 2);
  const entranceY = H - 1;
  setTile(grid, entranceCx, entranceY, TileType.FacilityEntrance);
  setTile(grid, entranceCx + 1, entranceY, TileType.FacilityEntrance);
  for (let y = room.y + room.h; y < entranceY; y++) {
    setTile(grid, entranceCx, y, TileType.Floor);
    setTile(grid, entranceCx + 1, y, TileType.Floor);
  }
  return {
    scene: grid,
    scrap: [],
    monsters: [],
    entrance: { x: entranceCx + 0.5, y: entranceY - 0.5 },
    seed,
  };
}
