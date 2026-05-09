import {
  FOG_REMEMBERED_ALPHA,
  ITEMS,
  PERIPHERAL_RANGE,
  PROXIMITY_TEXT_RADIUS,
  Scene,
  SIGHT_CONE_HALF_RAD,
  SIGHT_RANGE_AMBIENT,
  SIGHT_RANGE_FLASHLIGHT,
  TILE_SIZE,
  TileType,
} from "@quota/shared";
import type { GameSnapshot, PlayerState, TileGrid } from "@quota/shared";
import { computeFov, newVisField, VIS_BITS, type VisFlags } from "./fov.js";
import { activeGrid, getMyPlayer, type ClientGameState } from "./state.js";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private vis: VisFlags | null = null;
  private visGridRef: TileGrid | null = null;
  private dpi = 1;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
  }

  resize(canvas: HTMLCanvasElement): void {
    this.dpi = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * this.dpi);
    canvas.height = Math.floor(rect.height * this.dpi);
  }

  draw(state: ClientGameState, facing: number): void {
    const { ctx } = this;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    const grid = activeGrid(state);
    if (!grid) return;
    if (this.visGridRef !== grid || !this.vis || this.vis.length !== grid.w * grid.h) {
      this.vis = newVisField(grid);
      this.visGridRef = grid;
    }
    const me = getMyPlayer(state);
    // The interpolated display snapshot drives the camera. No client prediction
    // means no fight between local integration and server reconciliation, so
    // movement is shake-free.
    const camX = me?.pos.x ?? grid.w / 2;
    const camY = me?.pos.y ?? grid.h / 2;

    const onShip = me?.scene === Scene.Ship;
    const fwdR = me?.flashlightOn || onShip ? SIGHT_RANGE_FLASHLIGHT : SIGHT_RANGE_AMBIENT;
    if (this.vis) {
      computeFov(grid, this.vis, camX, camY, facing, SIGHT_CONE_HALF_RAD, fwdR, PERIPHERAL_RANGE);
    }

    const tilePx = TILE_SIZE * this.dpi;
    const offX = w / 2 - camX * tilePx;
    const offY = h / 2 - camY * tilePx;

    // Draw tiles
    const x0 = Math.max(0, Math.floor(camX - w / 2 / tilePx) - 1);
    const y0 = Math.max(0, Math.floor(camY - h / 2 / tilePx) - 1);
    const x1 = Math.min(grid.w - 1, Math.ceil(camX + w / 2 / tilePx) + 1);
    const y1 = Math.min(grid.h - 1, Math.ceil(camY + h / 2 / tilePx) + 1);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const idx = y * grid.w + x;
        const t = grid.tiles[idx]!;
        const v = this.vis![idx]!;
        const visible = (v & VIS_BITS.NOW) !== 0;
        const remembered = (v & VIS_BITS.REMEMBERED) !== 0;
        if (!visible && !remembered) continue;
        const sx = offX + x * tilePx;
        const sy = offY + y * tilePx;
        ctx.globalAlpha = visible ? 1 : FOG_REMEMBERED_ALPHA;
        drawTile(ctx, t, sx, sy, tilePx, this.dpi);
      }
    }
    ctx.globalAlpha = 1;

    const snap = state.displaySnap;
    if (snap) {
      // Scrap & items (only if currently visible)
      for (const s of snap.scrap) {
        if (s.carriedBy) continue;
        const tx = Math.floor(s.pos.x);
        const ty = Math.floor(s.pos.y);
        if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) continue;
        if (!(this.vis![ty * grid.w + tx]! & VIS_BITS.NOW)) continue;
        const sx = offX + s.pos.x * tilePx;
        const sy = offY + s.pos.y * tilePx;
        drawScrap(ctx, sx, sy, tilePx);
        const def = ITEMS[s.itemId];
        ctx.fillStyle = "#fff";
        ctx.font = `${9 * this.dpi}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(def?.name ?? s.itemId, sx, sy - tilePx * 0.4);
      }
      for (const it of snap.items) {
        if (it.carriedBy) continue;
        const tx = Math.floor(it.pos.x);
        const ty = Math.floor(it.pos.y);
        if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) continue;
        if (!(this.vis![ty * grid.w + tx]! & VIS_BITS.NOW)) continue;
        const sx = offX + it.pos.x * tilePx;
        const sy = offY + it.pos.y * tilePx;
        drawTool(ctx, sx, sy, tilePx);
        const def = ITEMS[it.itemId];
        ctx.fillStyle = "#fff";
        ctx.font = `${9 * this.dpi}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(def?.name ?? it.itemId, sx, sy - tilePx * 0.4);
      }

      // Monsters (only if visible)
      for (const m of snap.monsters) {
        const tx = Math.floor(m.pos.x);
        const ty = Math.floor(m.pos.y);
        if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) continue;
        if (!(this.vis![ty * grid.w + tx]! & VIS_BITS.NOW)) continue;
        const sx = offX + m.pos.x * tilePx;
        const sy = offY + m.pos.y * tilePx;
        drawMonster(ctx, sx, sy, m.facing, tilePx);
      }

      // Players (own scene)
      for (const p of snap.players) {
        if (p.scene !== me?.scene) continue;
        const sx = offX + p.pos.x * tilePx;
        const sy = offY + p.pos.y * tilePx;
        drawPlayerSprite(ctx, p, sx, sy, tilePx, p.id === me.id);
        // Name + voice indicator
        ctx.fillStyle = state.voicePeers.has(p.id) ? "#ffd14a" : "#fff";
        ctx.font = `${10 * this.dpi}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        const tag = state.voicePeers.has(p.id) ? `\u{1F50A} ${p.name}` : p.name;
        ctx.fillText(tag, sx, sy - tilePx * 0.65);
      }

      // Local sight cone overlay
      if (me) {
        const csx = offX + camX * tilePx;
        const csy = offY + camY * tilePx;
        ctx.fillStyle = me.flashlightOn ? "rgba(255, 230, 160, 0.07)" : "rgba(255, 230, 160, 0.03)";
        ctx.beginPath();
        ctx.moveTo(csx, csy);
        ctx.arc(csx, csy, fwdR * tilePx, facing - SIGHT_CONE_HALF_RAD, facing + SIGHT_CONE_HALF_RAD);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Vignette
    const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.7);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.7)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Faint proximity-text ring
    if (state.displaySnap && me) {
      const csx = offX + camX * tilePx;
      const csy = offY + camY * tilePx;
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.beginPath();
      ctx.arc(csx, csy, PROXIMITY_TEXT_RADIUS * tilePx, 0, Math.PI * 2);
      ctx.stroke();
    }

    drawSceneLabel(ctx, snap, me?.scene === Scene.Ship ? "SHIP" : "FACILITY", w);
  }

  computeFacing(canvas: HTMLCanvasElement, mouse: { x: number; y: number }): number {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / 2;
    const sy = rect.height / 2;
    return Math.atan2(mouse.y - sy, mouse.x - sx);
  }
}

// ──────────── Tile drawing ────────────

function drawTile(ctx: CanvasRenderingContext2D, t: number, sx: number, sy: number, px: number, dpi: number): void {
  switch (t) {
    case TileType.Floor:
      ctx.fillStyle = "#2c2a26";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      // Subtle grout
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(sx, sy + px - 1 * dpi, px + 1, 1 * dpi);
      return;
    case TileType.Wall:
      ctx.fillStyle = "#5a5044";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(sx, sy + px - 2 * dpi, px + 1, 2 * dpi);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(sx, sy, px + 1, 1 * dpi);
      return;
    case TileType.Door:
      ctx.fillStyle = "#3a3a4a";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.strokeStyle = "rgba(255, 209, 74, 0.5)";
      ctx.lineWidth = 2 * dpi;
      ctx.strokeRect(sx + 2, sy + 2, px - 4, px - 4);
      return;
    case TileType.Vent:
      ctx.fillStyle = "#222230";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = dpi;
      for (let i = 1; i < 5; i++) {
        const yy = sy + (px / 5) * i;
        ctx.beginPath();
        ctx.moveTo(sx + 2, yy);
        ctx.lineTo(sx + px - 2, yy);
        ctx.stroke();
      }
      return;
    case TileType.ShipFloor:
      ctx.fillStyle = "#3a3a48";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      // Metal panel grid
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = dpi;
      ctx.strokeRect(sx + 0.5 * dpi, sy + 0.5 * dpi, px - dpi, px - dpi);
      return;
    case TileType.ShipWall:
      ctx.fillStyle = "#1f2030";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(sx, sy, px + 1, 2 * dpi);
      return;
    case TileType.ShipExit: {
      // Cockpit launch console — yellow+amber lit panel
      ctx.fillStyle = "#3a3a48";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.fillStyle = "#ffd14a";
      ctx.fillRect(sx + 4 * dpi, sy + 4 * dpi, px - 8 * dpi, px - 8 * dpi);
      ctx.fillStyle = "#5a3a08";
      ctx.fillRect(sx + 6 * dpi, sy + 6 * dpi, px - 12 * dpi, 2 * dpi);
      ctx.fillRect(sx + 6 * dpi, sy + 10 * dpi, px - 12 * dpi, 2 * dpi);
      return;
    }
    case TileType.CompanyDesk:
      ctx.fillStyle = "#3a2a1a";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.fillStyle = "#7a5b30";
      ctx.fillRect(sx + 2 * dpi, sy + 2 * dpi, px - 4 * dpi, px - 4 * dpi);
      ctx.fillStyle = "#1a1208";
      ctx.fillRect(sx + 4 * dpi, sy + 4 * dpi, px - 8 * dpi, 4 * dpi);
      return;
    case TileType.Exterior:
      ctx.fillStyle = "#2d2520";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      // Speckle dust
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(sx + 3 * dpi, sy + 5 * dpi, dpi, dpi);
      ctx.fillRect(sx + 9 * dpi, sy + 12 * dpi, dpi, dpi);
      ctx.fillRect(sx + 14 * dpi, sy + 6 * dpi, dpi, dpi);
      return;
    case TileType.ExteriorRock:
      ctx.fillStyle = "#1a1612";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.fillStyle = "#3d3328";
      ctx.beginPath();
      ctx.arc(sx + px / 2, sy + px / 2, px * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.arc(sx + px / 2 + 2 * dpi, sy + px / 2 + 2 * dpi, px * 0.18, 0, Math.PI * 2);
      ctx.fill();
      return;
    case TileType.LandingPad:
      // Concrete landing pad with painted hazard stripes
      ctx.fillStyle = "#1c1c20";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.fillStyle = "#3a342a";
      ctx.fillRect(sx + 1 * dpi, sy + 1 * dpi, px - 2 * dpi, px - 2 * dpi);
      // Diagonal yellow hazard stripe
      ctx.fillStyle = "#ffd14a";
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, sy, px, px);
      ctx.clip();
      ctx.translate(sx + px / 2, sy + px / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-px, -2 * dpi, 2 * px, 4 * dpi);
      ctx.restore();
      return;
    case TileType.FacilityEntrance:
      // Heavy steel door
      ctx.fillStyle = "#2a2a36";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.fillStyle = "#665520";
      ctx.fillRect(sx + 2 * dpi, sy + 2 * dpi, px - 4 * dpi, px - 4 * dpi);
      ctx.strokeStyle = "rgba(255, 209, 74, 0.85)";
      ctx.lineWidth = 2 * dpi;
      ctx.strokeRect(sx + 3 * dpi, sy + 3 * dpi, px - 6 * dpi, px - 6 * dpi);
      // Caution chevrons
      ctx.fillStyle = "#1a1a22";
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(sx + 5 * dpi + i * 5 * dpi, sy + 8 * dpi, 3 * dpi, 8 * dpi);
      }
      return;
    case TileType.ShipTerminal:
      // Big console — dark panel with green CRT screen
      ctx.fillStyle = "#1a1c28";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.fillStyle = "#0a4a2a";
      ctx.fillRect(sx + 3 * dpi, sy + 3 * dpi, px - 6 * dpi, px - 12 * dpi);
      ctx.fillStyle = "#5fc97d";
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(sx + 5 * dpi, sy + 5 * dpi + i * 3 * dpi, px - 10 * dpi, dpi);
      }
      return;
    case TileType.ShipChargeStation:
      ctx.fillStyle = "#1a1c28";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.fillStyle = "#56b9e0";
      ctx.fillRect(sx + 4 * dpi, sy + 4 * dpi, px - 8 * dpi, 4 * dpi);
      ctx.fillStyle = "#0a3a4a";
      ctx.fillRect(sx + 4 * dpi, sy + 12 * dpi, px - 8 * dpi, 8 * dpi);
      // Lightning bolt indicator
      ctx.fillStyle = "#ffd14a";
      ctx.beginPath();
      ctx.moveTo(sx + px / 2 - 2 * dpi, sy + 14 * dpi);
      ctx.lineTo(sx + px / 2 + 2 * dpi, sy + 16 * dpi);
      ctx.lineTo(sx + px / 2, sy + 17 * dpi);
      ctx.lineTo(sx + px / 2 + 3 * dpi, sy + 20 * dpi);
      ctx.lineTo(sx + px / 2 - 1 * dpi, sy + 18 * dpi);
      ctx.lineTo(sx + px / 2 + 1 * dpi, sy + 17 * dpi);
      ctx.closePath();
      ctx.fill();
      return;
    case TileType.ShipBunk:
      ctx.fillStyle = "#2a2a3a";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.fillStyle = "#6a4030";
      ctx.fillRect(sx + 1 * dpi, sy + 1 * dpi, px - 2 * dpi, px - 2 * dpi);
      ctx.fillStyle = "#8a6048";
      ctx.fillRect(sx + 3 * dpi, sy + 3 * dpi, px - 6 * dpi, 6 * dpi);
      return;
    case TileType.ShipLocker:
      ctx.fillStyle = "#1a1a22";
      ctx.fillRect(sx, sy, px + 1, px + 1);
      ctx.fillStyle = "#3a3a48";
      ctx.fillRect(sx + 2 * dpi, sy + 2 * dpi, px - 4 * dpi, px - 4 * dpi);
      ctx.fillStyle = "#1a1a22";
      ctx.fillRect(sx + px / 2 - 0.5 * dpi, sy + 2 * dpi, dpi, px - 4 * dpi);
      ctx.fillStyle = "#ffd14a";
      ctx.fillRect(sx + px / 2 - 2 * dpi, sy + px / 2 - dpi, 2 * dpi, 2 * dpi);
      ctx.fillRect(sx + px / 2 + 1 * dpi, sy + px / 2 - dpi, 2 * dpi, 2 * dpi);
      return;
    default:
      ctx.fillStyle = "#000";
      ctx.fillRect(sx, sy, px + 1, px + 1);
  }
}

// ──────────── Entity drawing ────────────

/**
 * Top-down contractor sprite. The body is a small circle (suit), with a backpack
 * trailing behind, a helmet on top, and a visor pointed in the facing direction.
 * Drawn entirely from primitives so we don't need image assets.
 */
function drawPlayerSprite(
  ctx: CanvasRenderingContext2D,
  p: PlayerState,
  sx: number,
  sy: number,
  px: number,
  isMe: boolean,
): void {
  const r = px * 0.32;
  const ux = Math.cos(p.facing);
  const uy = Math.sin(p.facing);
  // Drop shadow
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.6, r * 0.85, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  // Backpack — square block trailing behind the player
  const backX = sx - ux * r * 0.65;
  const backY = sy - uy * r * 0.65;
  ctx.save();
  ctx.translate(backX, backY);
  ctx.rotate(p.facing);
  ctx.fillStyle = "#2a2a32";
  ctx.fillRect(-r * 0.55, -r * 0.55, r * 0.7, r * 1.1);
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.strokeRect(-r * 0.55, -r * 0.55, r * 0.7, r * 1.1);
  // Backpack tank
  ctx.fillStyle = "#444450";
  ctx.fillRect(-r * 0.4, -r * 0.4, r * 0.4, r * 0.8);
  ctx.restore();

  // Suit body — colored circle reflecting player's chosen color
  if (!p.alive) ctx.fillStyle = "#3a3a3a";
  else ctx.fillStyle = darken(p.color, 0.55);
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  // Chest plate detail
  ctx.fillStyle = darken(p.color, 0.4);
  ctx.beginPath();
  ctx.arc(sx, sy, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
  // Suit "color band" matching player color
  ctx.strokeStyle = p.alive ? p.color : "#555";
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  ctx.arc(sx, sy, r * 0.85, 0, Math.PI * 2);
  ctx.stroke();

  // Helmet — slightly smaller circle on top
  ctx.fillStyle = "#dbe2ea";
  ctx.beginPath();
  ctx.arc(sx, sy, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#90969e";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Visor — dark crescent on the forward side
  const visorAng = p.facing;
  ctx.fillStyle = p.flashlightOn ? "#ffd14a" : "#0a1a2a";
  ctx.beginPath();
  ctx.arc(sx, sy, r * 0.55, visorAng - 0.85, visorAng + 0.85);
  ctx.lineTo(sx + Math.cos(visorAng) * r * 0.2, sy + Math.sin(visorAng) * r * 0.2);
  ctx.closePath();
  ctx.fill();
  // Visor highlight
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.arc(
    sx + Math.cos(visorAng + 0.3) * r * 0.4,
    sy + Math.sin(visorAng + 0.3) * r * 0.4,
    r * 0.08,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Selection ring around the local player
  if (isMe) {
    ctx.strokeStyle = "rgba(255, 209, 74, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawScrap(ctx: CanvasRenderingContext2D, sx: number, sy: number, px: number): void {
  const r = px * 0.22;
  // Glint shadow
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.4, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Body
  ctx.fillStyle = "#a07b50";
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#5a3a18";
  ctx.lineWidth = 1;
  ctx.stroke();
  // $ label
  ctx.fillStyle = "#fff8c0";
  ctx.font = `bold ${Math.max(9, r * 1.3)}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.fillText("$", sx, sy + r * 0.45);
}

