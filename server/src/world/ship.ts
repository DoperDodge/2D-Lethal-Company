import { SHIP_H, SHIP_W, TileType } from "@quota/shared";
import type { TileGrid, Vec2 } from "@quota/shared";
import { setTile } from "./grid.js";

export type ShipScene = {
  grid: TileGrid;
  // Where players spawn the very first time they enter the ship.
  innerSpawn: Vec2;
  // The door tile inside the ship — walking on it exits to the moon's surface.
  innerDoor: Vec2;
  // The console tile — press E to open the buy/launch terminal.
  console: Vec2;
};

/**
 * Crew dropship interior. Static layout shared across every moon — the ship
 * itself follows the crew. Functional zones:
 *   - Forward (north): cockpit terminal cluster (interior decor)
 *   - Forward-center: ship console (interactable launch/buy terminal)
 *   - Port (west): tool lockers
 *   - Starboard (east): equipment charging station
 *   - Center: bunks (decorative, blocks movement)
 *   - Aft (south, center): ship door (transition to surface)
 */
export function generateShip(): ShipScene {
  const w = SHIP_W;
  const h = SHIP_H;
  const tiles = new Uint8Array(w * h);
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

  // Cockpit terminal cluster — front (north) wall, central (decorative)
  const termY = 1;
  const termCx = Math.floor(w / 2);
  setTile(grid, termCx - 2, termY, TileType.ShipTerminal);
  setTile(grid, termCx - 1, termY, TileType.ShipTerminal);
  setTile(grid, termCx, termY, TileType.ShipTerminal);
  setTile(grid, termCx + 1, termY, TileType.ShipTerminal);
  setTile(grid, termCx + 2, termY, TileType.ShipTerminal);

  // Ship console — interactable, just south of the cockpit cluster
  const consoleY = termY + 2;
  setTile(grid, termCx, consoleY, TileType.ShipConsole);

  // Charging station — starboard wall
  for (let y = 3; y <= 5; y++) setTile(grid, w - 2, y, TileType.ShipChargeStation);

  // Tool lockers — port wall (forward bank)
  for (let y = 3; y <= 6; y++) setTile(grid, 1, y, TileType.ShipLocker);

  // Center bunks — two stacked rows of two beds
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

  // Ship door — aft (south) center, two tiles wide. Walk on it to exit to the
  // current moon's surface.
  const doorY = h - 1;
  const doorCx = Math.floor(w / 2);
  setTile(grid, doorCx, doorY, TileType.ShipDoor);
  setTile(grid, doorCx + 1, doorY, TileType.ShipDoor);

  // Inner spawn: just inside the door so players appear stepping into the ship.
  const innerSpawn: Vec2 = { x: doorCx + 0.5, y: h - 2.5 };
  const innerDoor: Vec2 = { x: doorCx + 0.5, y: h - 1.5 };
  const consolePos: Vec2 = { x: termCx + 0.5, y: consoleY + 0.5 };
  return { grid, innerSpawn, innerDoor, console: consolePos };
}
