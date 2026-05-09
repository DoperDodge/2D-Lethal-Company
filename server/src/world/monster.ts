import type { Monster, PlayerState, TileGrid } from "@quota/shared";
import { Scene } from "@quota/shared";
import { isWalkable, lineOfSight, tileAt } from "./grid.js";
import { TileType } from "@quota/shared";

const SIGHT_RANGE = 8;
const CHASE_SPEED = 2.6;
const WANDER_SPEED = 1.1;

export function stepMonster(m: Monster, dt: number, grid: TileGrid, players: PlayerState[]): void {
  // Find nearest visible player in facility
  let target: PlayerState | null = null;
  let bestDist = Infinity;
  for (const p of players) {
    if (!p.alive || p.scene !== Scene.Facility) continue;
    const d = Math.hypot(p.pos.x - m.pos.x, p.pos.y - m.pos.y);
    if (d < SIGHT_RANGE && d < bestDist) {
      if (lineOfSight(grid, m.pos, p.pos)) {
        target = p;
        bestDist = d;
      }
    }
  }

  if (target) {
    m.state = "chase";
    m.targetId = target.id;
    const dx = target.pos.x - m.pos.x;
    const dy = target.pos.y - m.pos.y;
    const len = Math.max(0.0001, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const nx = m.pos.x + ux * CHASE_SPEED * dt;
    const ny = m.pos.y + uy * CHASE_SPEED * dt;
    if (isWalkable(grid, nx, m.pos.y)) m.pos.x = nx;
    if (isWalkable(grid, m.pos.x, ny)) m.pos.y = ny;
    m.facing = Math.atan2(uy, ux);
    return;
  }

  // Wander: pick a random direction periodically
  if (m.state !== "wander" || Math.random() < 0.01) {
    m.state = "wander";
    m.targetId = null;
    m.facing = Math.random() * Math.PI * 2;
  }
  const ux = Math.cos(m.facing);
  const uy = Math.sin(m.facing);
  const nx = m.pos.x + ux * WANDER_SPEED * dt;
  const ny = m.pos.y + uy * WANDER_SPEED * dt;
  let moved = false;
  if (isWalkable(grid, nx, m.pos.y)) {
    m.pos.x = nx;
    moved = true;
  }
  if (isWalkable(grid, m.pos.x, ny)) {
    m.pos.y = ny;
    moved = true;
  }
  if (!moved) m.facing = Math.random() * Math.PI * 2;

  // Don't drift onto walls if standing on one (safety)
  if (tileAt(grid, Math.floor(m.pos.x), Math.floor(m.pos.y)) === TileType.Wall) {
    m.pos.x = Math.floor(m.pos.x) + 0.5;
    m.pos.y = Math.floor(m.pos.y) + 0.5;
  }
}
