import { TileType } from "@quota/shared";
import type { TileGrid, Vec2 } from "@quota/shared";

export function tileAt(g: TileGrid, x: number, y: number): TileType {
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return TileType.Wall;
  return g.tiles[y * g.w + x] as TileType;
}

export function setTile(g: TileGrid, x: number, y: number, t: TileType): void {
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return;
  g.tiles[y * g.w + x] = t;
}

export function isBlocking(t: TileType): boolean {
  return t === TileType.Wall || t === TileType.ShipWall || t === TileType.Empty;
}

export function isWalkable(g: TileGrid, fx: number, fy: number): boolean {
  // Treat float coords as a small AABB and check 4 corners
  const r = 0.3;
  const corners: Vec2[] = [
    { x: fx - r, y: fy - r },
    { x: fx + r, y: fy - r },
    { x: fx - r, y: fy + r },
    { x: fx + r, y: fy + r },
  ];
  for (const c of corners) {
    const t = tileAt(g, Math.floor(c.x), Math.floor(c.y));
    if (isBlocking(t)) return false;
  }
  return true;
}

// Bresenham-style LOS check between two world (float) positions.
export function lineOfSight(g: TileGrid, a: Vec2, b: Vec2): boolean {
  let x0 = Math.floor(a.x);
  let y0 = Math.floor(a.y);
  const x1 = Math.floor(b.x);
  const y1 = Math.floor(b.y);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (let i = 0; i < 256; i++) {
    if (x0 === x1 && y0 === y1) return true;
    if (!(x0 === Math.floor(a.x) && y0 === Math.floor(a.y))) {
      if (isBlocking(tileAt(g, x0, y0))) return false;
    }
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return false;
}