function drawTool(ctx: CanvasRenderingContext2D, sx: number, sy: number, px: number): void {
  const r = px * 0.22;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.4, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5a8fc4";
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.max(9, r * 1.3)}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.fillText("T", sx, sy + r * 0.45);
}

function drawMonster(ctx: CanvasRenderingContext2D, sx: number, sy: number, facing: number, px: number): void {
  const r = px * 0.42;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.5, r, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Body
  ctx.fillStyle = "#5a1a1a";
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  // Eyes — two glowing red dots in facing direction
  const ex = sx + Math.cos(facing) * r * 0.55;
  const ey = sy + Math.sin(facing) * r * 0.55;
  const px1 = -Math.sin(facing) * r * 0.25;
  const py1 = Math.cos(facing) * r * 0.25;
  ctx.fillStyle = "#ff3030";
  ctx.beginPath();
  ctx.arc(ex + px1, ey + py1, r * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex - px1, ey - py1, r * 0.13, 0, Math.PI * 2);
  ctx.fill();
  // Spike outline
  ctx.strokeStyle = "#3a0a0a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.stroke();
}

// Color helper: darken hex color
function darken(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = Math.floor(parseInt(m[1]!, 16) * factor);
  const g = Math.floor(parseInt(m[2]!, 16) * factor);
  const b = Math.floor(parseInt(m[3]!, 16) * factor);
  return `rgb(${r},${g},${b})`;
}

function drawSceneLabel(
  ctx: CanvasRenderingContext2D,
  snap: GameSnapshot | null,
  scene: string,
  w: number,
): void {
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `12px ui-monospace, monospace`;
  ctx.textAlign = "right";
  const day = snap ? `Day ${snap.dayNumber}` : "";
  ctx.fillText(`${scene}  ${day}`, w - 10, 18);
}

