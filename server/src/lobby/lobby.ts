import {
  DAYS_PER_QUOTA_CYCLE,
  DAY_LENGTH_SECONDS,
  DEFAULT_MOON_ID,
  DOOR_CLOSE_WARNING_SEC,
  LANDING_CUTSCENE_MS,
  PLAYER_INVENTORY_SLOTS,
  PLAYER_MAX_HEALTH,
  PLAYER_SPEED,
  PROXIMITY_TEXT_RADIUS,
  QUOTA_INCREMENT,
  Scene,
  STARTING_CREDITS,
  STARTING_QUOTA,
  TICK_MS,
  TileType,
  ITEMS,
  MOONS,
} from "@quota/shared";
import type {
  ClientMsg,
  GameSnapshot,
  ItemId,
  ItemInstance,
  LobbyCode,
  LobbyPhase,
  Monster,
  PlayerId,
  PlayerState,
  ScrapInstance,
  ServerMsg,
  TileGrid,
  Vec2,
} from "@quota/shared";
import type { ClientCtx } from "../net/connection.js";
import { generateShip } from "../world/ship.js";
import { generateFacility } from "../procgen/facility.js";
import { stepMonster } from "../world/monster.js";
import { tileAt, isWalkable, lineOfSight } from "../world/grid.js";

type LobbyPlayer = {
  ctx: ClientCtx;
  state: PlayerState;
  ready: boolean;
  lastInputSeq: number;
  pendingInput: {
    seq: number;
    mv: Vec2;
    facing: number;
    flashlight: boolean;
    interact: boolean;
    drop: boolean;
    selectedSlot: number;
  } | null;
  voiceActive: boolean;
};

let nextEntityId = 1;
const newEntityId = () => nextEntityId++;

export class Lobby {
  readonly code: LobbyCode;
  private maxPlayers: number;
  private players = new Map<PlayerId, LobbyPlayer>();
  private phase: LobbyPhase = "lobby";
  private tick_n = 0;

  // World scenes
  private ship: TileGrid;
  private shipSpawn: Vec2;
  private facility: ReturnType<typeof generateFacility> | null = null;
  private moonId: string = DEFAULT_MOON_ID;

  // Day/quota
  private dayNumber = 1;
  private daysRemaining = DAYS_PER_QUOTA_CYCLE;
  private quota = STARTING_QUOTA;
  private scrapSold = 0;
  private credits = STARTING_CREDITS;
  private timeRemaining = DAY_LENGTH_SECONDS;
  private warnedDoorClose = false;
  // Tick at which the landing cutscene ends and free movement begins.
  private landingEndsAtTick = 0;

  constructor(code: LobbyCode, maxPlayers: number) {
    this.code = code;
    this.maxPlayers = maxPlayers;
    const { grid, spawn } = generateShip();
    this.ship = grid;
    this.shipSpawn = spawn;
  }

  isEmpty(): boolean {
    return this.players.size === 0;
  }
  isFull(): boolean {
    return this.players.size >= this.maxPlayers;
  }

  addPlayer(ctx: ClientCtx): void {
    const state: PlayerState = {
      id: ctx.id,
      name: ctx.name,
      color: ctx.color,
      pos: { x: this.shipSpawn.x, y: this.shipSpawn.y },
      facing: 0,
      vel: { x: 0, y: 0 },
      hp: PLAYER_MAX_HEALTH,
      alive: true,
      scene: Scene.Ship,
      inventory: new Array(PLAYER_INVENTORY_SLOTS).fill(null),
      selectedSlot: 0,
      flashlightOn: false,
      credits: this.credits,
      ping: 0,
    };
    const lp: LobbyPlayer = {
      ctx,
      state,
      ready: false,
      lastInputSeq: 0,
      pendingInput: null,
      voiceActive: false,
    };
    this.players.set(ctx.id, lp);

    // Tell joining player they're in
    ctx.send({
      t: "lobby_joined",
      code: this.code,
      you: ctx.id,
      players: this.lobbyRoster(),
    });
    ctx.send({ t: "scene_ship", ship: { scene: this.ship } });

    this.broadcastLobbyUpdate();
    this.systemMessage(`${state.name} joined`);
  }

