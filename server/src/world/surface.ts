import { TileType } from "@quota/shared";
import type { TileGrid, Vec2 } from "@quota/shared";
import { setTile } from "./grid.js";

export type SurfaceScene = {
  moonId: string;
  grid: TileGrid;
  // Position the player spawns at when arriving on this surface (just outside
  // the ship's door).
  arrivalSpawn: Vec2;
  // Tile that re-enters the ship when stepped on.
  shipDoor: Vec2;
  // Optional facility entrance for industrial moons.
  facilityEntrance?: Vec2;
  // Optional company building door for sell moons.
  companyDoor?: Vec2;
};

const SURFACE_W = 56;
const SURFACE_H = 56;

/**
 * Outdoor area on a salvage-class moon: dusty rocky plain with a parked ship,
 * scattered exterior rocks, and a fortified facility entrance to the north.
 * Walking through the entrance takes the crew into the procgen interior.
 */
export function generateExperimentationSurface(): SurfaceScene {
  const w = SURFACE_W;
  const h = SURFACE_H;
  const tiles = new Uint8Array(w * h);
  tiles.fill(TileType.Exterior);
  const grid: TileGrid = { w, h, tiles };

  // Map border (rocks)
  for (let x = 0; x < w; x++) {
    setTile(grid, x, 0, TileType.ExteriorRock);
    setTile(grid, x, h - 1, TileType.ExteriorRock);
  }
  for (let y = 0; y < h; y++) {
    setTile(grid, 0, y, TileType.ExteriorRock);
    setTile(grid, w - 1, y, TileType.ExteriorRock);
  }

  // Ship is parked in the southern half of the surface.
  const shipCx = Math.floor(w / 2);
  const shipCy = Math.floor(h * 0.7);
  carveShipBuilding(grid, shipCx, shipCy);

  // Facility entrance is to the north.
  const entranceCx = Math.floor(w / 2);
  const entranceCy = 8;
  carveBunkerFacade(grid, entranceCx, entranceCy);

  // Clear a path between facility entrance and the ship's hazard pad.
  // Stop short of the pad so the door tile isn't overwritten.
  for (let y = entranceCy + 3; y <= shipCy - 3; y++) {
    setTile(grid, shipCx, y, TileType.Exterior);
    setTile(grid, shipCx + 1, y, TileType.Exterior);
    setTile(grid, shipCx - 1, y, TileType.Exterior);
    setTile(grid, shipCx + 2, y, TileType.Exterior);
  }

  // Scatter rocks for visual interest, away from the path.
  let placed = 0;
  let attempts = 0;
  const target = Math.floor(w * h * 0.05);
  while (placed < target && attempts < target * 10) {
    attempts++;
    const x = 2 + Math.floor(Math.random() * (w - 4));
    const y = 2 + Math.floor(Math.random() * (h - 4));
    // Keep ship + facility + path clear
    if (Math.abs(x - shipCx) <= 4 && Math.abs(y - shipCy) <= 4) continue;
    if (Math.abs(x - entranceCx) <= 4 && Math.abs(y - entranceCy) <= 4) continue;
    if (Math.abs(x - shipCx) <= 2 && y > entranceCy + 2 && y < shipCy - 2) continue;
    const idx = y * w + x;
    if (tiles[idx] !== TileType.Exterior) continue;
    tiles[idx] = TileType.ExteriorRock;
    placed++;
  }

  return {
    moonId: "experimentation",
    grid,
    arrivalSpawn: { x: shipCx + 0.5, y: shipCy + 1.5 },
    shipDoor: { x: shipCx + 0.5, y: shipCy + 0.5 },
    facilityEntrance: { x: entranceCx + 0.5, y: entranceCy + 1.5 },
  };
}

/**
 * Sell-moon plaza with the company building and the parked ship. No facility,
 * no monsters, no scrap — just a place to dump your haul at the company desk.
 */
export function generateAtriumSurface(): SurfaceScene {
  const w = SURFACE_W;
  const h = SURFACE_H;
  const tiles = new Uint8Array(w * h);
  // Atrium is a paved plaza, not a dusty moon
  tiles.fill(TileType.CompanyPlaza);
  const grid: TileGrid = { w, h, tiles };

  // Border rocks
  for (let x = 0; x < w; x++) {
    setTile(grid, x, 0, TileType.ExteriorRock);
    setTile(grid, x, h - 1, TileType.ExteriorRock);
  }
  for (let y = 0; y < h; y++) {
    setTile(grid, 0, y, TileType.ExteriorRock);
    setTile(grid, w - 1, y, TileType.ExteriorRock);
  }

  // Ship parked in the southern half
  const shipCx = Math.floor(w / 2);
  const shipCy = Math.floor(h * 0.72);
  carveShipBuilding(grid, shipCx, shipCy);

  // Company building to the north
  const compCx = Math.floor(w / 2);
  const compCy = 8;
  carveCompanyFacade(grid, compCx, compCy);

  return {
    moonId: "atrium",
    grid,
    arrivalSpawn: { x: shipCx + 0.5, y: shipCy + 1.5 },
    shipDoor: { x: shipCx + 0.5, y: shipCy + 0.5 },
    companyDoor: { x: compCx + 0.5, y: compCy + 1.5 },
  };
}

// ──────────────── Helpers ────────────────

/**
 * The ship's "surface representation": a hazard-striped landing pad with a
 * door tile in the middle. The actual ship interior is its own scene — this
 * is just the spot you stand on to embark.
 *
 * Keeping the surface ship walkable (no impassable hull) lets the crew route
 * around it freely between the door and the facility entrance.
 */
function carveShipBuilding(g: TileGrid, cx: number, cy: number): void {
  // 5x5 hazard pad
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setTile(g, cx + dx, cy + dy, TileType.LandingPad);
    }
  }
  // Ship door tile in the centre — press E to embark.
  setTile(g, cx, cy, TileType.ShipDoor);
  setTile(g, cx + 1, cy, TileType.ShipDoor);
}

function carveBunkerFacade(g: TileGrid, cx: number, cy: number): void {
  // 9-wide bunker face + entrance arch
  for (let dx = -4; dx <= 4; dx++) {
    setTile(g, cx + dx, cy, TileType.Wall);
    setTile(g, cx + dx, cy + 1, TileType.Wall);
  }
  // Carve entrance opening (2 tiles wide)
  setTile(g, cx, cy + 1, TileType.FacilityEntrance);
  setTile(g, cx + 1, cy + 1, TileType.FacilityEntrance);
  // Caution chevrons in front (decorative — they're walkable LandingPad tiles)
  for (let dx = -2; dx <= 2; dx++) {
    setTile(g, cx + dx, cy + 2, TileType.LandingPad);
  }
}

function carveCompanyFacade(g: TileGrid, cx: number, cy: number): void {
  // Wider, more elegant facade for the trading post
  for (let dx = -5; dx <= 5; dx++) {
    setTile(g, cx + dx, cy, TileType.Wall);
    setTile(g, cx + dx, cy + 1, TileType.Wall);
  }
  // Company door
  setTile(g, cx, cy + 1, TileType.CompanyDoor);
  setTile(g, cx + 1, cy + 1, TileType.CompanyDoor);
  // Decorative plaza approach
  for (let dx = -3; dx <= 3; dx++) {
    setTile(g, cx + dx, cy + 2, TileType.LandingPad);
  }
}
