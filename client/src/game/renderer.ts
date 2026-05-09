import {
  FOG_REMEMBERED_ALPHA,
  PERIPHERAL_RANGE,
  PROXIMITY_TEXT_RADIUS,
  Scene,
  SIGHT_CONE_HALF_RAD,
  SIGHT_RANGE_AMBIENT,
  SIGHT_RANGE_FLASHLIGHT,
  TILE_SIZE,
  TileType,
  ITEMS,
} from "@quota/shared";
import type { GameSnapshot, TileGrid, Vec2 } from "@quota/shared";
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

  draw(state: ClientGameState, mouse: { x: number; y: number }): void {
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
    const camX = state.predictedPos?.x ?? me?.pos.x ?? grid.w / 2;
    const camY = state.predictedPos?.y ?? me?.pos.y ?? grid.h / 2;

    // Update facing toward mouse for FOV (snappy local feedback)
    let facing = me?.facing ?? 0;
    if (me) {
      const sx = w / 2;
      const sy = h / 2;
      facing = Math.atan2(mouse.y * this.dpi - sy, mouse.x * this.dpi - sx);
    }

    // FOV ranges
    const onShip = me?.scene === Scene.Ship;
    const fwdR = me?.flashlightOn || onShip ? SIGHT_RANGE_FLASHLIGHT : SIGHT_RANGE_AMBIENT;
    if (this.vis) {
      computeFov(grid, this.vis, camX, camY, facing, SIGHT_CONE_HALF_RAD, fwdR, PERIPHERAL_RANGE);
    }

    // Camera transform: world -> screen, centered on player, scaled by TILE_SIZE * dpi
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
        ctx.fillStyle = tileColor(t);
        ctx.fillRect(sx, sy, tilePx + 1, tilePx + 1);
        // Wall edge highlights
        if (t === TileType.Wall || t === TileType.ShipWall) {
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(sx, sy + tilePx - 2 * this.dpi, tilePx + 1, 2 * this.dpi);
        }
        // Door pad / landing pad highlight
        if (t === TileType.Door || t === TileType.ShipExit || t === TileType.CompanyDesk) {
          ctx.strokeStyle = "rgba(255, 209, 74, 0.5)";
          ctx.lineWidth = 2 * this.dpi;
          ctx.strokeRect(sx + 2, sy + 2, tilePx - 4, tilePx - 4);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Draw scrap & items (only if currently visible)
    const snap = state.snap;
    if (snap) {
      const drawEnt = (pos: Vec2, color: string, label: string, glyph: string) => {
        const tx = Math.floor(pos.x);
        const ty = Math.floor(pos.y);
        const visIdx = ty * grid.w + tx;
        const v = this.vis![visIdx] ?? 0;
        if (!(v & VIS_BITS.NOW)) return;
        const sx = offX + pos.x * tilePx;
        const sy = offY + pos.y * tilePx;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sx, sy, tilePx * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `${10 * this.dpi}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(glyph, sx, sy + 4 * this.dpi);
        ctx.fillStyle = "#fff";
        ctx.font = `${9 * this.dpi}px ui-monospace, monospace`;
        ctx.fillText(label, sx, sy - tilePx * 0.35);
      };
      for (const s of snap.scrap) {
        if (s.carriedBy) continue;
        const def = ITEMS[s.itemId];
        drawEnt(s.pos, "#a07b50", def?.name ?? s.itemId, "$");
      }
      for (const it of snap.items) {
        if (it.carriedBy) continue;
        const def = ITEMS[it.itemId];
        drawEnt(it.pos, "#5a8fc4", def?.name ?? it.itemId, "T");
      }

      // Monsters (only if visible)
      for (const m of snap.monsters) {
        const tx = Math.floor(m.pos.x);
        const ty = Math.floor(m.pos.y);
        if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) continue;
        const v = this.vis![ty * grid.w + tx] ?? 0;
        if (!(v & VIS_BITS.NOW)) continue;
        const sx = offX + m.pos.x * tilePx;
        const sy = offY + m.pos.y * tilePx;
        ctx.fillStyle = "#c63a3a";
        ctx.beginPath();
        ctx.arc(sx, sy, tilePx * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `${12 * this.dpi}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.fillText("!", sx, sy + 4 * this.dpi);
      }

      // Players
      for (const p of snap.players) {
        if (p.scene !== me?.scene) continue;
        const sx = offX + p.pos.x * tilePx;
        const sy = offY + p.pos.y * tilePx;
        // Body
        ctx.fillStyle = p.alive ? p.color : "#444";
        ctx.beginPath();
        ctx.arc(sx, sy, tilePx * 0.35, 0, Math.PI * 2);
        ctx.fill();
        // Facing tick
        const ux = Math.cos(p.facing);
        const uy = Math.sin(p.facing);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2 * this.dpi;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + ux * tilePx * 0.5, sy + uy * tilePx * 0.5);
        ctx.stroke();
        // Name + voice indicator
        ctx.fillStyle = state.voicePeers.has(p.id) ? "#ffd14a" : "#fff";
        ctx.font = `${10 * this.dpi}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        const tag = state.voicePeers.has(p.id) ? `🔊 ${p.name}` : p.name;
        ctx.fillText(tag, sx, sy - tilePx * 0.45);
      }

      // Local sight cone overlay (subtle)
      if (me) {
        const csx = offX + camX * tilePx;
        const csy = offY + camY * tilePx;
        ctx.fillStyle = "rgba(255, 230, 160, 0.04)";
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

    // Proximity text radius indicator (faint ring) when chat open
    if (state.snap && me) {
      const csx = offX + camX * tilePx;
      const csy = offY + camY * tilePx;
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.beginPath();
      ctx.arc(csx, csy, PROXIMITY_TEXT_RADIUS * tilePx, 0, Math.PI * 2);
      ctx.stroke();
    }

    drawSceneLabel(ctx, state.snap, me?.scene === Scene.Ship ? "SHIP" : "FACILITY", w);
  }

  // Convert canvas-space mouse to local facing angle (for sending to server)
  computeFacing(canvas: HTMLCanvasElement, mouse: { x: number; y: number }): number {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / 2;
    const sy = rect.height / 2;
    return Math.atan2(mouse.y - sy, mouse.x - sx);
  }
}

function tileColor(t: number): string {
  switch (t) {
    case TileType.Floor:
      return "#2c2a26";
    case TileType.Wall:
      return "#5a5044";
    case TileType.Door:
      return "#3a3a4a";
    case TileType.Vent:
      return "#222230";
    case TileType.ShipFloor:
      return "#3a3a48";
    case TileType.ShipWall:
      return "#1f2030";
    case TileType.ShipExit:
      return "#664a18";
    case TileType.CompanyDesk:
      return "#3a2a1a";
    default:
      return "#000";
  }
}

function drawSceneLabel(ctx: CanvasRenderingContext2D, snap: GameSnapshot | null, scene: string, w: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `12px ui-monospace, monospace`;
  ctx.textAlign = "right";
  const day = snap ? `Day ${snap.dayNumber}` : "";
  ctx.fillText(`${scene}  ${day}`, w - 10, 18);
}