  removePlayer(playerId: PlayerId): void {
    const lp = this.players.get(playerId);
    if (!lp) return;
    this.players.delete(playerId);
    this.systemMessage(`${lp.state.name} left`);
    this.broadcastLobbyUpdate();
    // Tell remaining peers to drop voice connections
    this.broadcast({ t: "peer_voice", playerId, on: false });
  }

  handleMessage(ctx: ClientCtx, msg: ClientMsg): void {
    const lp = this.players.get(ctx.id);
    if (!lp) return;
    switch (msg.t) {
      case "ready":
        lp.ready = !!msg.ready;
        this.broadcastLobbyUpdate();
        if (this.allReady() && this.phase === "lobby") {
          this.phase = "in_ship";
          this.broadcastLobbyUpdate();
          this.systemMessage("All ready. The ship hums to life.");
        }
        return;
      case "input":
        lp.pendingInput = {
          seq: msg.seq,
          mv: clampVec(msg.mv),
          facing: Number.isFinite(msg.facing) ? msg.facing : lp.state.facing,
          flashlight: !!msg.flashlight,
          interact: !!msg.interact,
          drop: !!msg.drop,
          selectedSlot: clampSlot(msg.selectedSlot),
        };
        return;
      case "chat":
        this.handleChat(lp, msg.text, msg.channel);
        return;
      case "buy":
        this.handleBuy(lp, msg.itemId, Math.max(1, Math.floor(msg.qty || 1)));
        return;
      case "select_moon":
        if (MOONS[msg.moonId]) {
          this.moonId = msg.moonId;
          this.systemMessage(`Destination set: ${MOONS[msg.moonId]!.name}`);
        }
        return;
      case "launch":
        if (this.phase === "in_ship" || this.phase === "lobby") this.startLanding();
        return;
      case "return_to_orbit":
        if (this.phase === "in_facility") this.returnToOrbit();
        return;
      case "signal":
        this.relaySignal(ctx.id, msg.toPlayerId, msg.payload);
        return;
      case "voice_active":
        lp.voiceActive = !!msg.on;
        this.broadcast({ t: "peer_voice", playerId: ctx.id, on: lp.voiceActive }, ctx.id);
        return;
    }
  }

  // ──────────────── Tick loop ────────────────
  tick(): void {
    this.tick_n++;
    const dt = TICK_MS / 1000;

    if (this.phase === "landing" && this.tick_n >= this.landingEndsAtTick) {
      this.phase = "in_facility";
      this.timeRemaining = DAY_LENGTH_SECONDS;
      this.warnedDoorClose = false;
    }

    if (this.phase === "in_facility") {
      this.timeRemaining = Math.max(0, this.timeRemaining - dt);
      if (this.timeRemaining < DOOR_CLOSE_WARNING_SEC && !this.warnedDoorClose) {
        this.warnedDoorClose = true;
        this.systemMessage("Ship leaves orbit in 30 seconds. RETURN NOW.");
      }
      if (this.timeRemaining <= 0) {
        this.endDayHostile();
      }
    }

    // Apply player inputs and step
    for (const lp of this.players.values()) {
      this.stepPlayer(lp, dt);
    }

    // Step monsters (facility only)
    if (this.facility) {
      const playerList = [...this.players.values()].map((p) => p.state);
      for (const m of this.facility.monsters) {
        stepMonster(m, dt, this.facility.scene, playerList);
        // Damage on contact
        for (const p of playerList) {
          if (!p.alive || p.scene !== Scene.Facility) continue;
          const dx = p.pos.x - m.pos.x;
          const dy = p.pos.y - m.pos.y;
          if (dx * dx + dy * dy < 0.5 * 0.5) {
            p.hp -= 35 * dt;
            if (p.hp <= 0) {
              p.hp = 0;
              p.alive = false;
              this.systemMessage(`${p.name} was killed by a Stalker.`);
            }
          }
        }
      }
    }

    // Snapshot to all clients each tick
    if (this.tick_n % 1 === 0) this.broadcastSnapshot();
  }

