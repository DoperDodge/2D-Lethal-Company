import {
  DAYS_PER_QUOTA_CYCLE,
  DAY_LENGTH_SECONDS,
  DEFAULT_MOON_ID,
  DOOR_CLOSE_WARNING_SEC,
  ITEMS,
  LANDING_CUTSCENE_MS,
  MOONS,
  PLAYER_INVENTORY_SLOTS,
  PLAYER_MAX_HEALTH,
  PROXIMITY_TEXT_RADIUS,
  QUOTA_INCREMENT,
  Scene,
  STARTING_CREDITS,
  STARTING_QUOTA,
  TICK_MS,
  TileType,
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
import { generateShip, type ShipScene } from "../world/ship.js";
import { generateAtriumSurface, generateExperimentationSurface, type SurfaceScene } from "../world/surface.js";
import { generateCompanyInterior, type CompanyScene } from "../world/company.js";
import { generateFacility, type GeneratedFacility } from "../procgen/facility.js";
import { stepMonster } from "../world/monster.js";
import { isWalkable, lineOfSight, tileAt } from "../world/grid.js";

// One scene's authoritative state. Players are tracked in a flat map but
// each carries a `scene` field; entities in `entities` belong to that scene.
type SceneInstance = {
  grid: TileGrid;
  scrap: ScrapInstance[];
  items: ItemInstance[];
  monsters: Monster[];
};

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

function buildSurface(moonId: string): SurfaceScene {
  if (moonId === "experimentation") return generateExperimentationSurface();
  return generateAtriumSurface();
}

export class Lobby {
  readonly code: LobbyCode;
  private maxPlayers: number;
  private players = new Map<PlayerId, LobbyPlayer>();
  private phase: LobbyPhase = "lobby";
  private tick_n = 0;

  // Persistent ship interior + dropped items inside it (carry across launches)
  private shipScene: ShipScene;
  private shipState: SceneInstance;
  // Sell building interior — only meaningful when on Atrium
  private companyScene: CompanyScene;
  private companyState: SceneInstance;
  // Current moon's outdoor surface (regenerated when moon changes)
  private surfaceScene: SurfaceScene;
  private surfaceState: SceneInstance;
  // Procgen interior (only valid when current moon has a facility, regenerated per launch)
  private interiorScene: GeneratedFacility | null = null;
  private interiorState: SceneInstance | null = null;

  private moonId: string = DEFAULT_MOON_ID;

  // Day/quota
  private dayNumber = 1;
  private daysRemaining = DAYS_PER_QUOTA_CYCLE;
  private quota = STARTING_QUOTA;
  private credits = STARTING_CREDITS;
  private timeRemaining = DAY_LENGTH_SECONDS;
  private warnedDoorClose = false;
  private landingEndsAtTick = 0;

  constructor(code: LobbyCode, maxPlayers: number) {
    this.code = code;
    this.maxPlayers = maxPlayers;
    this.shipScene = generateShip();
    this.shipState = { grid: this.shipScene.grid, scrap: [], items: [], monsters: [] };
    this.companyScene = generateCompanyInterior();
    this.companyState = { grid: this.companyScene.grid, scrap: [], items: [], monsters: [] };
    this.surfaceScene = buildSurface(this.moonId);
    this.surfaceState = { grid: this.surfaceScene.grid, scrap: [], items: [], monsters: [] };
  }

  isEmpty(): boolean { return this.players.size === 0; }
  isFull(): boolean { return this.players.size >= this.maxPlayers; }

  addPlayer(ctx: ClientCtx): void {
    // Default: every contractor gets a flashlight on lobby join. Without this
    // pressing F does nothing because the server requires the item in inventory.
    const inventory: (ItemInstance | null)[] = new Array(PLAYER_INVENTORY_SLOTS).fill(null);
    inventory[0] = {
      id: newEntityId(),
      itemId: "flashlight",
      pos: { x: 0, y: 0 },
      carriedBy: ctx.id,
    };

    const state: PlayerState = {
      id: ctx.id,
      name: ctx.name,
      color: ctx.color,
      pos: { x: this.shipScene.innerSpawn.x, y: this.shipScene.innerSpawn.y },
      facing: -Math.PI / 2,
      vel: { x: 0, y: 0 },
      hp: PLAYER_MAX_HEALTH,
      alive: true,
      scene: Scene.Ship,
      inventory,
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

    ctx.send({
      t: "lobby_joined",
      code: this.code,
      you: ctx.id,
      players: this.lobbyRoster(),
    });
    this.sendSceneToPlayer(lp);
    this.broadcastLobbyUpdate();
    this.systemMessage(`${state.name} joined`);
  }

  removePlayer(playerId: PlayerId): void {
    const lp = this.players.get(playerId);
    if (!lp) return;
    this.players.delete(playerId);
    this.systemMessage(`${lp.state.name} left`);
    this.broadcastLobbyUpdate();
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
        if (this.phase === "in_ship" || this.phase === "lobby" || this.phase === "in_facility") {
          this.startLanding(this.moonId);
        }
        return;
      case "return_to_orbit":
        if (this.phase === "in_facility") this.returnToShip();
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

    // Day timer only runs on industrial moons (those that have a facility).
    const moon = MOONS[this.moonId];
    if (this.phase === "in_facility" && moon?.hasFacility) {
      this.timeRemaining = Math.max(0, this.timeRemaining - dt);
      if (this.timeRemaining < DOOR_CLOSE_WARNING_SEC && !this.warnedDoorClose) {
        this.warnedDoorClose = true;
        this.systemMessage("Ship leaves orbit in 30 seconds. RETURN NOW.");
      }
      if (this.timeRemaining <= 0) {
        this.endDayHostile();
      }
    }

    for (const lp of this.players.values()) {
      this.stepPlayer(lp, dt);
    }

    // Step monsters in interior only (other scenes have none)
    if (this.interiorState) {
      const playersInInterior = [...this.players.values()]
        .map((p) => p.state)
        .filter((p) => p.scene === Scene.Interior);
      for (const m of this.interiorState.monsters) {
        stepMonster(m, dt, this.interiorState.grid, playersInInterior);
        for (const p of playersInInterior) {
          if (!p.alive) continue;
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

    this.broadcastSnapshot();
  }

  private stepPlayer(lp: LobbyPlayer, dt: number): void {
    const inp = lp.pendingInput;
    const p = lp.state;
    if (!p.alive) {
      p.vel.x = 0;
      p.vel.y = 0;
      return;
    }
    // During landing cutscene, players are pinned inside the ship.
    if (this.phase === "landing") {
      p.vel.x = 0;
      p.vel.y = 0;
      if (inp) lp.lastInputSeq = inp.seq;
      return;
    }
    let mvx = 0, mvy = 0;
    if (inp) {
      mvx = inp.mv.x;
      mvy = inp.mv.y;
      p.facing = inp.facing;
      // Flashlight: respects whether the player has one in inventory.
      if (inp.flashlight && hasItem(p, "flashlight")) p.flashlightOn = true;
      else p.flashlightOn = false;
      p.selectedSlot = inp.selectedSlot;
      lp.lastInputSeq = inp.seq;
      if (inp.interact) this.handleInteract(lp);
      if (inp.drop) this.handleDrop(lp);
    }
    const mag = Math.hypot(mvx, mvy);
    if (mag > 1) { mvx /= mag; mvy /= mag; }
    const speed = 4.0;
    const nx = p.pos.x + mvx * speed * dt;
    const ny = p.pos.y + mvy * speed * dt;
    const sceneInst = this.sceneFor(p.scene);
    if (sceneInst) {
      if (isWalkable(sceneInst.grid, nx, p.pos.y)) p.pos.x = nx;
      if (isWalkable(sceneInst.grid, p.pos.x, ny)) p.pos.y = ny;
    }
    p.vel = { x: mvx * speed, y: mvy * speed };
    p.credits = this.credits;
  }

  private sceneFor(scene: Scene): SceneInstance | null {
    switch (scene) {
      case Scene.Ship: return this.shipState;
      case Scene.Surface: return this.surfaceState;
      case Scene.Interior: return this.interiorState;
      case Scene.Company: return this.companyState;
      default: return null;
    }
  }

  private transitionPlayer(lp: LobbyPlayer, toScene: Scene, pos: Vec2): void {
    lp.state.scene = toScene;
    lp.state.pos = { x: pos.x, y: pos.y };
    this.sendSceneToPlayer(lp);
  }

  private sendSceneToPlayer(lp: LobbyPlayer): void {
    const sceneInst = this.sceneFor(lp.state.scene);
    if (!sceneInst) return;
    const moon = MOONS[this.moonId];
    lp.ctx.send({
      t: "scene_change",
      scene: lp.state.scene,
      grid: sceneInst.grid,
      moonId: this.moonId,
      moonName: moon?.name,
    });
  }

  private handleInteract(lp: LobbyPlayer): void {
    const p = lp.state;
    const sceneInst = this.sceneFor(p.scene);
    if (!sceneInst) return;
    const tx = Math.floor(p.pos.x);
    const ty = Math.floor(p.pos.y);
    const tileHere = tileAt(sceneInst.grid, tx, ty);

    // Doors: pressing E on or directly adjacent to a door tile transitions
    // between scenes. Stepping on the tile alone doesn't fire — the player
    // chooses when to walk through.
    if (tileHere === TileType.ShipDoor || tileAdjacent(sceneInst.grid, p.pos, TileType.ShipDoor)) {
      if (p.scene === Scene.Ship) {
        this.transitionPlayer(lp, Scene.Surface, this.surfaceScene.arrivalSpawn);
        return;
      }
      if (p.scene === Scene.Surface) {
        this.transitionPlayer(lp, Scene.Ship, this.shipScene.innerSpawn);
        return;
      }
    }
    if (tileHere === TileType.FacilityEntrance || tileAdjacent(sceneInst.grid, p.pos, TileType.FacilityEntrance)) {
      if (p.scene === Scene.Surface && this.interiorState && this.interiorScene) {
        this.transitionPlayer(lp, Scene.Interior, this.interiorScene.entrance);
        return;
      }
      if (p.scene === Scene.Interior && this.surfaceScene.facilityEntrance) {
        const out = { x: this.surfaceScene.facilityEntrance.x, y: this.surfaceScene.facilityEntrance.y + 2 };
        this.transitionPlayer(lp, Scene.Surface, out);
        return;
      }
    }
    if (tileHere === TileType.CompanyDoor || tileAdjacent(sceneInst.grid, p.pos, TileType.CompanyDoor)) {
      if (p.scene === Scene.Surface && this.moonId === "atrium") {
        this.transitionPlayer(lp, Scene.Company, this.companyScene.innerSpawn);
        return;
      }
      if (p.scene === Scene.Company && this.surfaceScene.companyDoor) {
        const out = { x: this.surfaceScene.companyDoor.x, y: this.surfaceScene.companyDoor.y + 1 };
        this.transitionPlayer(lp, Scene.Surface, out);
        return;
      }
    }

    // Console / desk interactions
    if (p.scene === Scene.Ship && tileAdjacent(sceneInst.grid, p.pos, TileType.ShipConsole)) {
      lp.ctx.send({ t: "open_terminal" });
      return;
    }
    if (p.scene === Scene.Company && tileAdjacent(sceneInst.grid, p.pos, TileType.CompanyDesk)) {
      this.sellAllScrap();
      return;
    }

    // Pickup nearest scrap or item in current scene
    let bestIdx = -1;
    let bestDist = 1.2;
    let bestKind: "scrap" | "item" = "scrap";
    sceneInst.scrap.forEach((s, i) => {
      if (s.carriedBy) return;
      const d = Math.hypot(s.pos.x - p.pos.x, s.pos.y - p.pos.y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
        bestKind = "scrap";
      }
    });
    sceneInst.items.forEach((it, i) => {
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
        const s = sceneInst.scrap[bestIdx]!;
        s.carriedBy = p.id;
        // Move scrap entity into inventory by removing from scene list
        sceneInst.scrap.splice(bestIdx, 1);
        p.inventory[slot] = { id: s.id, itemId: s.itemId, pos: { x: 0, y: 0 }, carriedBy: p.id };
        // We lose the per-scrap value when stowed; remember it via a side map.
        scrapValueById.set(s.id, s.value);
      } else {
        const it = sceneInst.items[bestIdx]!;
        sceneInst.items.splice(bestIdx, 1);
        it.carriedBy = p.id;
        p.inventory[slot] = { id: it.id, itemId: it.itemId, pos: { x: 0, y: 0 }, carriedBy: p.id };
      }
    }
  }

  private handleDrop(lp: LobbyPlayer): void {
    const p = lp.state;
    const slot = p.selectedSlot;
    const it = p.inventory[slot];
    if (!it) return;
    const sceneInst = this.sceneFor(p.scene);
    if (!sceneInst) return;
    p.inventory[slot] = null;
    const isScrap = it.itemId.startsWith("scrap_");
    if (isScrap) {
      const value = scrapValueById.get(it.id) ?? ITEMS[it.itemId]?.baseValue ?? 0;
      sceneInst.scrap.push({
        id: it.id,
        itemId: it.itemId,
        pos: { x: p.pos.x, y: p.pos.y },
        value,
        carriedBy: null,
      });
    } else {
      sceneInst.items.push({
        id: it.id,
        itemId: it.itemId,
        pos: { x: p.pos.x, y: p.pos.y },
        carriedBy: null,
      });
    }
  }

  /** Sells every piece of scrap currently on the ship floor + held by anyone in the company building. */
  private sellAllScrap(): void {
    let total = 0;
    // Ship-floor scrap is "stowed" cargo
    for (const s of this.shipState.scrap) total += s.value;
    this.shipState.scrap = [];
    // Plus held scrap by anyone currently in the company building
    for (const lp of this.players.values()) {
      if (lp.state.scene !== Scene.Company) continue;
      for (let i = 0; i < lp.state.inventory.length; i++) {
        const it = lp.state.inventory[i];
        if (it && it.itemId.startsWith("scrap_")) {
          total += scrapValueById.get(it.id) ?? ITEMS[it.itemId]?.baseValue ?? 0;
          lp.state.inventory[i] = null;
        }
      }
    }
    if (total <= 0) {
      this.systemMessage("Company desk: nothing to sell. Drop scrap inside the ship first.");
      return;
    }
    this.credits += total;
    this.systemMessage(`Sold ${total} credits of scrap. Crew balance: ${this.credits}.`);
  }

  private handleBuy(lp: LobbyPlayer, itemId: ItemId, qty: number): void {
    if (lp.state.scene !== Scene.Ship) {
      this.dm(lp, "Use the console inside the ship.");
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
        pos: { x: 0, y: 0 },
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
  private startLanding(toMoonId: string): void {
    const moon = MOONS[toMoonId];
    if (!moon) return;
    this.moonId = toMoonId;
    // Rebuild the surface for the new moon
    this.surfaceScene = buildSurface(toMoonId);
    this.surfaceState = { grid: this.surfaceScene.grid, scrap: [], items: [], monsters: [] };
    // (Re)generate facility interior if applicable, with a fresh random seed
    if (moon.hasFacility) {
      this.interiorScene = generateFacility(toMoonId);
      this.interiorState = {
        grid: this.interiorScene.scene,
        scrap: this.interiorScene.scrap,
        items: [],
        monsters: this.interiorScene.monsters,
      };
    } else {
      this.interiorScene = null;
      this.interiorState = null;
    }

    // Pull every player into the ship for the cutscene; they emerge by walking
    // out the ship door once the cutscene ends.
    for (const lp of this.players.values()) {
      lp.state.scene = Scene.Ship;
      lp.state.pos = { x: this.shipScene.innerSpawn.x, y: this.shipScene.innerSpawn.y };
      lp.state.hp = PLAYER_MAX_HEALTH;
      lp.state.alive = true;
      this.sendSceneToPlayer(lp);
    }
    this.phase = "landing";
    this.landingEndsAtTick = this.tick_n + Math.ceil(LANDING_CUTSCENE_MS / TICK_MS);
    // Tell clients to play the descent cutscene
    this.broadcast({ t: "cutscene_begin", moonId: toMoonId, moonName: moon.name, durationMs: LANDING_CUTSCENE_MS });
    this.systemMessage(`Descending to ${moon.name}.`);
  }

  private returnToShip(): void {
    for (const lp of this.players.values()) {
      lp.state.scene = Scene.Ship;
      lp.state.pos = { x: this.shipScene.innerSpawn.x, y: this.shipScene.innerSpawn.y };
      this.sendSceneToPlayer(lp);
    }
  }

  private endDayHostile(): void {
    let leftBehind = 0;
    for (const lp of this.players.values()) {
      if (lp.state.scene === Scene.Interior) {
        if (lp.state.alive) {
          this.systemMessage(`${lp.state.name} was left behind.`);
          lp.state.alive = false;
        }
        leftBehind++;
      }
    }
    // Force everyone into the ship (cutscene-style — no hard transition needed)
    for (const lp of this.players.values()) {
      lp.state.scene = Scene.Ship;
      lp.state.pos = { x: this.shipScene.innerSpawn.x, y: this.shipScene.innerSpawn.y };
      this.sendSceneToPlayer(lp);
    }
    this.endDay({ leftBehind });
  }

  private endDay({ leftBehind: _leftBehind }: { leftBehind: number }): void {
    this.interiorScene = null;
    this.interiorState = null;
    this.phase = "in_facility";
    this.daysRemaining--;
    this.broadcast({
      t: "day_end",
      survivors: [...this.players.values()].filter((p) => p.state.alive).map((p) => p.state.id),
      scrapTotal: this.shipState.scrap.length,
    });

    for (const lp of this.players.values()) {
      lp.state.alive = true;
      lp.state.hp = PLAYER_MAX_HEALTH;
    }

    if (this.daysRemaining <= 0) {
      // Quota check at end of cycle
      const stowedValue = this.shipState.scrap.reduce((a, s) => a + s.value, 0);
      if (this.credits + stowedValue >= this.quota) {
        this.systemMessage(`Quota met! New quota: ${Math.ceil(this.quota * QUOTA_INCREMENT)}.`);
        this.quota = Math.ceil(this.quota * QUOTA_INCREMENT);
        this.daysRemaining = DAYS_PER_QUOTA_CYCLE;
      } else {
        this.phase = "game_over";
        this.broadcast({
          t: "game_over",
          reason: `You failed to meet quota of ${this.quota}.`,
          finalQuotaCycle: Math.floor(this.dayNumber / DAYS_PER_QUOTA_CYCLE),
        });
        this.systemMessage("GAME OVER — quota not met.");
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
      this.shipState.scrap = [];
      this.shipState.items = [];
      this.phase = "in_ship";
      for (const lp of this.players.values()) {
        lp.state.inventory = new Array(PLAYER_INVENTORY_SLOTS).fill(null);
        lp.state.inventory[0] = {
          id: newEntityId(),
          itemId: "flashlight",
          pos: { x: 0, y: 0 },
          carriedBy: lp.state.id,
        };
        lp.state.pos = { x: this.shipScene.innerSpawn.x, y: this.shipScene.innerSpawn.y };
        lp.state.scene = Scene.Ship;
        this.sendSceneToPlayer(lp);
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
        this.dm(lp, "You must be inside the ship to use ship channel.");
        return;
      }
      for (const other of this.players.values()) {
        if (other.state.scene === Scene.Ship) {
          other.ctx.send({ t: "chat", from: sender.id, fromName: sender.name, text, channel: "ship" });
        }
      }
      return;
    }
    // Proximity — same scene, within radius, with line-of-sight
    for (const other of this.players.values()) {
      if (other.state.scene !== sender.scene) continue;
      const d = Math.hypot(other.state.pos.x - sender.pos.x, other.state.pos.y - sender.pos.y);
      if (d <= PROXIMITY_TEXT_RADIUS) {
        const inst = this.sceneFor(sender.scene);
        if (!inst || lineOfSight(inst.grid, sender.pos, other.state.pos)) {
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
    // Each player gets a personalized snapshot containing only entities in their scene.
    for (const lp of this.players.values()) {
      const myScene = lp.state.scene;
      const inst = this.sceneFor(myScene);
      const playersInScene = [...this.players.values()].map((p) => p.state).filter((p) => p.scene === myScene);
      const stowed = this.shipState.scrap.reduce((a, s) => a + s.value, 0);
      const snap: GameSnapshot = {
        tick: this.tick_n,
        phase: this.phase,
        dayNumber: this.dayNumber,
        daysRemaining: this.daysRemaining,
        quota: this.quota,
        scrapSold: stowed,
        credits: this.credits,
        timeRemaining: this.timeRemaining,
        players: playersInScene,
        monsters: inst?.monsters ?? [],
        scrap: inst?.scrap ?? [],
        items: inst?.items ?? [],
      };
      lp.ctx.send({ t: "snapshot", snap, ackSeq: lp.lastInputSeq });
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

// Side map: scrap value gets attached to the carried inventory item by id so
// we don't lose its sell price when it's stowed in the player's inventory.
const scrapValueById = new Map<number, number>();

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
function tileAdjacent(g: TileGrid, pos: Vec2, target: TileType): boolean {
  const cx = Math.floor(pos.x);
  const cy = Math.floor(pos.y);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tileAt(g, cx + dx, cy + dy) === target) return true;
    }
  }
  return false;
}
