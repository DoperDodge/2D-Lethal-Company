import { TileType } from "@quota/shared";
import type { TileGrid, Vec2 } from "@quota/shared";
import { setTile } from "./grid.js";

export type CompanyScene = {
  grid: TileGrid;
  // Where players spawn when entering from the surface.
  innerSpawn: Vec2;
  // Door tile inside the building — walking on it returns to Atrium surface.
  innerDoor: Vec2;
  // Where the sell desk is (player walks up + presses E to sell).
  sellDesk: Vec2;
};

const W = 22;
const H = 16;

/**
 * Company sell building interior. A small lobby with a counter at the back
 * and a south-facing door to return to the plaza outside.
 */
export function generateCompanyInterior(): CompanyScene {
  const tiles = new Uint8Array(W * H);
  for (let i = 0; i < tiles.length; i++) tiles[i] = TileType.Floor;
  const grid: TileGrid = { w: W, h: H, tiles };

  // Outer walls
  for (let x = 0; x < W; x++) {
    setTile(grid, x, 0, TileType.Wall);
    setTile(grid, x, H - 1, TileType.Wall);
  }
  for (let y = 0; y < H; y++) {
    setTile(grid, 0, y, TileType.Wall);
    setTile(grid, W - 1, y, TileType.Wall);
  }

  // Counter spans most of the back wall (north end), with a sell desk in the middle
  const counterY = 3;
  for (let x = 4; x <= W - 5; x++) setTile(grid, x, counterY, TileType.Wall);
  const deskCx = Math.floor(W / 2);
  setTile(grid, deskCx, counterY, TileType.CompanyDesk);

  // South-facing door to exit
  const doorCx = Math.floor(W / 2);
  setTile(grid, doorCx, H - 1, TileType.CompanyDoor);
  setTile(grid, doorCx + 1, H - 1, TileType.CompanyDoor);

  return {
    grid,
    innerSpawn: { x: doorCx + 0.5, y: H - 2.5 },
    innerDoor: { x: doorCx + 0.5, y: H - 1.5 },
    sellDesk: { x: deskCx + 0.5, y: counterY + 0.5 },
  };
}
