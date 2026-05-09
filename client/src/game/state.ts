import type {
  GameSnapshot,
  ItemInstance,
  Monster,
  PlayerId,
  PlayerState,
  ScrapInstance,
  ServerMsg,
  TileGrid,
  Vec2,
} from "@quota/shared";
import { LANDING_CUTSCENE_MS, Scene } from "@quota/shared";

export type SnapEntry = { snap: GameSnapshot; recvAt: number };

export type ClientGameState = {
  myId: PlayerId | null;
  lobbyCode: string | null;
  lobbyRoster: { id: PlayerId; name: string; color: string; ready: boolean }[];
  phase: GameSnapshot["phase"] | "lobby";
  shipGrid: TileGrid | null;
  facilityGrid: TileGrid | null;
  facilityLandingPad: Vec2 | null;
  facilityEntrance: Vec2 | null;
  // Snapshot buffer for interpolation
  snapBuffer: SnapEntry[];
  // Most recent display-time interpolated snapshot (built by GameView each frame)
  displaySnap: GameSnapshot | null;
  // Chat
  chatLog: { from: PlayerId; fromName: string; text: string; channel: "proximity" | "ship" | "system"; ts: number }[];
  // Voice peers (player ids who are actively transmitting)
  voicePeers: Set<PlayerId>;
  // Day-end / game-over toasts
  toast: string | null;
  toastUntil: number;
  // Landing cutscene
  cutsceneEndsAt: number;
  cutsceneMoonName: string | null;
};

export function newState(): ClientGameState {
  return {
    myId: null,
    lobbyCode: null,
    lobbyRoster: [],
    phase: "lobby",
    shipGrid: null,
    facilityGrid: null,
    facilityLandingPad: null,
    facilityEntrance: null,
    snapBuffer: [],
    displaySnap: null,
    chatLog: [],
    voicePeers: new Set(),
    toast: null,
    toastUntil: 0,
    cutsceneEndsAt: 0,
    cutsceneMoonName: null,
  };
}

export function applyServerMsg(s: ClientGameState, msg: ServerMsg): void {
  switch (msg.t) {
    case "welcome":
      s.myId = msg.playerId;
      return;
    case "lobby_joined":
      s.lobbyCode = msg.code;
      s.myId = msg.you;
      s.lobbyRoster = msg.players;
      return;
    case "lobby_update":
      s.lobbyRoster = msg.players;
      s.phase = msg.phase;
      return;
    case "lobby_left":
      s.lobbyCode = null;
      s.lobbyRoster = [];
      s.shipGrid = null;
      s.facilityGrid = null;
      s.snapBuffer = [];
      s.displaySnap = null;
      s.phase = "lobby";
      return;
    case "scene_ship":
      s.shipGrid = msg.ship.scene;
      s.facilityGrid = null;
      s.facilityLandingPad = null;
      s.facilityEntrance = null;
      // Drop snapshot buffer when scene changes — entities in old scene are gone
      s.snapBuffer = [];
      s.displaySnap = null;
      return;
    case "scene_facility":
      s.facilityGrid = msg.facility.scene;
      s.facilityLandingPad = msg.facility.shipExit;
      s.facilityEntrance = msg.facility.entrance ?? null;
      s.snapBuffer = [];
      s.displaySnap = null;
      // Trigger client-side landing cutscene
      s.cutsceneEndsAt = Date.now() + LANDING_CUTSCENE_MS;
      s.cutsceneMoonName = msg.facility.moonName ?? msg.facility.moonId ?? "";
      return;
    case "snapshot":
      s.snapBuffer.push({ snap: msg.snap, recvAt: Date.now() });
      // Keep last ~6 snapshots (300ms window)
      if (s.snapBuffer.length > 6) s.snapBuffer.splice(0, s.snapBuffer.length - 6);
      return;
    case "chat":
      s.chatLog.push({
        from: msg.from,
        fromName: msg.fromName,
        text: msg.text,
        channel: msg.channel,
        ts: Date.now(),
      });
      if (s.chatLog.length > 100) s.chatLog.splice(0, s.chatLog.length - 100);
      return;
    case "peer_voice":
      if (msg.on) s.voicePeers.add(msg.playerId);
      else s.voicePeers.delete(msg.playerId);
      return;
    case "day_end":
      s.toast = `Day ended — ${msg.scrapTotal} credits stowed`;
      s.toastUntil = Date.now() + 4000;
      return;
    case "game_over":
      s.toast = `GAME OVER — ${msg.reason}`;
      s.toastUntil = Date.now() + 6000;
      return;
    case "error":
      s.toast = msg.message;
      s.toastUntil = Date.now() + 3000;
      return;
  }
}

