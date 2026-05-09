import { TileType, type TileGrid } from "@quota/shared";

export type VisFlags = Uint8Array; // per-tile bitfield: bit 0 = currently visible, bit 1 = remembered

const VIS_NOW = 1;
const VIS_REMEMBERED = 2;

export function newVisField(g: TileGrid): VisFlags {
  return new Uint8Array(g.w * g.h);
}

export function isOpaque(t: number): boolean {
  return t === TileType.Wall || t === TileType.ShipWall || t === TileType.Empty;
}

/**
 * Compute visible tiles via shadowcasting masked by a forward sight cone.
 * Mutates `out` in place (sets bits).
 */
export function computeFov(
  g: TileGrid,
  out: VisFlags,
  px: number,
  py: number,
  facing: number,
  coneHalfRad: number,
  forwardRange: number,
  peripheralRange: number,
): void {
  // Demote prior "currently visible" -> remembered, then re-stamp this frame.
  for (let i = 0; i < out.length; i++) {
    if (out[i]! & VIS_NOW) {
      out[i] = ((out[i]! & ~VIS_NOW) | VIS_REMEMBERED) as number & 0xff;
    }
  }

  const cx = Math.floor(px);
  const cy = Math.floor(py);
  out[cy * g.w + cx] = (out[cy * g.w + cx]! | VIS_NOW | VIS_REMEMBERED) as number & 0xff;

  const maxR = Math.max(forwardRange, peripheralRange);
  // Cast 8 octants of shadow rays. Mask each visible tile by sight cone.
  for (let octant = 0; octant < 8; octant++) {
    castOctant(g, out, cx, cy, 1, 1.0, 0.0, octant, maxR, px, py, facing, coneHalfRad, forwardRange, peripheralRange);
  }
}

const TRANSFORMS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, -1, 1, 0],
  [-1, 0, 0, 1],
  [-1, 0, 0, -1],
  [0, -1, -1, 0],
  [0, 1, -1, 0],
  [1, 0, 0, -1],
];

function castOctant(
  g: TileGrid,
  out: VisFlags,
  cx: number,
  cy: number,
  row: number,
  startSlope: number,
  endSlope: number,
  octant: number,
  maxR: number,
  px: number,
  py: number,
  facing: number,
  coneHalf: number,
  fwdR: number,
  periR: number,
): void {
  if (startSlope < endSlope) return;
  const xx = TRANSFORMS[octant]![0];
  const xy = TRANSFORMS[octant]![1];
  const yx = TRANSFORMS[octant]![2];
  const yy = TRANSFORMS[octant]![3];

  let nextStart = startSlope;
  for (let r = row; r <= maxR; r++) {
    let blocked = false;
    let newStart = nextStart;
    for (let dx = -r; dx <= 0; dx++) {
      const dy = -r;
      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);
      if (rSlope > startSlope) continue;
      if (lSlope < endSlope) break;
      const X = cx + dx * xx + dy * xy;
      const Y = cy + dx * yx + dy * yy;
      const idx = Y * g.w + X;
      if (X < 0 || Y < 0 || X >= g.w || Y >= g.h) continue;

      const distSq = (X + 0.5 - px) * (X + 0.5 - px) + (Y + 0.5 - py) * (Y + 0.5 - py);
      const dist = Math.sqrt(distSq);
      if (dist <= maxR) {
        // Check sight cone & range
        if (inSightCone(px, py, X, Y, facing, coneHalf, fwdR, periR, dist)) {
          out[idx] = (out[idx]! | VIS_NOW | VIS_REMEMBERED) as number & 0xff;
        }
      }

      const tile = g.tiles[idx]!;
      if (blocked) {
        if (isOpaque(tile)) {
          newStart = rSlope;
          continue;
        } else {
          blocked = false;
          startSlope = newStart;
        }
      } else {
        if (isOpaque(tile) && r < maxR) {
          blocked = true;
          castOctant(g, out, cx, cy, r + 1, startSlope, lSlope, octant, maxR, px, py, facing, coneHalf, fwdR, periR);
          newStart = rSlope;
        }
      }
    }
    if (blocked) break;
    nextStart = newStart;
  }
}

function inSightCone(
  px: number,
  py: number,
  tx: number,
  ty: number,
  facing: number,
  coneHalf: number,
  fwdR: number,
  periR: number,
  dist: number,
): boolean {
  if (dist <= 1.4) return true;
  const dx = tx + 0.5 - px;
  const dy = ty + 0.5 - py;
  const angTo = Math.atan2(dy, dx);
  let diff = angTo - facing;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const inCone = Math.abs(diff) <= coneHalf;
  if (inCone) return dist <= fwdR;
  return dist <= periR;
}

export const VIS_BITS = { NOW: VIS_NOW, REMEMBERED: VIS_REMEMBERED };
