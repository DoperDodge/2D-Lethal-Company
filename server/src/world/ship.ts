import { SHIP_H, SHIP_W, TileType } from "@quota/shared";
import type { TileGrid, Vec2 } from "@quota/shared";

export function generateShip(): { grid: TileGrid; spawn: Vec2 } {
  const w = SHIP_W;
  const h = SHIP_H;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const onEdge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      tiles[y * w + x] = onEdge ? TileType.ShipWall : TileType.ShipFloor;
    }
  }
  // Place ship console (exit/landing trigger) on right wall opening
  const exitX = w - 2;
  const exitY = Math.floor(h / 2);
  tiles[exitY * w + exitX] = TileType.ShipExit;

  // Place company desk (sell scrap) on left wall opening
  const deskX = 1;
  const deskY = Math.floor(h / 2);
  tiles[deskY * w + deskX] = TileType.CompanyDesk;

  return { grid: { w, h, tiles }, spawn: { x: w / 2, y: h / 2 } };
}