export function getMyPlayer(s: ClientGameState): PlayerState | null {
  const snap = s.displaySnap ?? latestSnap(s);
  if (!snap || !s.myId) return null;
  return snap.players.find((p) => p.id === s.myId) ?? null;
}

export function activeGrid(s: ClientGameState): TileGrid | null {
  const me = getMyPlayer(s);
  if (!me) return s.shipGrid;
  return me.scene === Scene.Ship ? s.shipGrid : s.facilityGrid;
}

export function latestSnap(s: ClientGameState): GameSnapshot | null {
  return s.snapBuffer.length ? s.snapBuffer[s.snapBuffer.length - 1]!.snap : null;
}

/**
 * Build an interpolated snapshot for the current render time.
 * renderTime should be `Date.now() - SNAPSHOT_RENDER_DELAY_MS`.
 * Returns the latest snapshot if there's only one, or interpolated otherwise.
 */
export function buildDisplaySnap(s: ClientGameState, renderTime: number): GameSnapshot | null {
  const buf = s.snapBuffer;
  if (buf.length === 0) return null;
  if (buf.length === 1) return buf[0]!.snap;

  // Find the two snapshots surrounding renderTime
  let prev = buf[0]!;
  let next = buf[buf.length - 1]!;
  for (let i = 0; i < buf.length - 1; i++) {
    const a = buf[i]!;
    const b = buf[i + 1]!;
    if (renderTime >= a.recvAt && renderTime <= b.recvAt) {
      prev = a;
      next = b;
      break;
    }
  }
  // If renderTime is before earliest, use the earliest pair
  if (renderTime < buf[0]!.recvAt) {
    prev = buf[0]!;
    next = buf[1]!;
  }
  // If renderTime is past latest, extrapolate from last pair (clamped to t=1)
  if (renderTime > next.recvAt) {
    prev = buf[buf.length - 2]!;
    next = buf[buf.length - 1]!;
  }

  const span = Math.max(1, next.recvAt - prev.recvAt);
  const t = Math.max(0, Math.min(1, (renderTime - prev.recvAt) / span));

  // Interpolate position-bearing entities; non-positional fields use `next`.
  const players = next.snap.players.map((p) => {
    const old = prev.snap.players.find((x) => x.id === p.id);
    if (!old) return p;
    return {
      ...p,
      pos: { x: lerp(old.pos.x, p.pos.x, t), y: lerp(old.pos.y, p.pos.y, t) },
      facing: lerpAngle(old.facing, p.facing, t),
    };
  });
  const monsters: Monster[] = next.snap.monsters.map((m) => {
    const old = prev.snap.monsters.find((x) => x.id === m.id);
    if (!old) return m;
    return {
      ...m,
      pos: { x: lerp(old.pos.x, m.pos.x, t), y: lerp(old.pos.y, m.pos.y, t) },
      facing: lerpAngle(old.facing, m.facing, t),
    };
  });
  // Scrap and items rarely move (only when carried/dropped) — interpolate too
  const scrap: ScrapInstance[] = next.snap.scrap.map((sc) => {
    const old = prev.snap.scrap.find((x) => x.id === sc.id);
    if (!old) return sc;
    return { ...sc, pos: { x: lerp(old.pos.x, sc.pos.x, t), y: lerp(old.pos.y, sc.pos.y, t) } };
  });
  const items: ItemInstance[] = next.snap.items.map((it) => {
    const old = prev.snap.items.find((x) => x.id === it.id);
    if (!old) return it;
    return { ...it, pos: { x: lerp(old.pos.x, it.pos.x, t), y: lerp(old.pos.y, it.pos.y, t) } };
  });
  return { ...next.snap, players, monsters, scrap, items };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}