  private stepPlayer(lp: LobbyPlayer, dt: number): void {
    const inp = lp.pendingInput;
    const p = lp.state;
    if (!p.alive) {
      p.vel.x = 0;
      p.vel.y = 0;
      return;
    }
    // During landing cutscene, hold the player still on the landing pad.
    if (this.phase === "landing") {
      p.vel.x = 0;
      p.vel.y = 0;
      if (inp) lp.lastInputSeq = inp.seq;
      return;
    }
    let mvx = 0,
      mvy = 0;
    if (inp) {
      mvx = inp.mv.x;
      mvy = inp.mv.y;
      p.facing = inp.facing;
      const wantFlashlight = inp.flashlight;
      // Flashlight needs item in inventory
      if (wantFlashlight && hasItem(p, "flashlight")) {
        p.flashlightOn = true;
      } else {
        p.flashlightOn = false;
      }
      p.selectedSlot = inp.selectedSlot;
      lp.lastInputSeq = inp.seq;
      if (inp.interact) this.handleInteract(lp);
      if (inp.drop) this.handleDrop(lp);
    }
    // Normalize movement vector
    const mag = Math.hypot(mvx, mvy);
    if (mag > 1) {
      mvx /= mag;
      mvy /= mag;
    }
    const speed = PLAYER_SPEED;
    const nx = p.pos.x + mvx * speed * dt;
    const ny = p.pos.y + mvy * speed * dt;
    const grid = p.scene === Scene.Ship ? this.ship : this.facility?.scene;
    if (grid) {
      // Axis-separated collision so sliding works
      if (isWalkable(grid, nx, p.pos.y)) p.pos.x = nx;
      if (isWalkable(grid, p.pos.x, ny)) p.pos.y = ny;
    }
    p.vel = { x: mvx * speed, y: mvy * speed };

    // Carry scrap value mirrored
    p.credits = this.credits;
  }

