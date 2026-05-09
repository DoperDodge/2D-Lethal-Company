import { SHIP_H, SHIP_W, TileType } from "@quota/shared";
import type { TileGrid, Vec2 } from "@quota/shared";
import { setTile } from "./grid.js";

/**
 * Crew dropship interior. A rectangular hull with functional zones:
 *   - Aft (south): main entry / open work floor
 *   - Forward (north): cockpit terminal (ShipExit tile = launch console)
 *   - Port (west): company drop-off desk (sells stowed scrap)
 *   - Starboard (east): item charging station + tool locker
 *   - Center: bunks for the crew
 *
 * The walls are non-walkable. Functional tiles (terminal, locker, charging)
 * are also non-walkable so they read as solid props you stand next to.
 */
export function generateShip(): { grid: TileGrid; spawn: Vec2 } {
  const w = SHIP_W;
  const h = SHIP_H;
  const tiles = new Uint8Array(w * h);
  // Fill all-floor, then carve walls
  for (let i = 0; i < tiles.length; i++) tiles[i] = TileType.ShipFloor;
  const grid: TileGrid = { w, h, tiles };

  // Outer hull walls
  for (let x = 0; x < w; x++) {
    setTile(grid, x, 0, TileType.ShipWall);
    setTile(grid, x, h - 1, TileType.ShipWall);
  }
  for (let y = 0; y < h; y++) {
    setTile(grid, 0, y, TileType.ShipWall);
    setTile(grid, w - 1, y, TileType.ShipWall);
  }

  // Cockpit terminal cluster — front (north) wall, central
  const termY = 1;
  const termCx = Math.floor(w / 2);
  setTile(grid, termCx - 1, termY, TileType.ShipTerminal);
  setTile(grid, termCx, termY, TileType.ShipExit); // launch console (interactable)
  setTile(grid, termCx + 1, termY, TileType.ShipTerminal);

  // Company drop-off desk — port wall, mid (interactable)
  const deskY = Math.floor(h / 2);
  setTile(grid, 1, deskY - 1, TileType.ShipLocker);
  setTile(grid, 1, deskY, TileType.CompanyDesk);
  setTile(grid, 1, deskY + 1, TileType.ShipLocker);

  // Charging station — starboard wall, mid
  setTile(grid, w - 2, deskY - 1, TileType.ShipChargeStation);
  setTile(grid, w - 2, deskY, TileType.ShipChargeStation);
  setTile(grid, w - 2, deskY + 1, TileType.ShipChargeStation);

  // Tool lockers along the starboard wall, fore
  for (let y = 2; y <= 3; y++) setTile(grid, w - 2, y, TileType.ShipLocker);
  // Tool lockers along the port wall, fore
  for (let y = 2; y <= 3; y++) setTile(grid, 1, y, TileType.ShipLocker);

  // Center bunks — two stacked rows of two beds, leaving an aisle around them
  const bunkY1 = Math.floor(h / 2) - 2;
  const bunkY2 = Math.floor(h / 2) + 1;
  const bunkXLeft = Math.floor(w / 2) - 3;
  const bunkXRight = Math.floor(w / 2) + 2;
  setTile(grid, bunkXLeft, bunkY1, TileType.ShipBunk);
  setTile(grid, bunkXLeft + 1, bunkY1, TileType.ShipBunk);
  setTile(grid, bunkXRight - 1, bunkY1, TileType.ShipBunk);
  setTile(grid, bunkXRight, bunkY1, TileType.ShipBunk);
  setTile(grid, bunkXLeft, bunkY2, TileType.ShipBunk);
  setTile(grid, bunkXLeft + 1, bunkY2, TileType.ShipBunk);
  setTile(grid, bunkXRight - 1, bunkY2, TileType.ShipBunk);
  setTile(grid, bunkXRight, bunkY2, TileType.ShipBunk);

  // Spawn near the aft (south) center, facing the cockpit
  const spawn: Vec2 = { x: Math.floor(w / 2) + 0.5, y: h - 2.5 };
  return { grid, spawn };
}