  private handleInteract(lp: LobbyPlayer): void {
    const p = lp.state;
    if (p.scene === Scene.Ship) {
      const tile = tileAt(this.ship, Math.floor(p.pos.x), Math.floor(p.pos.y));
      if (tile === TileType.CompanyDesk) {
        this.sellAllScrap();
      } else if (tile === TileType.ShipExit) {
        this.startLanding();
      }
      return;
    }
    if (p.scene === Scene.Facility && this.facility) {
      // Pick up nearest scrap or item
      const facility = this.facility;
      let bestIdx = -1;
      let bestDist = 1.2;
      let bestKind: "scrap" | "item" = "scrap";
      facility.scrap.forEach((s, i) => {
        if (s.carriedBy) return;
        const d = Math.hypot(s.pos.x - p.pos.x, s.pos.y - p.pos.y);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
          bestKind = "scrap";
        }
      });
      facility.items.forEach((it, i) => {
        if (it.carriedBy) return;
        const d = Math.hypot(it.pos.x - p.pos.x, it.pos.y - p.pos.y);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
          bestKind = "item";
        }
      });
      if (bestIdx >= 0) {
        const slot = p.inventory.findIndex((s) => s === null);
        if (slot < 0) {
          this.dm(lp, "Inventory full.");
          return;
        }
        if (bestKind === "scrap") {
          const s = facility.scrap[bestIdx]!;
          s.carriedBy = p.id;
          p.inventory[slot] = { id: s.id, itemId: s.itemId, pos: { ...s.pos }, carriedBy: p.id };
        } else {
          const it = facility.items[bestIdx]!;
          it.carriedBy = p.id;
          p.inventory[slot] = { id: it.id, itemId: it.itemId, pos: { ...it.pos }, carriedBy: p.id };
        }
        return;
      }
      // Or step on ship-exit pad to return to orbit
      const exit = facility.shipExit;
      if (Math.hypot(exit.x - p.pos.x, exit.y - p.pos.y) < 1.2) {
        // bring carried scrap back to ship as sold inventory bank
        this.depositPlayerScrap(lp);
        p.scene = Scene.Ship;
        p.pos = { x: this.shipSpawn.x, y: this.shipSpawn.y };
        this.systemMessage(`${p.name} returned to orbit.`);
      }
    }
  }

  private handleDrop(lp: LobbyPlayer): void {
    const p = lp.state;
    const slot = p.selectedSlot;
    const it = p.inventory[slot];
    if (!it) return;
    p.inventory[slot] = null;
    if (this.facility && p.scene === Scene.Facility) {
      // Keep entity on the floor at player's pos
      const isScrap = it.itemId.startsWith("scrap_");
      if (isScrap) {
        const existing = this.facility.scrap.find((s) => s.id === it.id);
        if (existing) {
          existing.pos = { x: p.pos.x, y: p.pos.y };
          existing.carriedBy = null;
        }
      } else {
        const existing = this.facility.items.find((s) => s.id === it.id);
        if (existing) {
          existing.pos = { x: p.pos.x, y: p.pos.y };
          existing.carriedBy = null;
        } else {
          this.facility.items.push({ id: it.id, itemId: it.itemId, pos: { x: p.pos.x, y: p.pos.y }, carriedBy: null });
        }
      }
    }
    // Items dropped on the ship are simply removed for v0.1 (no overworld pickup yet)
  }

  private depositPlayerScrap(lp: LobbyPlayer): void {
    const p = lp.state;
    if (!this.facility) return;
    let deposited = 0;
    for (let i = 0; i < p.inventory.length; i++) {
      const it = p.inventory[i];
      if (!it) continue;
      if (it.itemId.startsWith("scrap_")) {
        const s = this.facility.scrap.find((x) => x.id === it.id);
        const value = s?.value ?? ITEMS[it.itemId]?.baseValue ?? 0;
        deposited += value;
        if (s) s.carriedBy = null; // remove from world
        // Remove the scrap entity entirely (it's "stowed in ship")
        this.facility.scrap = this.facility.scrap.filter((x) => x.id !== it.id);
        p.inventory[i] = null;
      }
    }
    if (deposited > 0) {
      this.scrapSold += deposited;
      this.systemMessage(`${p.name} stowed ${deposited} credits worth of scrap.`);
    }
  }

  private sellAllScrap(): void {
    if (this.scrapSold <= 0) {
      this.systemMessage("Nothing to sell.");
      return;
    }
    const sold = this.scrapSold;
    this.credits += sold;
    this.scrapSold = 0;
    this.systemMessage(`Sold ${sold} credits of scrap to The Company.`);
  }

  private handleBuy(lp: LobbyPlayer, itemId: ItemId, qty: number): void {
    if (lp.state.scene !== Scene.Ship) {
      this.dm(lp, "Use the terminal in the ship.");
      return;
    }
    const def = ITEMS[itemId];
    if (!def || def.kind !== "tool" || !def.price) {
      this.dm(lp, "Unknown item.");
      return;
    }
    const cost = def.price * qty;
    if (this.credits < cost) {
      this.dm(lp, "Not enough credits.");
      return;
    }
    let bought = 0;
    for (let i = 0; i < qty; i++) {
      const slot = lp.state.inventory.findIndex((s) => s === null);
      if (slot < 0) break;
      lp.state.inventory[slot] = {
        id: newEntityId(),
        itemId,
        pos: { x: lp.state.pos.x, y: lp.state.pos.y },
        carriedBy: lp.state.id,
      };
      bought++;
    }
    if (bought > 0) {
      this.credits -= def.price * bought;
      this.systemMessage(`${lp.state.name} bought ${bought}× ${def.name}.`);
    } else {
      this.dm(lp, "Inventory full.");
    }
  }

  // ──────────────── Day cycle ────────────────
  private startLanding(): void {
    const seed = hashSeed(`${this.code}:${this.moonId}:${this.dayNumber}`);
    this.facility = generateFacility(this.moonId, seed);
    const moon = MOONS[this.moonId];
    // Spawn all players on the exterior landing pad. They walk to the bunker entrance
    // and on through to the procgen interior themselves.
    for (const lp of this.players.values()) {
      lp.state.scene = Scene.Facility;
      // Spread players slightly across the 5x5 pad so they don't pile up
      const pad = this.facility.shipExit;
      const idx = [...this.players.values()].indexOf(lp);
      const offsets = [
        { x: 0, y: 0 },
        { x: 1.0, y: 0 },
        { x: -1.0, y: 0 },
        { x: 0, y: 1.0 },
      ];
      const off = offsets[idx % offsets.length]!;
      lp.state.pos = { x: pad.x + off.x, y: pad.y + off.y };
      lp.state.hp = PLAYER_MAX_HEALTH;
      lp.state.alive = true;
      lp.state.facing = -Math.PI / 2; // face north toward the bunker
    }
    this.phase = "landing";
    this.landingEndsAtTick = this.tick_n + Math.ceil(LANDING_CUTSCENE_MS / TICK_MS);
    // Send facility scene to clients (they'll show the cutscene overlay)
    this.broadcast({
      t: "scene_facility",
      facility: {
        moonId: this.moonId,
        moonName: moon?.name,
        seed,
        scene: this.facility.scene,
        scrap: this.facility.scrap,
        items: this.facility.items,
        monsters: this.facility.monsters,
        shipExit: this.facility.shipExit,
        entrance: this.facility.entrance,
      },
    });
    this.systemMessage(`Descending to ${moon?.name ?? this.moonId}. Day ${this.dayNumber}.`);
  }

  private returnToOrbit(): void {
    // Players still in facility: deposit scrap + return
    for (const lp of this.players.values()) {
      if (lp.state.scene !== Scene.Facility) continue;
      this.depositPlayerScrap(lp);
      lp.state.scene = Scene.Ship;
      lp.state.pos = { x: this.shipSpawn.x, y: this.shipSpawn.y };
    }
    this.endDay({ leftBehind: 0 });
  }

  private endDayHostile(): void {
    let leftBehind = 0;
    for (const lp of this.players.values()) {
      if (lp.state.scene === Scene.Facility) {
        if (lp.state.alive) {
          this.systemMessage(`${lp.state.name} was left behind.`);
          lp.state.alive = false;
        }
        lp.state.scene = Scene.Ship;
        lp.state.pos = { x: this.shipSpawn.x, y: this.shipSpawn.y };
        leftBehind++;
      }
    }
    this.endDay({ leftBehind });
  }

  private endDay({ leftBehind: _leftBehind }: { leftBehind: number }): void {
    this.facility = null;
    this.phase = "in_ship";
    this.daysRemaining--;
    this.broadcast({
      t: "day_end",
      survivors: [...this.players.values()].filter((p) => p.state.alive).map((p) => p.state.id),
      scrapTotal: this.scrapSold,
    });
    this.broadcast({ t: "scene_ship", ship: { scene: this.ship } });

    // Revive everyone for next day (v0.1 simplification: only quota loss is game-over)
    for (const lp of this.players.values()) {
      lp.state.alive = true;
      lp.state.hp = PLAYER_MAX_HEALTH;
    }

    if (this.daysRemaining <= 0) {
      // Quota check
      if (this.credits + this.scrapSold >= this.quota) {
        // Met quota — reset
        this.systemMessage(`Quota met! New quota: ${Math.ceil(this.quota * QUOTA_INCREMENT)}.`);
        this.quota = Math.ceil(this.quota * QUOTA_INCREMENT);
        this.daysRemaining = DAYS_PER_QUOTA_CYCLE;
      } else {
        // Game over
        this.phase = "game_over";
        this.broadcast({
          t: "game_over",
          reason: `You failed to meet quota of ${this.quota}.`,
          finalQuotaCycle: Math.floor(this.dayNumber / DAYS_PER_QUOTA_CYCLE),
        });
        this.systemMessage(`GAME OVER — quota not met.`);
        this.resetForNewGame();
        return;
      }
    }
    this.dayNumber++;
    this.systemMessage(`Day ${this.dayNumber}: ${this.daysRemaining} day(s) until quota.`);
  }

  private resetForNewGame(): void {
    setTimeout(() => {
      this.dayNumber = 1;
      this.daysRemaining = DAYS_PER_QUOTA_CYCLE;
      this.quota = STARTING_QUOTA;
      this.credits = STARTING_CREDITS;
      this.scrapSold = 0;
      this.phase = "in_ship";
      for (const lp of this.players.values()) {
        lp.state.inventory = new Array(PLAYER_INVENTORY_SLOTS).fill(null);
        lp.state.pos = { x: this.shipSpawn.x, y: this.shipSpawn.y };
      }
      this.systemMessage("New contract begun.");
    }, 4000);
  }

  // ──────────────── Chat / signaling ────────────────
  private handleChat(lp: LobbyPlayer, raw: string, channel: "proximity" | "ship"): void {
    const text = String(raw ?? "").slice(0, 200).trim();
    if (!text) return;
    const sender = lp.state;
    if (channel === "ship") {
      if (sender.scene !== Scene.Ship) {
        this.dm(lp, "You must be on the ship to use ship channel.");
        return;
      }
      for (const other of this.players.values()) {
        if (other.state.scene === Scene.Ship) {
          other.ctx.send({ t: "chat", from: sender.id, fromName: sender.name, text, channel: "ship" });
        }
      }
      return;
    }
    // proximity
    for (const other of this.players.values()) {
      if (other.state.scene !== sender.scene) continue;
      const d = Math.hypot(other.state.pos.x - sender.pos.x, other.state.pos.y - sender.pos.y);
      if (d <= PROXIMITY_TEXT_RADIUS) {
        // simple wall block: if direct sight is blocked, drop the message
        const grid = sender.scene === Scene.Ship ? this.ship : this.facility?.scene;
        if (!grid || lineOfSight(grid, sender.pos, other.state.pos)) {
          other.ctx.send({ t: "chat", from: sender.id, fromName: sender.name, text, channel: "proximity" });
        }
      }
    }
  }

  private relaySignal(fromId: PlayerId, toId: PlayerId, payload: unknown): void {
    const target = this.players.get(toId);
    if (!target) return;
    target.ctx.send({ t: "signal", fromPlayerId: fromId, payload });
  }

  // ──────────────── Helpers ────────────────
  private allReady(): boolean {
    return this.players.size > 0 && [...this.players.values()].every((lp) => lp.ready);
  }

  private lobbyRoster() {
    return [...this.players.values()].map((p) => ({
      id: p.state.id,
      name: p.state.name,
      color: p.state.color,
      ready: p.ready,
    }));
  }

  private broadcastLobbyUpdate(): void {
    this.broadcast({ t: "lobby_update", players: this.lobbyRoster(), phase: this.phase });
  }

  private broadcastSnapshot(): void {
    const playersArr: PlayerState[] = [...this.players.values()].map((p) => p.state);
    const monsters: Monster[] = this.facility?.monsters ?? [];
    const scrap: ScrapInstance[] = this.facility?.scrap ?? [];
    const items: ItemInstance[] = this.facility?.items ?? [];
    const snap: GameSnapshot = {
      tick: this.tick_n,
      phase: this.phase,
      dayNumber: this.dayNumber,
      daysRemaining: this.daysRemaining,
      quota: this.quota,
      scrapSold: this.scrapSold,
      credits: this.credits,
      timeRemaining: this.timeRemaining,
      players: playersArr,
      monsters,
      scrap,
      items,
    };
    for (const p of this.players.values()) {
      p.ctx.send({ t: "snapshot", snap, ackSeq: p.lastInputSeq });
    }
  }

  private broadcast(msg: ServerMsg, exceptId?: PlayerId): void {
    for (const p of this.players.values()) {
      if (exceptId && p.state.id === exceptId) continue;
      p.ctx.send(msg);
    }
  }

  private systemMessage(text: string): void {
    for (const p of this.players.values()) {
      p.ctx.send({ t: "chat", from: "system", fromName: "SYSTEM", text, channel: "system" });
    }
  }

  private dm(lp: LobbyPlayer, text: string): void {
    lp.ctx.send({ t: "chat", from: "system", fromName: "SYSTEM", text, channel: "system" });
  }
}

function clampVec(v: Vec2 | null | undefined): Vec2 {
  if (!v) return { x: 0, y: 0 };
  const x = clamp(Number(v.x) || 0, -1, 1);
  const y = clamp(Number(v.y) || 0, -1, 1);
  return { x, y };
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function clampSlot(n: unknown): number {
  const x = Math.floor(Number(n) || 0);
  return Math.max(0, Math.min(PLAYER_INVENTORY_SLOTS - 1, x));
}

function hasItem(p: PlayerState, itemId: ItemId): boolean {
  return p.inventory.some((i) => i?.itemId === itemId);
}

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
